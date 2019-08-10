const fetch = require('node-fetch')
const prettyMs = require('pretty-ms')
const logger = require('./util/logger')
const prettyBytes = require('pretty-bytes')

const prettify = (val, type = 'bytes') => {
  if (typeof val !== 'number') return 'N/A'
  return type === 'bytes' ? prettyBytes(val) : prettyMs(val)
}

module.exports = async function addComment(
  results = [],
  actionInfo,
  statsConfig
) {
  let comment = `# ${
    actionInfo.isRelease
      ? statsConfig.commentReleaseHeading || 'Stats from current release'
      : statsConfig.commentHeading || 'Stats from current PR'
  }\n\n`

  const tableHead = `|  | ${statsConfig.mainRepo} ${statsConfig.mainBranch} | ${actionInfo.prRepo} ${actionInfo.prRef} | Change |\n| - | - | - | - |\n`

  for (const result of results) {
    comment += `### ${result.title}\n\n`

    Object.keys(result.mainRepoStats).forEach(groupKey => {
      const mainRepoGroup = result.mainRepoStats[groupKey]
      const diffRepoGroup = result.diffRepoStats[groupKey]
      let groupTable = tableHead
      let totalChange = 0

      Object.keys(mainRepoGroup).forEach(itemKey => {
        const prettyType = itemKey === 'buildDuration' ? 'ms' : 'bytes'
        const mainItemVal = mainRepoGroup[itemKey]
        const diffItemVal = diffRepoGroup[itemKey]
        const mainItemStr = prettify(mainItemVal, prettyType)
        const diffItemStr = prettify(diffItemVal, prettyType)
        let change = '✓'

        // calculate the change
        if (mainItemVal !== diffItemVal) {
          if (
            typeof mainItemVal === 'number' &&
            typeof diffItemVal === 'number'
          ) {
            change = Math.round((diffItemVal - mainItemVal) * 100) / 100

            if (!itemKey.endsWith('gzip')) {
              totalChange += change
            }
            change = `${change < 0 ? '-' : '⚠️  '}${prettify(
              Math.abs(change),
              prettyType
            )}`
          } else {
            change = 'N/A'
          }
        }

        groupTable += `| ${itemKey} | ${mainItemStr} | ${diffItemStr} | ${change} |\n`
      })
      let groupTotalChange = ''

      if (groupKey !== 'General' && totalChange !== 0) {
        groupTotalChange =
          totalChange < 0
            ? ' ✅ Overall decrease ✅'
            : ' ⚠️ Overall increase ⚠️'
      }

      comment += `<details>\n`
      comment += `<summary><strong>${groupKey}</strong>${groupTotalChange}</summary>\n\n`
      comment += groupTable
      comment += `\n</details>\n\n`
    })

    // add diffs
    if (result.diffs) {
      comment += '#### Diffs\n'

      Object.keys(result.diffs).forEach(itemKey => {
        const curDiff = result.diffs[itemKey]
        comment += `<details>\n`
        comment += `<summary>Diff for <strong>${itemKey}</strong></summary>\n\n`

        if (curDiff.length > 36 * 1000) {
          comment += 'Diff too large to display'
        } else {
          comment += `\`\`\`diff\n${curDiff}\n\`\`\``
        }
        comment += `\n</details>\n`
      })
    }

    comment += '\n'
  }
  logger('\n', comment)

  if (actionInfo.githubToken && actionInfo.commentEndpoint) {
    logger(`Posting results to ${actionInfo.commentEndpoint}`)
    try {
      const res = await fetch(actionInfo.commentEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `bearer ${actionInfo.githubToken}`,
        },
        body: JSON.stringify({
          body: comment,
        }),
      })

      if (!res.ok) {
        logger.error(`Failed to post results ${res.status}`)
        try {
          logger.error(await res.text())
        } catch (_) {
          /* no-op */
        }
      } else {
        logger('Successfully posted results')
      }
    } catch (err) {
      logger.error(`Error occurred posting results`, err)
    }
  } else {
    logger(
      `Not posting results`,
      actionInfo.githubToken ? 'No comment endpoint' : 'no GitHub token'
    )
  }
}
