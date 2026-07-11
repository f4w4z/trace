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

  constructor(baseUrl: string, apiKey: string, containerTag: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.containerTag = containerTag
    this.local = new LocalStore()
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
    await this.local.append(event)
    if (this.remoteOk) {
      this.postWithRetry(event).catch(() => {})
    }
    return event.id ?? null
  }

  async searchQuery(query: string, limit = 20, timeRange?: { startDate?: string; endDate?: string }): Promise<SupermemoryMemory[]> {
    if (this.remoteOk) {
      const results = await this.remoteSearch(query, limit, timeRange)
      if (results !== null && results.length > 0) return results
    }
    return this.local.search(query, limit, timeRange?.startDate, timeRange?.endDate)
  }

  async listDocuments(limit = 100, _page = 1): Promise<SupermemoryMemory[]> {
    return this.local.list(limit)
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

  private async postWithRetry(event: Event, retries = 3): Promise<string | null> {
    const body: Record<string, unknown> = {
      content: event.content,
      containerTag: this.containerTag,
      metadata: {
        ...event.metadata,
        source: event.source,
        eventType: event.type,
        eventId: event.id,
        rawTimestamp: event.timestamp.toISOString(),
      },
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
        logger.warn(`POST /v3/documents returned ${res.status} (attempt ${i + 1})`)
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
      if (!res.ok) return null
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

  async remoteList(limit: number): Promise<SupermemoryMemory[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v3/documents/list`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ containerTag: this.containerTag, limit, sort: 'createdAt', order: 'desc' }),
      })
      if (!res.ok) return null
      const data = await res.json() as { memories?: SupermemoryMemory[] }
      return data.memories ?? []
    } catch {
      return null
    }
  }
}
