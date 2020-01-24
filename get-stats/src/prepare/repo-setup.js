const path = require('path')
const fs = require('fs-extra')
const exec = require('../util/exec')
const { remove } = require('fs-extra')
const logger = require('../util/logger')

module.exports = actionInfo => {
  return {
    async cloneRepo(repoPath = '', dest = '') {
      await remove(dest)
      await exec(`git clone ${actionInfo.gitRoot}${repoPath} ${dest}`)
    },
    async checkoutRef(ref = '', repoDir = '') {
      await exec(`cd ${repoDir} && git fetch && git checkout ${ref}`)
    },
    async getLastStable(repoDir = '', ref) {
      const { stdout } = await exec(`cd ${repoDir} && git tag -l`)
      const tags = stdout.trim().split('\n')
      let lastStableTag

      for (let i = tags.length - 1; i >= 0; i--) {
        const curTag = tags[i]
        // stable doesn't include `-canary` or `-beta`
        if (!curTag.includes('-') && !ref.includes(curTag)) {
          lastStableTag = curTag
          break
        }
      }
      return lastStableTag
    },
    async getCommitId(repoDir = '') {
      const { stdout } = await exec(`cd ${repoDir} && git rev-parse HEAD`)
      return stdout.trim()
    },
    async resetToRef(ref = '', repoDir = '') {
      await exec(`cd ${repoDir} && git reset --hard ${ref}`)
    },
    async mergeBranch(ref = '', origRepoDir = '', destRepoDir = '') {
      await exec(`cd ${destRepoDir} && git remote add upstream ${origRepoDir}`)
      await exec(`cd ${destRepoDir} && git fetch upstream`)

      try {
        await exec(`cd ${destRepoDir} && git merge upstream/${ref}`)
        logger('Auto merge of main branch successful')
      } catch (err) {
        logger.error('Failed to auto merge main branch:', err)

        if (err.stdout && err.stdout.includes('CONFLICT')) {
          await exec(`cd ${destRepoDir} && git merge --abort`)
          logger('aborted auto merge')
        }
      }
    },
    async linkPackages(repoDir = '') {
      await fs.remove(path.join(repoDir, 'node_modules'))
      const pkgPaths = new Map()
      let pkgs

      try {
        pkgs = await fs.readdir(path.join(repoDir, 'packages'))
      } catch (err) {
        if (err.code === 'ENOENT') {
          console.log('no packages to link')
          return pkgPaths
        }
        throw err
      }

      for (const pkg of pkgs) {
        const pkgPath = path.join(repoDir, 'packages', pkg)
        await fs.remove(path.join(pkgPath, 'node_modules'))

        const pkgDataPath = path.join(pkgPath, 'package.json')
        const pkgData = require(pkgDataPath)
        pkgPaths.set(pkgData.name, pkgPath)

        for (const pkg of pkgs) {
          if (!pkgData.dependencies || !pkgData.dependencies[pkg]) continue
          pkgData.dependencies[pkg] = path.join(repoDir, 'packages', pkg)
        }
        await fs.writeFile(
          pkgDataPath,
          JSON.stringify(pkgData, null, 2),
          'utf8'
        )
      }
      return pkgPaths
    },
  }
}
