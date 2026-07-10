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
      fs.appendFileSync(DB_PATH, line, 'utf-8')
    } catch (err) {
      logger.error(`local store append failed: ${err}`)
    }
  }

  async list(limit = 100): Promise<SupermemoryMemory[]> {
    await this.ready
    try {
      if (!fs.existsSync(DB_PATH)) return []
      const raw = fs.readFileSync(DB_PATH, 'utf-8')
      const lines = raw.trim().split('\n').filter(Boolean).reverse().slice(0, limit)
      return lines.map(l => {
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
      if (!fs.existsSync(DB_PATH)) return []
      const raw = fs.readFileSync(DB_PATH, 'utf-8')
      const lines = raw.trim().split('\n').filter(Boolean)
      for (let i = lines.length - 1; i >= 0 && docs.length < limit; i--) {
        const e = JSON.parse(lines[i])
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
      if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
      return true
    } catch {
      return false
    }
  }
}
