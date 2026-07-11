import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Event, SupermemoryMemory } from '../types.js'
import { logger } from './logger.js'

const DB_PATH = path.join(os.homedir(), '.trace', 'events.jsonl')

export class LocalStore {
  private ready: Promise<void>

  constructor() {
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    const dir = path.dirname(DB_PATH)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  async append(event: Event): Promise<void> {
    await this.ready
    try {
      const line = JSON.stringify({
        id: event.id,
        source: event.source,
        type: event.type,
        content: event.content,
        metadata: event.metadata,
        timestamp: event.timestamp.toISOString(),
      }) + '\n'

      // Rotate if oversized (50MB)
      if (fs.existsSync(DB_PATH)) {
        const stat = fs.statSync(DB_PATH)
        if (stat.size > 50 * 1024 * 1024) {
          for (let i = 3; i >= 1; i--) {
            const old = DB_PATH + '.' + i
            const prev = DB_PATH + '.' + (i - 1)
            if (fs.existsSync(prev)) fs.renameSync(prev, old)
          }
          fs.renameSync(DB_PATH, DB_PATH + '.1')
        }
      }

      fs.appendFileSync(DB_PATH, line, 'utf-8')
    } catch (err) {
      logger.error(`local store append failed: ${err}`)
    }
  }

  private readLines(): string[] {
    const lines: string[] = []
    for (const file of [DB_PATH, DB_PATH + '.1', DB_PATH + '.2', DB_PATH + '.3']) {
      if (!fs.existsSync(file)) continue
      try {
        const raw = fs.readFileSync(file, 'utf-8')
        for (const l of raw.split('\n').filter(Boolean)) {
          try { JSON.parse(l); lines.push(l) } catch { /* skip corrupt line */ }
        }
      } catch { /* skip unreadable file */ }
    }
    return lines
  }

  async list(limit = 100): Promise<SupermemoryMemory[]> {
    await this.ready
    try {
      const all = this.readLines().reverse()
      if (limit > 0) all.splice(limit)
      return all.map(l => {
        const e = JSON.parse(l)
        return {
          id: e.id,
          content: e.content,
          source: e.source,
          metadata: { ...e.metadata, rawTimestamp: e.timestamp },
          createdAt: e.timestamp,
        } as SupermemoryMemory
      })
    } catch {
      return []
    }
  }

  async search(query: string, limit = 20): Promise<SupermemoryMemory[]> {
    const q = query.toLowerCase()
    const docs: SupermemoryMemory[] = []
    try {
      const all = this.readLines()
      for (let i = all.length - 1; i >= 0 && docs.length < limit; i--) {
        const e = JSON.parse(all[i])
        const content = (e.content ?? '').toLowerCase()
        const meta = JSON.stringify(e.metadata ?? {}).toLowerCase()
        if (content.includes(q) || meta.includes(q)) {
          docs.push({
            id: e.id,
            content: e.content,
            source: e.source,
            metadata: { ...e.metadata, rawTimestamp: e.timestamp },
            createdAt: e.timestamp,
          } as SupermemoryMemory)
        }
      }
    } catch {}
    return docs
  }

  async deleteAll(): Promise<boolean> {
    try {
      for (const file of [DB_PATH, DB_PATH + '.1', DB_PATH + '.2', DB_PATH + '.3']) {
        if (fs.existsSync(file)) fs.unlinkSync(file)
      }
      return true
    } catch {
      return false
    }
  }
}
