const path = require('path')
const logger = require('../util/logger')
const { diffRepoDir, allowedConfigLocations } = require('../constants')

// load stats-config
function loadStatsConfig() {
  let statsConfig
  let statsConfigPath
  let relativeConfigPath

  for (const configPath of allowedConfigLocations) {
    try {
      relativeConfigPath = configPath
      statsConfigPath = path.join(diffRepoDir, configPath)
      statsConfig = require(path.join(statsConfigPath, 'stats-config.js'))
      break
    } catch (_) {
      /* */
    }
  }

  if (!statsConfig) {
    throw new Error(
      `Failed to locate \`.stats-app\`, allowed locations are: ${allowedConfigLocations.join(
        ', '
      )}`
    )
  }

  logger('Got statsConfig at', relativeConfigPath, statsConfig, '\n')
  return { statsConfig, statsConfigPath }
}

module.exports = loadStatsConfig
