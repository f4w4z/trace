const levels = ['debug', 'info', 'warn', 'error'] as const
type Level = typeof levels[number]

let currentLevel: Level = 'info'

export function setLogLevel(level: Level): void {
  currentLevel = level
}

function log(level: Level, msg: string, ...args: unknown[]): void {
  const idx = levels.indexOf(level)
  const cur = levels.indexOf(currentLevel)
  if (idx < cur) return

  const ts = new Date().toISOString().slice(11, 19)
  const prefix = `[${ts}] [${level.toUpperCase()}]`
  if (args.length > 0) {
    console.log(`${prefix} ${msg}`, ...args)
  } else {
    console.log(`${prefix} ${msg}`)
  }
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', msg, ...args),
  info: (msg: string, ...args: unknown[]) => log('info', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log('warn', msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', msg, ...args),
}
