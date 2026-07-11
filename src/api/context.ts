import type { SupermemoryClient } from '../supermemory.js'
import type { CurrentContext, DayContext, Session, Event, QueryResult, SupermemoryMemory } from '../types.js'
import { logger } from '../utils/logger.js'

export class ContextService {
  private client: SupermemoryClient
  private daemonStop: (() => void) | null = null

  constructor(client: SupermemoryClient) {
    this.client = client
  }

  setDaemonStopper(fn: () => void): void {
    this.daemonStop = fn
  }

  async getCurrentContext(): Promise<CurrentContext> {
    const docs = await this.client.listDocuments(30)
    const events = this.docsToEvents(docs)
    const projects = this.extractProjects(docs)
    const activeProject = projects.length > 0 ? projects[0] : null
    let activeSession: Session | null = null
    if (events.length > 0) {
      activeSession = this.buildSession(events.slice(0, 10), activeProject ?? 'unknown')
    }
    return { activeSession, recentEvents: events.slice(0, 20), activeProject }
  }

  async searchContext(query: string): Promise<QueryResult> {
    const results = (await this.client.searchQuery(query)).filter(d => !this.isSummary(d))
    return { query, memories: results, answer: undefined }
  }

  async queryWithLLM(query: string, llmUrl?: string, llmModel?: string, llmApiKey?: string): Promise<QueryResult> {
    const results = (await this.client.searchQuery(query, 30)).filter(d => !this.isSummary(d))
    const recent = (await this.client.listDocuments(0)).filter(d => !this.isSummary(d))
    const seen = new Set(results.map(r => r.id))
    // Broaden with individual keywords directly from loaded events
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['what', 'were', 'when', 'where', 'that', 'this', 'there', 'with', 'have', 'been', 'your', 'about', 'tell', 'from'].includes(w))
    const kwMatches: SupermemoryMemory[] = []
    for (const word of words) {
      let count = 0
      for (const r of recent) {
        if (count >= 15) break
        if (seen.has(r.id) || this.isSummary(r)) continue
        const content = (r.content ?? '').toLowerCase()
        const meta = JSON.stringify(r.metadata ?? {}).toLowerCase()
        if (content.includes(word) || meta.includes(word)) {
          kwMatches.push(r); seen.add(r.id); count++
        }
      }
    }
    // Put keyword matches right after results so the LLM sees them first
    const combined = [...results, ...kwMatches, ...recent.filter(r => !seen.has(r.id) && !this.isSummary(r))]
    let answer: string | undefined
    if (llmUrl && llmModel) {
      answer = await this.askLLM(query, combined, llmUrl, llmModel, llmApiKey)
    }
    return { query, memories: results, answer }
  }

  async chat(query: string, llmUrl?: string, llmModel?: string, llmApiKey?: string): Promise<QueryResult> {
    let answer: string | undefined
    if (llmUrl && llmModel) {
      answer = await this.callLLM(
        'You are a helpful, friendly AI assistant. Answer the user\'s question conversationally and naturally.',
        query,
        llmUrl,
        llmModel,
        llmApiKey,
      )
    }
    return { query, memories: [], answer }
  }

  async getDayContext(dateStr: string): Promise<DayContext> {
    const docs = await this.client.listDocuments(200)
    const dayDocs = docs.filter(d => {
      const ts = d.createdAt
      if (!ts) return true
      return ts.startsWith(dateStr)
    })
    const events = this.docsToEvents(dayDocs)
    const sessions = this.groupIntoSessions(events)
    const summary = sessions.map(s => s.summary).filter(Boolean).join('\n')
    return { date: dateStr, sessions, eventCount: events.length, summary }
  }

  private summaryCache: { text: string; stats: { apps: { name: string; events: number }[]; browsers: { app: string; titles: string[] }[]; files: string[]; total: number }; expiresAt: number } | null = null

  async getSummary(): Promise<{ text: string; stats: { apps: { name: string; events: number }[]; browsers: { app: string; titles: string[] }[]; files: string[]; total: number }; cached: boolean }> {
    const now = Date.now()
    if (this.summaryCache && now < this.summaryCache.expiresAt) {
      return { ...this.summaryCache, cached: true }
    }

    const docs = await this.client.listDocuments(1000)
    const twoHrsAgo = new Date(now - 2 * 60 * 60 * 1000)
    const recent = docs.filter(d => {
      if (this.isSummary(d)) return false
      const ts = d.createdAt ? new Date(d.createdAt) : null
      return ts && ts >= twoHrsAgo
    })

    const events = this.docsToEvents(recent)
    const appMap = new Map<string, number>()
    const browserMap = new Map<string, Set<string>>()
    const files: string[] = []

    for (const e of events) {
      const app = e.metadata.app || e.source
      appMap.set(app, (appMap.get(app) || 0) + 1)
      if (e.source === 'browser' || e.metadata.url) {
        const titles = browserMap.get(app) ?? new Set()
        if (e.metadata.title || e.content) titles.add(e.metadata.title || e.content)
        browserMap.set(app, titles)
      }
      if (e.metadata.path) files.push(e.metadata.path)
      else if ((e.source === 'editor' || e.source === 'filesystem') && e.content) files.push(e.content)
    }

    const stats = {
      apps: Array.from(appMap.entries()).map(([name, count]) => ({ name, events: count })).sort((a, b) => b.events - a.events),
      browsers: Array.from(browserMap.entries()).map(([app, titles]) => ({ app, titles: Array.from(titles) })),
      files: [...new Set(files)].slice(0, 20),
      total: events.length,
    }

    const prompt = `The following is a raw log of the user's recent computer activity (last 2 hours). Summarize it in 2-4 concise, natural sentences. Mention key apps used, files worked on, and websites visited. Sound like a helpful assistant reporting what the user did.

Activity:
${events.slice(0, 60).map(e => `[${e.source}] ${e.content}${e.metadata.app ? ` (${e.metadata.app})` : ''}`).join('\n')}`

    const llmUrl = process.env.LLM_URL
    const llmModel = process.env.LLM_MODEL
    const llmApiKey = process.env.LLM_API_KEY
    let text = ''
    if (llmUrl && llmModel) {
      text = await this.askLLM(prompt, [], llmUrl, llmModel, llmApiKey, true)
    }
    if (!text) {
      const topApps = stats.apps.slice(0, 4).map(a => `${a.name} (${a.events} events)`).join(', ')
      const topFiles = stats.files.slice(0, 4).join(', ')
      text = `You used ${stats.apps.length} apps — ${topApps}.`
      if (stats.files.length) text += ` Worked on ${stats.files.length} files including ${topFiles}.`
      if (stats.browsers.length) text += ` Visited ${stats.browsers.reduce((s, b) => s + b.titles.length, 0)} pages.`
    }

    this.summaryCache = { text, stats, expiresAt: now + 5 * 60 * 1000 }
    return { text, stats, cached: false }
  }

  async getManagementStatus(): Promise<{ running: boolean; memoryCount: number; containerTag: string }> {
    const docs = await this.client.listDocuments(1)
    return { running: true, memoryCount: docs.length, containerTag: '' }
  }

  async clearAllMemories(): Promise<boolean> {
    return this.client.deleteContainerTag()
  }

  async storeSessionSummary(session: Session): Promise<void> {
    const lines = session.events.map(e => `  [${e.source}] ${e.content}`).join('\n')
    const content = `Session: ${session.project}\n${session.startTime.toLocaleTimeString()} - ${session.endTime.toLocaleTimeString()}\n${lines}`

    await this.client.addDocument(this.eventFromSession(content, session))
  }

  private eventFromSession(content: string, session: Session): Event {
    return {
      source: 'system',
      type: 'file_opened',
      content,
      metadata: {
        project: session.project,
        tags: ['_auto_summary', session.project],
        app: 'trace',
      },
      timestamp: session.endTime,
    }
  }

  private isSummary(d: SupermemoryMemory): boolean {
    const tags = d.metadata?.tags as string[] ?? []
    return tags.includes('_auto_summary')
  }

  private docsToEvents(docs: SupermemoryMemory[]): Event[] {
    return docs.filter(d => !this.isSummary(d)).map(d => {
      const md = d.metadata ?? {}
      const content = d.title ?? d.content ?? d.memory ?? d.chunk ?? ''
      return {
        id: d.id,
        source: (md.source ?? d.source ?? 'filesystem') as Event['source'],
        type: (md.eventType ?? 'file_opened') as Event['type'],
        content,
        metadata: md as Event['metadata'],
        timestamp: new Date((d.createdAt ?? md.rawTimestamp ?? Date.now()) as string | number),
      }
    }).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  private extractProjects(docs: SupermemoryMemory[]): string[] {
    const projects = new Set<string>()
    for (const d of docs) {
      if (this.isSummary(d)) continue
      const md = d.metadata ?? {}
      const tags = (md.tags as string[]) ?? []
      if (md.project) projects.add(md.project as string)
      for (const t of tags) {
        if (!['morning', 'afternoon', 'night', 'code', 'document', 'command', 'error', 'browser'].includes(t)) {
          projects.add(t)
        }
      }
    }
    return Array.from(projects).slice(0, 5)
  }

  private buildSession(events: Event[], project: string): Session {
    const times = events.map(e => e.timestamp.getTime())
    const startTime = new Date(Math.min(...times))
    const endTime = new Date(Math.max(...times))
    const allTags = new Set(events.flatMap(e => e.metadata.tags ?? []))
    allTags.add(project)
    return {
      id: `session-${startTime.getTime()}`,
      project,
      startTime,
      endTime,
      events,
      summary: `${events.length} events in ${project}`,
      tags: Array.from(allTags),
    }
  }

  private groupIntoSessions(events: Event[]): Session[] {
    if (events.length === 0) return []
    const sorted = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    const sessions: Session[] = []
    let current: Event[] = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime()
      if (gap > 30 * 60 * 1000 || this.getProject(sorted[i]) !== this.getProject(sorted[i - 1])) {
        const session = this.buildSessionFromEvents(current)
        sessions.push(session)
        this.storeSessionSummary(session) // fire-and-forget
        current = [sorted[i]]
      } else {
        current.push(sorted[i])
      }
    }
    const last = this.buildSessionFromEvents(current)
    sessions.push(last)
    this.storeSessionSummary(last) // fire-and-forget
    return sessions
  }

  private buildSessionFromEvents(events: Event[]): Session {
    const projects = new Set(events.map(e => this.getProject(e)).filter((p): p is string => p !== null))
    const project = projects.size > 0 ? Array.from(projects)[0] : 'unknown'
    return this.buildSession(events, project)
  }

  private getProject(event: Event): string | null {
    return event.metadata.project ?? null
  }

  private async askLLM(
    query: string,
    memories: SupermemoryMemory[],
    llmUrl: string,
    llmModel: string,
    llmApiKey?: string,
    raw = false,
  ): Promise<string> {
    if (raw) {
      const systemPrompt = 'You are an AI assistant analyzing the user\'s computer activity log.'
      const userPrompt = query
      return this.callLLM(systemPrompt, userPrompt, llmUrl, llmModel, llmApiKey)
    }

    const items: string[] = []
    for (const m of memories) {
      const app = (m.metadata?.app as string) ?? m.source ?? 'unknown'
      const ts = m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : ''
      const text = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
      const url = m.metadata?.url as string
      const detail = url || (m.metadata?.path as string) || ''
      if (text) {
        items.push(`[${ts} ${app}] ${text}${detail ? ` (${detail})` : ''}`)
      }
    }
    const context = items.slice(0, 80).join('\n')

    const hasData = memories.length > 0
    const systemPrompt = hasData
      ? 'You are analyzing the user\'s computer activity log. Answer their question based ONLY on the activity data below. Be specific — mention apps, files, URLs, and projects by name. If the data is insufficient, say what you DO know rather than claiming emptiness.'
      : 'You are a helpful assistant. The user asked about their recent activity but no data is available yet.'
    const userPrompt = `Based on my recent activity, please answer: ${query}

First, give a concise summary (under 40 words) on its own line, then a separator "---", then provide your full detailed answer.

Recent activity:
${context}`

    return this.callLLM(systemPrompt, userPrompt, llmUrl, llmModel, llmApiKey)
  }

  private async callLLM(
    systemPrompt: string,
    userPrompt: string,
    llmUrl: string,
    llmModel: string,
    llmApiKey?: string,
  ): Promise<string> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (llmApiKey) headers['Authorization'] = `Bearer ${llmApiKey}`

      const res = await fetch(`${llmUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: llmModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) {
        logger.warn(`LLM returned ${res.status}`)
        return ''
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] }
      return data.choices?.[0]?.message?.content ?? ''
    } catch (err) {
      logger.error(`LLM query failed: ${err}`)
      return ''
    }
  }
}
