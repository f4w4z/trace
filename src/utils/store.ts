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

  private readLines(limit = 0): string[] {
    const lines: string[] = []
    // Newest file first; read each file from end so limit returns newest events
    const files = [DB_PATH, DB_PATH + '.1', DB_PATH + '.2', DB_PATH + '.3']
    for (const file of files) {
      if (!fs.existsSync(file)) continue
      try {
        const raw = fs.readFileSync(file, 'utf-8')
        const fileLines = raw.split('\n').filter(Boolean)
        for (let i = fileLines.length - 1; i >= 0; i--) {
          const l = fileLines[i]
          try { JSON.parse(l); lines.push(l) } catch { /* skip corrupt line */ }
          if (limit > 0 && lines.length >= limit) break
        }
      } catch { /* skip unreadable file */ }
      if (limit > 0 && lines.length >= limit) break
    }
    return lines
  }

  async list(limit = 100): Promise<SupermemoryMemory[]> {
    await this.ready
    try {
      const all = this.readLines(limit)
      if (limit > 0 && all.length > limit) all.splice(limit)
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

  async search(query: string, limit = 20, startDate?: string, endDate?: string): Promise<SupermemoryMemory[]> {
    const q = query.toLowerCase()
    const docs: SupermemoryMemory[] = []
    const startMs = startDate ? new Date(startDate).getTime() : 0
    const endMs = endDate ? new Date(endDate).getTime() : Infinity

    // Define stop words
    const stopWords = new Set([
      'what', 'were', 'when', 'where', 'that', 'this', 'there', 'with', 'have', 'been', 'your', 'about', 'tell', 'from',
      'was', 'did', 'does', 'had', 'not', 'the', 'and', 'for', 'are', 'but', 'you', 'our', 'him', 'her', 'its', 'out',
      'has', 'get', 'set', 'who', 'how', 'why', 'can', 'will', 'would', 'should', 'could', 'than', 'then', 'them',
      'they', 'their', 'she', 'his', 'any', 'some', 'all', 'into', 'onto', 'over', 'under', 'here'
    ])

    // Clean terms: keep alphanumeric terms >= 2 chars, filter stop words
    const terms = q.split(/\s+/).map(w => w.replace(/[^\w]/g, '')).filter(w => w.length >= 2 && !stopWords.has(w))

    // Expand search terms with common synonyms and platform keywords
    const expanded = new Set(terms)
    for (const t of terms) {
      if (t === 'yt' || t === 'youtube' || t === 'video' || t === 'videos') {
        expanded.add('yt')
        expanded.add('youtube')
      }
      if (t === 'spotify' || t === 'music' || t === 'song' || t === 'listening' || t === 'listen' || t === 'track' || t === 'playing') {
        expanded.add('spotify')
        expanded.add('media')
        expanded.add('track_change')
      }
      if (t === 'netflix' || t === 'show' || t === 'movie' || t === 'watching' || t === 'watch') {
        expanded.add('netflix')
      }
    }
    const searchTerms = Array.from(expanded)

    try {
      if (searchTerms.length === 0) {
        return this.list(limit)
      }

      // Scan up to 5,000 events if no range is specified, or all if range is specified
      const scanLimit = startDate || endDate ? 0 : 5000
      const all = this.readLines(scanLimit)
      const scoredDocs: { doc: SupermemoryMemory; score: number }[] = []

      for (let i = 0; i < all.length; i++) {
        const e = JSON.parse(all[i])
        const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0
        if (ts < startMs || ts > endMs) continue

        const content = (e.content ?? '').toLowerCase()
        const meta = JSON.stringify(e.metadata ?? {}).toLowerCase()
        const app = (e.metadata?.app ?? e.source ?? '').toLowerCase()
        const title = (e.metadata?.title ?? '').toLowerCase()
        const source = (e.source ?? '').toLowerCase()

        let matchCount = 0
        let matchesAll = true

        for (const term of searchTerms) {
          const isMatch = content.includes(term) || meta.includes(term) || app.includes(term) || title.includes(term) || source.includes(term)
          if (isMatch) {
            matchCount++
          } else {
            // Synonyms don't all need to match, but original terms should ideally match
            if (terms.includes(term)) {
              matchesAll = false
            }
          }
        }

        if (matchCount > 0) {
          // Recency factor: newer events are near index 0
          const recencyFactor = 1 - (i / all.length)
          const matchesAllBonus = matchesAll ? 2.0 : 0.0
          const score = (matchCount / searchTerms.length) * 10.0 + matchesAllBonus + recencyFactor

          scoredDocs.push({
            doc: {
              id: e.id,
              content: e.content,
              source: e.source,
              metadata: { ...e.metadata, rawTimestamp: e.timestamp },
              createdAt: e.timestamp,
            } as SupermemoryMemory,
            score
          })
        }
      }

      scoredDocs.sort((a, b) => b.score - a.score)
      return scoredDocs.slice(0, limit).map(sd => sd.doc)
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
