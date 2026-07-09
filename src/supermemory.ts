import fetch from 'node-fetch'
import type { Event, SupermemoryMemory } from './types.js'
import { LocalStore } from './utils/store.js'
import { logger } from './utils/logger.js'

export class SupermemoryClient {
  private baseUrl: string
  private apiKey: string
  private containerTag: string
  private local: LocalStore
  private remoteOk = false

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
    if (this.remoteOk) {
      const id = await this.remoteAdd(event)
      if (id !== null) return id
    }
    await this.local.append(event)
    return event.id ?? null
  }

  async searchV4(query: string, limit = 20): Promise<SupermemoryMemory[]> {
    if (this.remoteOk) {
      const results = await this.remoteSearch(query, limit)
      if (results !== null) return results
    }
    return this.local.search(query, limit)
  }

  async listDocuments(limit = 100, _page = 1): Promise<SupermemoryMemory[]> {
    if (this.remoteOk) {
      const docs = await this.remoteList(limit)
      if (docs !== null) return docs
    }
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

  private async remoteAdd(event: Event): Promise<string | null> {
    try {
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
      const res = await fetch(`${this.baseUrl}/v3/documents`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        this.remoteOk = false
        logger.warn(`POST /v3/documents returned ${res.status}`)
        return null
      }
      return event.id ?? 'remote-ok'
    } catch (err) {
      this.remoteOk = false
      logger.warn(`supermemory unreachable, falling back to local store`)
      return null
    }
  }

  private async remoteSearch(query: string, limit: number): Promise<SupermemoryMemory[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v4/search`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ q: query, containerTag: this.containerTag, limit, searchMode: 'hybrid', threshold: 0.3 }),
      })
      if (!res.ok) return null
      const data = await res.json() as { results?: SupermemoryMemory[] }
      return data.results ?? []
    } catch {
      return null
    }
  }

  private async remoteList(limit: number): Promise<SupermemoryMemory[] | null> {
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
