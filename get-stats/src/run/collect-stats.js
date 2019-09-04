const path = require('path')
const fs = require('fs-extra')
const getPort = require('get-port')
const fetch = require('node-fetch')
const glob = require('../util/glob')
const gzipSize = require('gzip-size')
const logger = require('../util/logger')
const { spawn } = require('../util/exec')
const { parse: urlParse } = require('url')
const { statsAppDir } = require('../constants')

module.exports = async function collectStats(runConfig = {}, statsConfig = {}) {
  const stats = {}

  if (
    statsConfig.appStartCommand &&
    Array.isArray(runConfig.pagesToFetch) &&
    runConfig.pagesToFetch.length > 0
  ) {
    const fetchedPagesDir = path.join(statsAppDir, 'fetched-pages')
    const port = await getPort()
    const child = spawn(statsConfig.appStartCommand, {
      cwd: statsAppDir,
      env: {
        PORT: port,
      },
    })
    // give server a second to start up
    await new Promise(resolve => setTimeout(() => resolve(), 1500))
    await fs.mkdirp(fetchedPagesDir)

    for (let url of runConfig.pagesToFetch) {
      url = url.replace('$PORT', port)
      const { pathname } = urlParse(url)
      try {
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`Failed to fetch ${url} got status: ${res.status}`)
        }
        const responseText = (await res.text()).trim()

        let fileName = pathname === '/' ? '/index' : pathname
        if (fileName.endsWith('/'))
          fileName = fileName.substr(0, fileName.length - 1)
        logger(
          `Writing file to ${path.join(fetchedPagesDir, `${fileName}.html`)}`
        )

        await fs.writeFile(
          path.join(fetchedPagesDir, `${fileName}.html`),
          responseText,
          'utf8'
        )
      } catch (err) {
        logger.error(err)
      }
    }
    child.kill()
  }

  for (const fileGroup of runConfig.filesToTrack) {
    const { name, globs } = fileGroup
    const groupStats = {}
    const curFiles = new Set()

    for (const pattern of globs) {
      const results = await glob(pattern, { cwd: statsAppDir, nodir: true })
      results.forEach(result => curFiles.add(result))
    }

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
