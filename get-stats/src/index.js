const path = require('path')
const exec = require('./util/exec')
const logger = require('./util/logger')
const runConfigs = require('./run')
const addComment = require('./add-comment')
const actionInfo = require('./prepare/action-info')()
const {
  cloneRepo,
  checkoutRef,
  linkPackages,
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
    logger('Got statsConfig:', statsConfig)

    // clone main repository/ref
    await cloneRepo(statsConfig.mainRepo, mainRepoDir)
    await checkoutRef(statsConfig.mainBranch, mainRepoDir)

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
    await addComment(results, actionInfo)
    logger('finished')
    process.exit(0)
  } catch (err) {
    console.error('Error occurred generating stats:')
    console.error(err)
    process.exit(1)
  }
})()
