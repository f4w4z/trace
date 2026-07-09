import fs from 'fs'
import initSqlJs, { type Database } from 'sql.js'
import type { Event } from '../types.js'
import type { SupermemoryClient } from '../supermemory.js'
import { createEvent, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

interface BrowserConfig {
  name: string
  historyPath: string
}

interface BrowserVisit {
  url: string
  title: string
  visitTime: number
  browser: string
}

const POLL_MS = 15000
const SIX_HOURS_MS = 6 * 60 * 60 * 1000

export class BrowserWatcher {
  private client: SupermemoryClient
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private browsers: BrowserConfig[] = []
  private lastSeen: Record<string, number> = {}
  private sqlReady = false

  constructor(client: SupermemoryClient) {
    this.client = client
    initSqlJs().then(() => {
      this.sqlReady = true
      logger.info('sql.js initialized')
    }).catch(err => {
      logger.warn(`sql.js init failed, browser watcher disabled: ${err}`)
    })
  }

  start(...browsers: BrowserConfig[]): void {
    if (!this.sqlReady) {
      logger.info('sql.js not ready yet, browser watcher deferred')
      setTimeout(() => this.start(...browsers), 2000)
      return
    }

    const available = browsers.filter(b => {
      const exists = fs.existsSync(b.historyPath)
      if (!exists) logger.info(`browser history not found: ${b.name} (${b.historyPath})`)
      return exists
    })

    if (available.length === 0) {
      logger.info('no browser history found, browser watcher idle')
      return
    }

    this.browsers = available
    for (const b of available) {
      this.lastSeen[b.name] = Date.now()
      logger.info(`watching ${b.name} history: ${b.historyPath}`)
    }

    this.pollTimer = setInterval(() => this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async poll(): Promise<void> {
    for (const browser of this.browsers) {
      const visits = await this.readRecentVisits(browser)
      for (const v of visits) {
        const event = createEvent('browser', 'url_visited', v.title || v.url, {
          url: v.url,
          title: v.title,
          app: v.browser,
          tags: ['browser', v.browser, timeBucket(new Date(v.visitTime))],
        })
        this.client.addDocument(event)
      }
    }
  }

  private async readRecentVisits(browser: BrowserConfig): Promise<BrowserVisit[]> {
    const tmpPath = `${browser.historyPath}.smt_tmp`
    try {
      fs.copyFileSync(browser.historyPath, tmpPath)
      const SQL = await initSqlJs()
      const buf = fs.readFileSync(tmpPath)
      const db = new SQL.Database(buf)

      const stmt = db.prepare(`
        SELECT url, title, visit_time
        FROM urls JOIN visits ON urls.id = visits.url
        ORDER BY visit_time DESC LIMIT 10
      `)

      const now = Date.now()
      const visits: BrowserVisit[] = []

      while (stmt.step()) {
        const row = stmt.getAsObject() as { url: string; title: string | null; visit_time: number }
        const url = row.url?.trim() ?? ''
        const title = (row.title ?? url).trim()
        if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('brave://') || url.includes('localhost')) continue
        const visitTime = Math.floor(row.visit_time / 1000) // Chrome uses microseconds -> milliseconds
        if (isNaN(visitTime) || now - visitTime > SIX_HOURS_MS) continue
        if (visitTime <= (this.lastSeen[browser.name] ?? 0)) continue
        this.lastSeen[browser.name] = visitTime
        visits.push({ url, title, visitTime, browser: browser.name })
      }

      stmt.free()
      db.close()
      fs.unlinkSync(tmpPath)

      return visits.slice(-5)
    } catch (err) {
      try { fs.unlinkSync(tmpPath) } catch {}
      return []
    }
  }
}
