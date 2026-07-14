import fetch from 'node-fetch'
import type { Event, SupermemoryMemory } from './types.js'
import { LocalStore } from './utils/store.js'
import { logger } from './utils/logger.js'

export class SupermemoryClient {
  private baseUrl: string
  private apiKey: string
  private containerTag: string
  private local: LocalStore
  remoteOk = false
  private recentHashes: Map<string, number> = new Map()
  private static DEDUP_WINDOW_MS = 10 * 60 * 1000
  private static DEDUP_MAX = 2000

  constructor(baseUrl: string, apiKey: string, containerTag: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.containerTag = containerTag
    this.local = new LocalStore()
  }

  private dedupeKey(event: Event): string {
    const norm = event.content.toLowerCase().replace(/\s+/g, ' ').trim()
    return `${event.source}:${norm}`
  }

  private isDuplicate(event: Event): boolean {
    const key = this.dedupeKey(event)
    const now = Date.now()
    const prev = this.recentHashes.get(key)
    if (prev && now - prev < SupermemoryClient.DEDUP_WINDOW_MS) return true
    this.recentHashes.set(key, now)
    // bound memory: drop oldest entries once over the cap
    if (this.recentHashes.size > SupermemoryClient.DEDUP_MAX) {
      const firstKey = this.recentHashes.keys().next().value
      if (firstKey !== undefined) this.recentHashes.delete(firstKey)
    }
    return false
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`
    return h
  }

  setRemoteOk(ok: boolean): void {
    this.remoteOk = ok
  }

  async addDocument(event: Event): Promise<string | null> {
    if (this.isDuplicate(event)) {
      logger.debug(`dedup: skipping near-duplicate event (${event.source})`)
      return null
    }
    await this.local.append(event)
    if (this.remoteOk) {
      this.postWithRetry(event).catch(() => {})
    }
    return event.id ?? null
  }

  async searchQuery(query: string, limit = 20, timeRange?: { startDate?: string; endDate?: string }): Promise<SupermemoryMemory[]> {
    let remoteResults: SupermemoryMemory[] = []
    if (this.remoteOk) {
      try {
        const results = await this.remoteSearch(query, limit, timeRange)
        if (results !== null) remoteResults = results
      } catch { /* ignore */ }
    }
    const localResults = await this.local.search(query, limit, timeRange?.startDate, timeRange?.endDate)

    const seen = new Set<string>()
    const combined: SupermemoryMemory[] = []

    // Allocate up to half the limit for remote semantic results
    const remoteLimit = Math.min(remoteResults.length, Math.floor(limit / 2))
    for (let i = 0; i < remoteLimit; i++) {
      const r = remoteResults[i]
      if (r.id) {
        seen.add(r.id)
        combined.push(r)
      }
    }

    // Fill the remaining slots with local keyword results
    for (const l of localResults) {
      if (l.id && !seen.has(l.id)) {
        seen.add(l.id)
        combined.push(l)
      }
      if (combined.length >= limit) break
    }

    // If we still have slots left, fill them with any remaining remote results
    if (combined.length < limit) {
      for (const r of remoteResults) {
        if (r.id && !seen.has(r.id)) {
          seen.add(r.id)
          combined.push(r)
        }
        if (combined.length >= limit) break
      }
    }

    return combined
  }

  async listDocuments(limit = 100, _page = 1): Promise<SupermemoryMemory[]> {
    return this.local.list(limit)
  }

  async compact(): Promise<{ archived: number; bytesSaved: number }> {
    return this.local.compact()
  }

  async deleteContainerTag(): Promise<boolean> {
    if (this.remoteOk) {
      try {
        const res = await fetch(`${this.baseUrl}/v3/container-tags/${this.containerTag}`, {
          method: 'DELETE',
          headers: this.headers(),
        })
        if (res.ok || res.status === 204) return true
      } catch { /* fall through */ }
    }
    return this.local.deleteAll()
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v3/documents/list`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ containerTag: this.containerTag, limit: 1 }),
      })
      this.remoteOk = res.ok
      return res.ok
    } catch {
      this.remoteOk = false
      return false
    }
  }

  private flattenMetadata(raw: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
    const out: Record<string, string | number | boolean | string[]> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (v == null) continue
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = v
      } else if (Array.isArray(v) && v.every(i => typeof i === 'string')) {
        out[k] = v as string[]
      } else {
        out[k] = JSON.stringify(v)
      }
    }
    return out
  }

  private async postWithRetry(event: Event, retries = 3): Promise<string | null> {
    const body: Record<string, unknown> = {
      content: event.content,
      containerTag: this.containerTag,
      metadata: this.flattenMetadata({
        ...event.metadata,
        source: event.source,
        eventType: event.type,
        eventId: event.id,
        rawTimestamp: event.timestamp.toISOString(),
      }),
      taskType: 'memory',
    }
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`${this.baseUrl}/v3/documents`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
        })
        if (res.ok) return event.id ?? 'remote-ok'
        const errBody = await res.text().catch(() => '')
        logger.warn(`POST /v3/documents returned ${res.status} (attempt ${i + 1}): ${errBody}`)
        this.remoteOk = false
      } catch (err) {
        logger.warn(`supermemory unreachable (attempt ${i + 1}/${retries}): ${err}`)
        this.remoteOk = false
      }
      if (i < retries - 1) await new Promise(r => setTimeout(r, (i + 1) * 1000))
    }
    return null
  }

  private async remoteSearch(query: string, limit: number, timeRange?: { startDate?: string; endDate?: string }): Promise<SupermemoryMemory[] | null> {
    try {
      const body: Record<string, unknown> = { q: query, k: limit }
      if (timeRange) {
        if (timeRange.startDate) body.startDate = timeRange.startDate
        if (timeRange.endDate) body.endDate = timeRange.endDate
      }
      const res = await fetch(`${this.baseUrl}/v3/search`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        logger.warn(`POST /v3/search returned ${res.status}: ${errBody}`)
        return null
      }
      const data = await res.json() as { results?: { documentId: string; title?: string; score: number; chunks: { content: string }[]; createdAt: string }[] }
      if (!data.results || data.results.length === 0) return null
      return data.results.map(r => ({
        id: r.documentId,
        content: r.chunks?.[0]?.content ?? r.title ?? '',
        score: r.score,
        createdAt: r.createdAt,
      } as SupermemoryMemory))
    } catch {
      return null
    }
  }
}
