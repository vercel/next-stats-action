const path = require('path')
const fs = require('fs-extra')
const exec = require('../util/exec')
const glob = require('../util/glob')
const logger = require('../util/logger')
const { statsAppDir, diffingDir } = require('../constants')

module.exports = async function collectDiffs(
  filesToTrack = [],
  initial = false
) {
  if (initial) {
    // set-up diffing directory
    await fs.remove(diffingDir)
    await fs.mkdirp(diffingDir)
    await exec(`cd ${diffingDir} && git init`)
  }
  const diffs = {}

  for (const fileGroup of filesToTrack) {
    const { globs } = fileGroup
    const curFiles = []

    await Promise.all(
      globs.map(async pattern => {
        curFiles.push(...(await glob(pattern, { cwd: statsAppDir })))
      })
    )

    for (let file of curFiles) {
      const fileKey = path.basename(file)
      const absPath = path.join(statsAppDir, file)

      try {
        await fs.copy(absPath, path.join(diffingDir, file))

        if (initial) {
          await exec(`cd ${diffingDir} && git add ${file}`, true)
        } else {
          const { stdout } = await exec(
            `cd ${diffingDir} && git diff ${file}`,
            true
          )
          const curDiff = ((stdout || '').split(file).pop() || '').trim()

          if (curDiff.length > 0) {
            diffs[fileKey] = curDiff
          }
        }
      } catch (err) {
        logger.error('Error occurred copying file for diff', err)
      }
    }
  }

  return diffs
}
