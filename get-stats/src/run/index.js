const path = require('path')
const fs = require('fs-extra')
const glob = require('../util/glob')
const exec = require('../util/exec')
const logger = require('../util/logger')
const getDirSize = require('./get-dir-size')
const collectStats = require('./collect-stats')
const collectDiffs = require('./collect-diffs')
const { statsAppDir } = require('../constants')

const objVal = (obj, keys = '') => {
  let curVal = obj

  for (const key of keys.split('!!')) {
    curVal = curVal && typeof curVal === 'object' && curVal[key]
  }
  return curVal
}

async function runConfigs(
  configs = [],
  { statsConfig, statsConfigPath, mainRepoPkgPaths, diffRepoPkgPaths },
  diffing = false
) {
  const results = []

  for (const config of configs) {
    logger(`Running config: ${config.title}${diffing ? ' (diff)' : ''}`)

    // clean statsAppDir
    await fs.remove(statsAppDir)
    await fs.copy(statsConfigPath, statsAppDir)
    const origFiles = new Set(await fs.readdir(statsAppDir))

    let mainRepoStats
    let diffRepoStats
    let diffs

    for (const pkgPaths of [mainRepoPkgPaths, diffRepoPkgPaths]) {
      let curStats = {
        General: {
          buildDuration: null,
          nodeModulesSize: null,
        },
      }

      // remove any new files
      if (mainRepoStats) {
        logger('Cleaning stats-app')
        for (const file of await fs.readdir(statsAppDir)) {
          if (!origFiles.has(file)) {
            await fs.remove(path.join(statsAppDir, file))
          }
        }
      }

      // apply config files
      for (const configFile of config.configFiles || []) {
        const filePath = path.join(statsAppDir, configFile.path)
        await fs.writeFile(filePath, configFile.content, 'utf8')
      }

      // links local builds of the packages and installs dependencies
      await linkPkgs(statsAppDir, pkgPaths)

      if (!diffing) {
        curStats.General.nodeModulesSize = await getDirSize(
          path.join(statsAppDir, 'node_modules')
        )
      }

      const buildStart = new Date().getTime()
      await exec(`cd ${statsAppDir} && ${statsConfig.appBuildCommand}`)
      curStats.General.buildDuration = new Date().getTime() - buildStart

      // apply renames to get deterministic output names
      for (const rename of config.renames) {
        const results = await glob(rename.srcGlob, { cwd: statsAppDir })
        if (results.length === 0 || results[0] === rename.dest) continue
        await fs.move(
          path.join(statsAppDir, results[0]),
          path.join(statsAppDir, rename.dest)
        )
      }

      if (diffing) {
        curStats = true
      } else {
        const collectedStats = await collectStats(config, statsConfig)
        curStats = {
          ...curStats,
          ...collectedStats,
        }
      }

      if (mainRepoStats) {
        diffRepoStats = curStats

        if (!diffing && config.diff !== false) {
          for (const groupKey of Object.keys(curStats)) {
            if (groupKey === 'General') continue
            let changeDetected = false

            Object.keys(curStats[groupKey]).some(itemKey => {
              if (itemKey.endsWith('gzip')) return false
              let diffItemVal = objVal(diffRepoStats, `${groupKey}!!${itemKey}`)
              let mainItemVal = objVal(mainRepoStats, `${groupKey}!!${itemKey}`)
              diffItemVal = typeof diffItemVal === 'number' ? diffItemVal : 0
              mainItemVal = typeof mainItemVal === 'number' ? mainItemVal : 0
              changeDetected = diffItemVal !== mainItemVal
              return changeDetected
            })

            if (changeDetected) {
              logger('Detected change, running diff')
              diffs = await runConfigs(
                [
                  {
                    ...config,
                    configFiles: config.diffConfigFiles,
                  },
                ],
                {
                  statsConfig,
                  statsConfigPath,
                  mainRepoPkgPaths,
                  diffRepoPkgPaths,
                },
                true
              )
              break
            }
          }
        }

        if (diffing) {
          // copy new files and get diff results
          return collectDiffs(config.filesToTrack)
        }
      } else {
        // set up diffing folder and copy initial files
        if (diffing)
          await collectDiffs(config.filesToTrack, true)
        /* eslint-disable-next-line */
        mainRepoStats = curStats
      }
    }

    logger(`Finished running: ${config.title}`)

    results.push({
      title: config.title,
      mainRepoStats,
      diffRepoStats,
      diffs,
    })
  }

  return results
}

async function linkPkgs(pkgDir = '', pkgPaths) {
  await fs.remove(path.join(pkgDir, 'node_modules'))

  const pkgJsonPath = path.join(pkgDir, 'package.json')
  const pkgData = require(pkgJsonPath)

  if (!pkgData.dependencies && !pkgData.devDependencies) return

  for (const pkg of pkgPaths.keys()) {
    const pkgPath = pkgPaths.get(pkg)

    if (pkgData.dependencies && pkgData.dependencies[pkg]) {
      pkgData.dependencies[pkg] = pkgPath
    } else if (pkgData.devDependencies && pkgData.devDependencies[pkg]) {
      pkgData.devDependencies[pkg] = pkgPath
    }
  }
  await fs.writeFile(pkgJsonPath, JSON.stringify(pkgData, null, 2), 'utf8')
  await exec(`cd ${pkgDir} && yarn install`)
}

module.exports = runConfigs
