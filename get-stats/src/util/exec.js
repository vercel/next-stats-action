const logger = require('./logger')
const { promisify } = require('util')
const { exec: execOrig, spawn: spawnOrig } = require('child_process')

const execP = promisify(execOrig)
const env = {
  ...process.env,
  GITHUB_TOKEN: '',
  PR_STATS_COMMENT_TOKEN: '',
}

function exec(command, noLog = false) {
  if (!noLog) logger(`exec: ${command}`)
  return execP(command, { env })
}

exec.spawn = function spawn(commandStr = '', opts = {}) {
  const args = commandStr.split(' ')
  const command = args.shift()

  logger(`spawn: ${commandStr}`)
  const child = spawnOrig(command, args, {
    ...opts,
    env,
    stdio: 'pipe',
  })

  child.stderr.on('data', chunk => {
    logger.error(chunk.toString())
  })

  child.on('exit', (code, signal) => {
    logger(`spawn exit (${code}, ${signal}): ${commandStr}`)
  })
  return child
}

module.exports = exec
