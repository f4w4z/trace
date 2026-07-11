import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Event } from '../types.js'
import type { SupermemoryClient } from '../supermemory.js'
import { createEvent, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

interface HistoryFile {
  path: string
  lastSize: number
}

export class TerminalWatcher {
  private client: SupermemoryClient
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private files: HistoryFile[] = []

  constructor(client: SupermemoryClient) {
    this.client = client
  }

  start(historyPath: string): void {
    const paths: string[] = [historyPath]

    // Git Bash history
    const bashPath = path.join(os.homedir(), '.bash_history')
    if (fs.existsSync(bashPath) && bashPath !== historyPath) {
      paths.push(bashPath)
    }

    for (const p of paths) {
      if (!fs.existsSync(p)) {
        logger.info(`shell history not found at ${p}, skipping`)
        continue
      }
      this.files.push({ path: p, lastSize: fs.statSync(p).size })
      logger.info(`watching shell history: ${p}`)
    }

    if (this.files.length === 0) return

    this.pollTimer = setInterval(() => this.poll(), 5000)
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private poll(): void {
    for (const file of this.files) {
      try {
        const stat = fs.statSync(file.path)
        if (stat.size <= file.lastSize) continue
        file.lastSize = stat.size
      } catch {
        continue
      }

      try {
        const content = fs.readFileSync(file.path, 'utf-8')
        const lines = content.split('\n').filter(l => l.trim().length > 0)
        if (lines.length === 0) continue

        const lastLine = lines[lines.length - 1].trim()
        if (!lastLine || lastLine.startsWith('#')) continue

        const isError = /error|fail|fatal|traceback|exception|not found/i.test(lastLine)
        const shell = path.basename(file.path).replace(/^ConsoleHost_/, '').replace('_history', '').replace('.txt', '').replace('.bash', 'bash')
        const event = createEvent(
          'terminal',
          isError ? 'error_logged' : 'command_run',
          isError ? `Error: ${lastLine}` : `$ ${lastLine}`,
          {
            shell,
            exitCode: isError ? 1 : 0,
            tags: [timeBucket(new Date()), isError ? 'error' : 'command'],
          },
        )

        this.client.addDocument(event)
      } catch { /* ignore */ }
    }
  }
}
