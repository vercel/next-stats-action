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

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const isLastResult = i === results.length - 1
    let resultHasIncrease = false
    let resultHasDecrease = false
    let resultContent = ''

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
            // check if there is still a change after rounding
            if (change !== 0) {
              if (!itemKey.endsWith('gzip') && itemKey !== 'buildDuration') {
                totalChange += change
              }
              change = `${change < 0 ? '-' : '⚠️ +'}${prettify(
                Math.abs(change),
                prettyType
              )}`
            }
          } else {
            change = 'N/A'
          }
        }

        groupTable += `| ${itemKey} | ${mainItemStr} | ${diffItemStr} | ${change} |\n`
      })
      let groupTotalChange = ''

      if (totalChange !== 0) {
        if (totalChange < 0) {
          resultHasDecrease = true
          groupTotalChange = ' Overall decrease ✓'
        } else {
          resultHasIncrease = true
          groupTotalChange = ' Overall increase ⚠️'
        }
      }

      if (groupKey !== 'General') {
        let totalChangeSign = ''

        if (totalChange === 0) {
          totalChange = '✓'
        } else {
          totalChangeSign = totalChange < 0 ? '-' : '⚠️ +'
        }
        totalChange = `${totalChangeSign}${
          typeof totalChange === 'number'
            ? prettify(Math.abs(totalChange))
            : totalChange
        }`
        groupTable += `| Overall change |  |  | ${totalChange} |\n`
      }

      resultContent += `<details>\n`
      resultContent += `<summary><strong>${groupKey}</strong>${groupTotalChange}</summary>\n\n`
      resultContent += groupTable
      resultContent += `\n</details>\n\n`
    })

    // add diffs
    if (result.diffs) {
      const diffHeading = '#### Diffs\n'
      let diffContent = diffHeading

      Object.keys(result.diffs).forEach(itemKey => {
        const curDiff = result.diffs[itemKey]
        diffContent += `<details>\n`
        diffContent += `<summary>Diff for <strong>${itemKey}</strong></summary>\n\n`

        if (curDiff.length > 36 * 1000) {
          diffContent += 'Diff too large to display'
        } else {
          diffContent += `\`\`\`diff\n${curDiff}\n\`\`\``
        }
        diffContent += `\n</details>\n`
      })

      if (diffContent !== diffHeading) {
        resultContent += diffContent
      }
    }
    let increaseDecreaseNote = ''

    if (resultHasIncrease) {
      increaseDecreaseNote = ' (Increase detected ⚠️)'
    } else if (resultHasDecrease) {
      increaseDecreaseNote = ' (Decrease detected ✓)'
    }

    comment += `<details>\n`
    comment += `<summary><strong>${result.title}${increaseDecreaseNote}</strong></summary>\n\n<br/>\n\n`
    comment += resultContent
    comment += '</details>\n'

    if (!isLastResult) {
      comment += `<hr/>\n`
    }
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
