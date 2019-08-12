const path = require('path')
const fs = require('fs-extra')
const fetch = require('node-fetch')
const glob = require('../util/glob')
const gzipSize = require('gzip-size')
const logger = require('../util/logger')
const { spawn } = require('../util/exec')
const { statsAppDir } = require('../constants')

module.exports = async function collectStats(runConfig = {}, statsConfig = {}) {
  const stats = {}

  for (const fileGroup of runConfig.filesToTrack) {
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

  if (
    statsConfig.appStartCommand &&
    Array.isArray(runConfig.pagesToFetch) &&
    runConfig.pagesToFetch.length > 0
  ) {
    const groupStats = {}
    const child = spawn(statsConfig.appStartCommand, { cwd: statsAppDir })
    // give server a second to start up
    await new Promise(resolve => setTimeout(() => resolve(), 1500))

    for (const url of runConfig.pagesToFetch) {
      let size = 0
      let sizeGzip = 0
      try {
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`Failed to fetch ${url} got status: ${res.status}`)
        }
        const responseText = await res.text()
        size = responseText.length
        sizeGzip = await gzipSize(responseText)
      } catch (err) {
        logger.error(err)
      }
      const urlKey = path.basename(url)
      groupStats[urlKey] = size
      groupStats[`${urlKey} gzip`] = sizeGzip
    }
    stats['Fetched pages'] = groupStats
    child.kill()
  }

  return stats
}
