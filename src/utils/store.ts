import fs from 'fs'
import path from 'path'
import os from 'os'
import zlib from 'zlib'
import type { Event, SupermemoryMemory } from '../types.js'
import { logger } from './logger.js'
import { tokenizeQuery, expandSearchTerms } from './search.js'

const DB_PATH = path.join(os.homedir(), '.trace', 'events.jsonl')
const ARCHIVES = [DB_PATH + '.1', DB_PATH + '.2', DB_PATH + '.3']

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
    // Newest file first; read each file from end so limit returns newest events.
    // Plain archives and their .gz-compressed counterparts are both honored.
    const files: string[] = []
    for (const base of [DB_PATH, DB_PATH + '.1', DB_PATH + '.2', DB_PATH + '.3']) {
      if (fs.existsSync(base + '.gz')) files.push(base + '.gz')
      else if (fs.existsSync(base)) files.push(base)
    }
    for (const file of files) {
      try {
        let raw: string
        if (file.endsWith('.gz')) {
          raw = zlib.gunzipSync(fs.readFileSync(file)).toString('utf-8')
        } else {
          raw = fs.readFileSync(file, 'utf-8')
        }
        const fileLines = raw.split('\n').filter(Boolean)
        for (let i = fileLines.length - 1; i >= 0; i--) {
          lines.push(fileLines[i])
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
      const results: SupermemoryMemory[] = []
      for (const l of all) {
        try {
          const e = JSON.parse(l)
          results.push({
            id: e.id,
            content: e.content,
            source: e.source,
            metadata: { ...e.metadata, rawTimestamp: e.timestamp },
            createdAt: e.timestamp,
          } as SupermemoryMemory)
        } catch { /* skip corrupt line */ }
      }
      return results
    } catch {
      return []
    }
  }

  async search(query: string, limit = 20, startDate?: string, endDate?: string): Promise<SupermemoryMemory[]> {
    const docs: SupermemoryMemory[] = []
    const startMs = startDate ? new Date(startDate).getTime() : 0
    const endMs = endDate ? new Date(endDate).getTime() : Infinity

    const terms = tokenizeQuery(query)
    const searchTerms = expandSearchTerms(terms)

    try {
      if (searchTerms.length === 0) {
        return this.list(limit)
      }

      const all = this.readLines(0)
      const scoredDocs: { doc: SupermemoryMemory; score: number }[] = []

      for (let i = 0; i < all.length; i++) {
        const line = all[i]
        const lowerLine = line.toLowerCase()
        let hasMatch = false
        for (const term of searchTerms) {
          if (lowerLine.includes(term)) {
            hasMatch = true
            break
          }
        }
        if (!hasMatch) continue

        try {
          const e = JSON.parse(line)
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

            // Calculate length-weighted match ratio to favor rare/longer terms (proper nouns, filenames, URLs) over short ones
            let matchedLength = 0
            let totalLength = 0
            for (const term of searchTerms) {
              const isMatch = content.includes(term) || meta.includes(term) || app.includes(term) || title.includes(term) || source.includes(term)
              totalLength += term.length
              if (isMatch) {
                matchedLength += term.length
              }
            }
            const lengthWeight = totalLength > 0 ? (matchedLength / totalLength) : 0

            const score = lengthWeight * 10.0 + matchesAllBonus + recencyFactor

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
        } catch { /* skip corrupt line */ }
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
        const gz = file + '.gz'
        if (fs.existsSync(gz)) fs.unlinkSync(gz)
      }
      return true
    } catch {
      return false
    }
  }

  // Compaction: gzip rotated archive files (.1/.2/.3) into .gz to save disk.
  // Returns how many archives were compressed and approximate bytes saved.
  async compact(): Promise<{ archived: number; bytesSaved: number }> {
    await this.ready
    let archived = 0
    let bytesSaved = 0
    try {
      for (const file of ARCHIVES) {
        const gz = file + '.gz'
        if (!fs.existsSync(file)) {
          if (fs.existsSync(gz)) archived++ // already compressed
          continue
        }
        const stat = fs.statSync(file)
        const raw = fs.readFileSync(file)
        const compressed = zlib.gzipSync(raw, { level: 9 })
        fs.writeFileSync(gz, compressed)
        fs.unlinkSync(file)
        archived++
        bytesSaved += stat.size - compressed.length
        logger.info(`compacted ${path.basename(file)} → ${path.basename(gz)} (${(stat.size / 1024 | 0)}KB → ${(compressed.length / 1024 | 0)}KB)`)
      }
    } catch (err) {
      logger.error(`compaction failed: ${err}`)
    }
    return { archived, bytesSaved }
  }
}
