const path = require('path')
const fs = require('fs-extra')
const exec = require('../util/exec')
const glob = require('../util/glob')
const minimatch = require('minimatch')
const logger = require('../util/logger')
const { statsAppDir, diffingDir } = require('../constants')

module.exports = async function collectDiffs(
  filesToTrack = [],
  renames = [],
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

    for (const rename of renames) {
      const results = await glob(rename.srcGlob, { cwd: statsAppDir })
      if (results.length === 0 || results[0] === rename.dest) continue
      await fs.move(
        path.join(statsAppDir, results[0]),
        path.join(statsAppDir, rename.dest)
      )
    }

    await Promise.all(
      globs.map(async pattern => {
        curFiles.push(...(await glob(pattern, { cwd: statsAppDir })))
      })
    )

    for (let file of curFiles) {
      // update file with rename destination
      for (const rename of renames) {
        if (minimatch(file, rename.srcGlob)) {
          file = rename.dest
          break
        }
      }
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
          diffs[fileKey] = (stdout || '').split(file).pop()
        }
      } catch (err) {
        logger.error('Error occurred copying file for diff', err)
      }
    }
  }

  return diffs
}
