const exec = require('./util/exec')
const logger = require('./util/logger')
const runConfigs = require('./run')
const addComment = require('./add-comment')
const actionInfo = require('./prepare/action-info')()
const { mainRepoDir, diffRepoDir } = require('./constants')
const loadStatsConfig = require('./prepare/load-stats-config')
const {
  cloneRepo,
  checkoutRef,
  mergeBranch,
  getCommitId,
  linkPackages,
  getLastStable,
} = require('./prepare/repo-setup')(actionInfo)

const allowedActions = new Set(['synchronize', 'opened'])

if (!allowedActions.has(actionInfo.actionName) && !actionInfo.isRelease) {
  logger(
    `Not running for ${actionInfo.actionName} event action on repo: ${actionInfo.prRepo} and ref ${actionInfo.prRef}`
  )
  process.exit(0)
}

(async () => {
  try {
    // clone PR/newer repository/ref first to get settings
    if (!actionInfo.skipClone) {
      await cloneRepo(actionInfo.prRepo, diffRepoDir)
      await checkoutRef(actionInfo.prRef, diffRepoDir)
    }

    // load stats config from allowed locations
    const { statsConfig, relativeStatsAppDir } = loadStatsConfig()

    // clone main repository/ref
    if (!actionInfo.skipClone) {
      await cloneRepo(statsConfig.mainRepo, mainRepoDir)
      await checkoutRef(statsConfig.mainBranch, mainRepoDir)
    }
    /* eslint-disable-next-line */
    actionInfo.commitId = await getCommitId(diffRepoDir)

    if (!actionInfo.skipClone) {
      if (actionInfo.isRelease) {
        logger('Release detected, resetting mainRepo to last stable tag')
        const lastStableTag = await getLastStable(mainRepoDir)
        if (!lastStableTag) throw new Error('failed to get last stable tag')
        await checkoutRef(lastStableTag, mainRepoDir)
        /* eslint-disable-next-line */
        actionInfo.commitId = await getCommitId(diffRepoDir)

        if (!actionInfo.customCommentEndpoint) {
          /* eslint-disable-next-line */
          actionInfo.commentEndpoint = `https://api.github.com/repos/${statsConfig.mainRepo}/commits/${actionInfo.commitId}/comments`
        }
      } else if (statsConfig.autoMergeMain) {
        logger('Attempting auto merge of main branch')
        await mergeBranch(statsConfig.mainBranch, mainRepoDir, diffRepoDir)
      }
    }

    let mainRepoPkgPaths
    let diffRepoPkgPaths

    // run install/initialBuildCommand
    for (const dir of [mainRepoDir, diffRepoDir]) {
      logger(`Running initial build for ${dir}`)
      if (!actionInfo.skipClone) {
        let buildCommand = `cd ${dir}${
          !statsConfig.skipInitialInstall
            ? ' && yarn install --prefer-offline'
            : ''
        }`

        if (statsConfig.initialBuildCommand) {
          buildCommand += ` && ${statsConfig.initialBuildCommand}`
        }
        await exec(buildCommand)
      }

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
      relativeStatsAppDir,
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
