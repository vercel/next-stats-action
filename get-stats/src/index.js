const path = require('path')
const exec = require('./util/exec')
const logger = require('./util/logger')
const runConfigs = require('./run')
const addComment = require('./add-comment')
const actionInfo = require('./prepare/action-info')()
const {
  cloneRepo,
  checkoutRef,
  mergeBranch,
  getCommitId,
  linkPackages,
  getLastStable,
} = require('./prepare/repo-setup')(actionInfo)

const { mainRepoDir, diffRepoDir } = require('./constants')

;(async () => {
  try {
    // clone PR/newer repository/ref first to get settings
    await cloneRepo(actionInfo.prRepo, diffRepoDir)
    await checkoutRef(actionInfo.prRef, diffRepoDir)

    // load stats-config
    const statsConfig = require(path.join(
      diffRepoDir,
      '.stats-app/stats-config.js'
    ))
    logger('Got statsConfig:', statsConfig, '\n')

    // clone main repository/ref
    await cloneRepo(statsConfig.mainRepo, mainRepoDir)
    await checkoutRef(statsConfig.mainBranch, mainRepoDir)

    if (actionInfo.isRelease) {
      logger('Release detected, resetting mainRepo to last stable tag')
      const lastStableTag = await getLastStable(mainRepoDir)
      if (!lastStableTag) throw new Error('failed to get last stable tag')
      await checkoutRef(lastStableTag, mainRepoDir)
      const releaseCommitId = await getCommitId(diffRepoDir)
      /* eslint-disable-next-line */
      actionInfo.commentEndpoint = `https://api.github.com/repos/${statsConfig.mainRepo}/commits/${releaseCommitId}/comments`
    } else if (statsConfig.autoMergeMain) {
      logger('Attempting auto merge of main branch')
      await mergeBranch(statsConfig.mainBranch, mainRepoDir, diffRepoDir)
    }

    let mainRepoPkgPaths
    let diffRepoPkgPaths

    // run install/initialBuildCommand
    for (const dir of [mainRepoDir, diffRepoDir]) {
      logger(`Running initial build for ${dir}`)
      let buildCommand = `cd ${dir} && yarn install --prefer-offline`

      if (statsConfig.initialBuildCommand) {
        buildCommand += ` && ${statsConfig.initialBuildCommand}`
      }
      await exec(buildCommand)

      logger(`Linking packages in ${dir}`)
      const pkgPaths = await linkPackages(dir)

      if (mainRepoPkgPaths) diffRepoPkgPaths = pkgPaths
      else mainRepoPkgPaths = pkgPaths
    }

    // run the configs and post the comment
    const results = await runConfigs(statsConfig.configs, {
      statsConfig,
      mainRepoPkgPaths,
      diffRepoPkgPaths,
    })
    await addComment(results, actionInfo, statsConfig)
    logger('finished')
    process.exit(0)
  } catch (err) {
    console.error('Error occurred generating stats:')
    console.error(err)
    process.exit(1)
  }
})()
