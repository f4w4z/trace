import fs from 'fs'
import os from 'os'
import path from 'path'
import type { SupermemoryClient } from '../supermemory.js'
import type { Config } from '../types.js'
import { createEvent, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

// One-time backfill of recent browser history (complements the live tab
// capture done by the system tracker). Reads a copy of each browser's SQLite
// History file via sql.js so we never touch the locked live database.
export class BrowserHistoryWatcher {
  private client: SupermemoryClient
  private config: Config

  constructor(client: SupermemoryClient, config: Config) {
    this.client = client
    this.config = config
  }

  async backfill(): Promise<void> {
    const sources: { name: string; file: string }[] = [
      { name: 'chrome', file: this.config.chromeHistory },
      { name: 'edge', file: this.config.edgeHistory },
      { name: 'brave', file: this.config.braveHistory },
    ]
    for (const s of sources) {
      if (!s.file || !fs.existsSync(s.file)) continue
      try {
        await this.readHistory(s.name, s.file)
      } catch (err) {
        logger.debug(`browser history backfill failed for ${s.name}: ${err}`)
      }
    }
  }

  private async readHistory(name: string, file: string): Promise<void> {
    const tmp = path.join(os.tmpdir(), `trace-history-${name}-${Date.now()}.sqlite`)
    fs.copyFileSync(file, tmp)
    try {
      const initSqlJs = (await import('sql.js')).default
      const SQL = await initSqlJs()
      const db = new SQL.Database(fs.readFileSync(tmp))
      const res = db.exec(`SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC`)
      db.close()
      if (!res.length) return
      const rows = res[0].values as unknown[][]
      let ingested = 0
      // Emit oldest-first so the memory timeline stays chronological
      for (const row of rows.slice().reverse()) {
        const url = String(row[0] ?? '')
        const title = String(row[1] ?? '')
        const lastVisit = Number(row[2] ?? 0)
        if (!url.startsWith('http')) continue
        // Chrome/Edge store time as microseconds since 1601-01-01 (UTC).
        const tsMs = lastVisit > 0 ? (lastVisit / 1_000) - 11_644_473_600_000 : Date.now()
        const ts = new Date(tsMs)
        // Never pass a bare URL as content — Supermemory would try to crawl it
        // and reject dead/auth-walled links. Keep the URL in metadata only.
        let host = ''
        try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* ignore */ }
        const content = title
          ? `Visited ${title} (${host}) (history)`
          : `Visited ${host || url} (history)`
        this.client.addDocument(createEvent('browser', 'url_visited',
          content,
          {
            url, title, app: name,
            tags: ['browser', name, 'history', timeBucket(ts)],
          },
          ts,
        ))
        ingested++
      }
      logger.info(`backfilled ${ingested} history entries from ${name}`)
    } finally {
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    }
  }
}
