import fs from 'fs'
import path from 'path'
import os from 'os'
import type { SupermemoryClient } from '../supermemory.js'
import { ContextService } from '../api/context.js'
import { logger } from '../utils/logger.js'

const DIGEST_DIR = path.join(os.homedir(), '.trace', 'digests')

export class DigestScheduler {
  private supermemory: SupermemoryClient
  private context: ContextService
  private hour: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(supermemory: SupermemoryClient, hour: number) {
    this.supermemory = supermemory
    this.context = new ContextService(supermemory)
    this.hour = hour
  }

  start(): void {
    if (this.running) return
    this.running = true
    logger.info(`daily digest scheduled for ${this.hour}:00 local`)
    this.scheduleNext()
  }

  stop(): void {
    this.running = false
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  private msUntilNext(): number {
    const now = new Date()
    const next = new Date()
    next.setHours(this.hour, 0, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    return next.getTime() - now.getTime()
  }

  private scheduleNext(): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      this.run().catch(err => logger.error(`digest run failed: ${err}`))
      this.scheduleNext()
    }, this.msUntilNext())
  }

  async run(): Promise<string> {
    const date = new Date().toISOString().slice(0, 10)
    try {
      const { text, stats } = await this.context.getSummary()
      const md = `# Daily Digest — ${date}\n\n${text}\n\n## Stats\n- Total events: ${stats.total}\n- Top apps: ${stats.apps.slice(0, 5).map(a => `${a.name} (${a.events})`).join(', ') || 'none'}\n`
      if (!fs.existsSync(DIGEST_DIR)) fs.mkdirSync(DIGEST_DIR, { recursive: true })
      fs.writeFileSync(path.join(DIGEST_DIR, `${date}.md`), md, 'utf-8')
      logger.info(`daily digest generated: ${path.join(DIGEST_DIR, date + '.md')}`)
      logger.info(`digest: ${text}`)
      return text
    } catch (err) {
      logger.error(`digest generation failed: ${err}`)
      return ''
    }
  }
}
