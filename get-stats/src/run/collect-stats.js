const path = require('path')
const fs = require('fs-extra')
const glob = require('../util/glob')
const gzipSize = require('gzip-size')
const logger = require('../util/logger')
const { statsAppDir } = require('../constants')

module.exports = async function collectStats(filesToTrack = []) {
  const stats = {}

  for (const fileGroup of filesToTrack) {
    const { name, globs } = fileGroup
    const groupStats = {}
    const curFiles = []

    await Promise.all(
      globs.map(async pattern => {
        curFiles.push(...(await glob(pattern, { cwd: statsAppDir })))
      })
    )

    for (const file of curFiles) {
      const fileKey = path.basename(file)
      const absPath = path.join(statsAppDir, file)
      try {
        const fileInfo = await fs.stat(absPath)
        groupStats[fileKey] = fileInfo.size
        groupStats[`${fileKey} gzip`] = await gzipSize.file(absPath)
      } catch (err) {
        logger.error('Failed to get file stats', err)
      }
    }
    stats[name] = groupStats
  }

  return stats
}
