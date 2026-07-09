import fs from 'fs'
import path from 'path'
import type { Event } from '../types.js'
import type { SupermemoryClient } from '../supermemory.js'
import { createEvent, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

export class TerminalWatcher {
  private client: SupermemoryClient
  private lastSize = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private historyPath = ''

  constructor(client: SupermemoryClient) {
    this.client = client
  }

  start(historyPath: string): void {
    if (!historyPath || !fs.existsSync(historyPath)) {
      logger.info(`shell history not found at ${historyPath}, terminal watcher idle`)
      return
    }

    this.historyPath = historyPath
    this.lastSize = fs.statSync(historyPath).size

    logger.info(`watching shell history: ${historyPath}`)

    this.pollTimer = setInterval(() => this.poll(), 5000)
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private poll(): void {
    try {
      const stat = fs.statSync(this.historyPath)
      if (stat.size <= this.lastSize) return
      this.lastSize = stat.size
    } catch {
      return
    }

    try {
      const content = fs.readFileSync(this.historyPath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim().length > 0)
      if (lines.length === 0) return

      const lastLine = lines[lines.length - 1].trim()
      if (!lastLine || lastLine.startsWith('#')) return

      const isError = /error|fail|fatal|traceback|exception|not found/i.test(lastLine)
      const event = createEvent(
        'terminal',
        isError ? 'error_logged' : 'command_run',
        isError ? `Error: ${lastLine}` : `$ ${lastLine}`,
        {
          shell: path.basename(this.historyPath),
          exitCode: isError ? 1 : 0,
          tags: [timeBucket(new Date()), isError ? 'error' : 'command'],
        },
      )

      this.client.addDocument(event)
    } catch { /* ignore */ }
  }
}
