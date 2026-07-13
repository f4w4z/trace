import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { logger } from './utils/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MAIN = path.resolve(__dirname, 'index.js')

// Supervisor: keeps the trace server alive. Restarts on unexpected exit with
// crash-loop protection (max 5 restarts per minute).
export function runWatchdog(): void {
  let child: ChildProcess | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let restartCount = 0
  let restartWindowStart = 0

  function spawnChild(): void {
    if (child) return
    logger.info(`watchdog: starting trace (${MAIN})`)
    child = spawn(process.execPath, [MAIN], { stdio: 'inherit', windowsHide: false })

    child.on('exit', (code, signal) => {
      child = null
      const expected = code === 0 && !signal
      if (expected) {
        logger.info('watchdog: trace exited cleanly, stopping supervisor')
        process.exit(0)
      }
      logger.warn(`watchdog: trace exited (code ${code}, signal ${signal}), will restart`)
      scheduleRestart()
    })

    child.on('error', (err) => {
      logger.error(`watchdog: failed to start trace: ${err.message}`)
      scheduleRestart()
    })
  }

  function scheduleRestart(): void {
    const now = Date.now()
    if (now - restartWindowStart > 60000) {
      restartCount = 0
      restartWindowStart = now
    }
    restartCount++
    if (restartCount > 5) {
      logger.error('watchdog: too many crashes, giving up')
      process.exit(1)
    }
    if (restartTimer) return
    restartTimer = setTimeout(() => {
      restartTimer = null
      spawnChild()
    }, 3000)
  }

  process.on('SIGINT', () => { if (child) child.kill('SIGINT'); else process.exit(0) })
  process.on('SIGTERM', () => { if (child) child.kill('SIGTERM'); else process.exit(0) })

  spawnChild()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatchdog()
}
