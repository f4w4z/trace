import type { SupermemoryClient } from '../supermemory.js'
import type { CurrentContext, DayContext, Session, Event, QueryResult, SupermemoryMemory } from '../types.js'
import { logger } from '../utils/logger.js'
import { parseTimeRange } from '../utils/time.js'
import { tokenizeQuery, expandSearchTerms, STOP_WORDS } from '../utils/search.js'
import { extractProject } from '../utils/events.js'
import { cleanTitle, getRelativeTime, findSpecificAnswer } from '../shared/text.js'

export class ContextService {
  private client: SupermemoryClient

  constructor(client: SupermemoryClient) {
    this.client = client
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

  async searchContext(query: string, timezoneOffset = 0): Promise<QueryResult> {
    const { startDate, endDate, cleanQuery } = parseTimeRange(query, timezoneOffset)
    const results = (await this.client.searchQuery(cleanQuery, 20, { startDate, endDate })).filter(d => !this.isSummary(d))
    return { query: cleanQuery, memories: results, answer: undefined }
  }

  async queryWithLLM(query: string, history: { role: string; text: string }[], llmUrl?: string, llmModel?: string, llmApiKey?: string, timezoneOffset = 0): Promise<QueryResult> {
    const { startDate, endDate, cleanQuery } = parseTimeRange(query, timezoneOffset)

    // Strip trailing punctuation from query terms
    const sanitized = cleanQuery.replace(/[^\w\s]/g, '')

    // Vector search (constrained to time range if specified)
    const vectorResults = (await this.client.searchQuery(sanitized, 30, { startDate, endDate })).filter(d => !this.isSummary(d))

    // Recent docs for keyword matching (full scan when time-range is specified)
    const recent = (await this.client.listDocuments(startDate || endDate ? 0 : 10000)).filter(d => !this.isSummary(d))

    // Time-filter recent docs if we have a time range
    let candidates = recent
    if (startDate || endDate) {
      candidates = recent.filter(d => {
        const ts = d.createdAt ? new Date(d.createdAt).getTime() : 0
        if (startDate && ts < new Date(startDate).getTime()) return false
        if (endDate && ts > new Date(endDate).getTime()) return false
        return true
      })
    }

    // Keyword extraction from cleaned query
    const seen = new Set(vectorResults.map(r => r.id))
    const searchTerms = expandSearchTerms(tokenizeQuery(cleanQuery))

    const kwMatches: SupermemoryMemory[] = []
    for (const word of searchTerms) {
      let count = 0
      for (const r of candidates) {
        if (count >= 15) break
        if (seen.has(r.id) || this.isSummary(r)) continue
        const c = (r.content ?? '').toLowerCase()
        const m = JSON.stringify(r.metadata ?? {}).toLowerCase()
        const app = String(r.metadata?.app ?? r.source ?? '').toLowerCase()
        const title = String(r.metadata?.title ?? '').toLowerCase()
        const source = String(r.source ?? '').toLowerCase()
        // Match against content AND structured fields (searchQuery, url, title, app, source)
        if (c.includes(word) || m.includes(word) || app.includes(word) || title.includes(word) || source.includes(word)) {
          kwMatches.push(r); seen.add(r.id); count++
        }
      }
    }

    // Only vector results + keyword matches — no leftover dumping
    const combined = [...vectorResults, ...kwMatches]

    let answer: string | undefined
    if (llmUrl && llmModel) {
      const items = combined.slice(0, 35).map(m => {
        const app = (m.metadata?.app as string) ?? m.source ?? 'unknown'
        const ts = m.createdAt ? new Date(m.createdAt).toLocaleString() : ''
        const text = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
        const url = m.metadata?.url as string
        const detail = url || (m.metadata?.path as string) || ''
        return `[${ts} ${app}] ${text}${detail ? ` (${detail})` : ''}`
      }).join('\n')

      const hasData = combined.length > 0
      const dateRange = startDate || endDate
        ? ` from ${startDate ? new Date(startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'earlier'} to ${endDate ? new Date(endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'now'}`
        : ''

      const systemPrompt = hasData
        ? `You are a friendly personal memory assistant analyzing the user\'s activity log${dateRange}. Answer their question in a warm, direct, and conversational tone based ONLY on the activity data below.`
        : 'You are a helpful assistant. The user asked about their recent activity but no data is available yet.'

      const userPrompt = `Based on my recent activity${dateRange}, please answer: ${cleanQuery || query}

First, give a friendly, direct, and concise one-sentence answer (under 30 words) on its own line, then a separator "---", then provide a nicely formatted detailed explanation.

Relevant activity:
${items || '(no matching events found)'}`
      answer = await this.callLLM(systemPrompt, userPrompt, history, llmUrl, llmModel, llmApiKey)
    }

    if (!answer) {
      answer = this.generateLocalAnswer(cleanQuery || query, combined)
    }
    return { query, memories: vectorResults, answer }
  }

  async chat(query: string, history: { role: string; text: string }[], llmUrl?: string, llmModel?: string, llmApiKey?: string): Promise<QueryResult> {
    let answer: string | undefined
    if (llmUrl && llmModel) {
      answer = await this.callLLM(
        'You are a helpful, friendly AI assistant. Answer the user\'s question conversationally and naturally.',
        query,
        history,
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

  async getRecentFiles(limit = 20): Promise<{ path: string; app?: string; lastSeen: string; count: number }[]> {
    const docs = await this.client.listDocuments(2000)
    const byPath = new Map<string, { path: string; app?: string; lastSeen: number; count: number }>()
    for (const d of docs) {
      const md = d.metadata ?? {}
      const p = (md.path as string) ?? ''
      if (!p) continue
      if (md.source !== 'filesystem' && md.source !== 'editor') continue
      const ts = d.createdAt ? new Date(d.createdAt).getTime() : 0
      const cur = byPath.get(p) ?? { path: p, app: md.app as string, lastSeen: 0, count: 0 }
      cur.count++
      if (ts > cur.lastSeen) cur.lastSeen = ts
      byPath.set(p, cur)
    }
    return Array.from(byPath.values())
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, limit)
      .map(f => ({ path: f.path, app: f.app, lastSeen: new Date(f.lastSeen).toISOString(), count: f.count }))
  }

  async recallByProject(project: string, limit = 25): Promise<SupermemoryMemory[]> {
    const docs = await this.client.listDocuments(0)
    const matches = docs.filter(d => {
      if (this.isSummary(d)) return false
      const md = d.metadata ?? {}
      const tags = (md.tags as string[]) ?? []
      return md.project === project || tags.includes(project)
    })
    return matches.slice(0, limit)
  }

  async getTimelineRange(startDate: string, endDate: string): Promise<{ start: string; end: string; eventCount: number; events: Event[] }> {
    const startMs = new Date(startDate).getTime()
    const endMs = endDate ? new Date(endDate).getTime() : Date.now()
    const docs = await this.client.listDocuments(0)
    const events = this.docsToEvents(docs).filter(e => {
      const t = e.timestamp.getTime()
      return t >= startMs && t <= endMs
    })
    return { start: startDate, end: endDate || new Date(endMs).toISOString(), eventCount: events.length, events }
  }

  async getTopics(limit = 8): Promise<{ name: string; count: number; sample: string[] }[]> {
    const docs = await this.client.listDocuments(2000)
    const events = this.docsToEvents(docs).filter(e => !this.isSummary(e))
    const keywordEvents = new Map<string, Set<string>>()
    const keywordCount = new Map<string, number>()
    const TIME_TAGS = new Set(['morning', 'afternoon', 'night', 'code', 'document', 'command', 'error', 'browser'])

    for (const e of events) {
      const words = new Set<string>()
      const contentWords = (e.content.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? [])
      for (const w of contentWords) words.add(w)
      for (const t of (e.metadata.tags ?? [])) {
        if (!TIME_TAGS.has(t)) words.add(t.toLowerCase())
      }
      if (e.metadata.project) words.add(String(e.metadata.project).toLowerCase())
      for (const w of words) {
        keywordCount.set(w, (keywordCount.get(w) ?? 0) + 1)
        const set = keywordEvents.get(w) ?? new Set<string>()
        set.add(e.content)
        keywordEvents.set(w, set)
      }
    }

    return Array.from(keywordCount.entries())
      .filter(([w]) => !STOP_WORDS.has(w))
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({
        name,
        count,
        sample: Array.from(keywordEvents.get(name) ?? []).slice(0, 3),
      }))
  }

  async predictContext(project?: string, path?: string): Promise<{ project?: string; relatedMemories: SupermemoryMemory[]; suggestedFiles: string[] }> {
    const key = project ?? (path ? extractProject(path) : undefined)
    let relatedMemories: SupermemoryMemory[] = []
    if (key) {
      relatedMemories = await this.recallByProject(key, 15)
    } else if (path) {
      const name = path.split(/[\\/]/).pop() ?? path
      relatedMemories = (await this.client.searchQuery(name, 15)).filter(d => !this.isSummary(d))
    }
    const files = await this.getRecentFiles(20)
    const suggestedFiles = key
      ? files.filter(f => f.path.replace(/\\/g, '/').includes(key.toLowerCase())).map(f => f.path)
      : files.map(f => f.path)
    return { project: key, relatedMemories: relatedMemories.slice(0, 10), suggestedFiles: suggestedFiles.slice(0, 10) }
  }

  private summaryCache: { text: string; stats: { apps: { name: string; events: number }[]; browsers: { app: string; titles: string[] }[]; files: string[]; total: number }; expiresAt: number } | null = null

  async getSummary(since?: string): Promise<{ text: string; stats: { apps: { name: string; events: number }[]; browsers: { app: string; titles: string[] }[]; files: string[]; total: number }; cached: boolean }> {
    const now = Date.now()
    if (!since && this.summaryCache && now < this.summaryCache.expiresAt) {
      return { ...this.summaryCache, cached: true }
    }

    const docs = await this.client.listDocuments(1000)
    const windowStart = since ? new Date(since) : new Date(now - 2 * 60 * 60 * 1000)
    const recent = docs.filter(d => {
      if (this.isSummary(d)) return false
      const ts = d.createdAt ? new Date(d.createdAt) : null
      return ts && ts >= windowStart
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

    const duration = since ? 'selected period' : 'last 2 hours'
    const prompt = `The following is a raw log of the user's recent computer activity (${duration}). Summarize it in 2-4 concise, natural sentences. Mention key apps used, files worked on, and websites visited. Sound like a helpful assistant reporting what the user did.

Activity:
${events.slice(0, 60).map(e => `[${e.source}] ${e.content}${e.metadata.app ? ` (${e.metadata.app})` : ''}`).join('\n')}`

    const llmUrl = process.env.LLM_URL
    const llmModel = process.env.LLM_MODEL
    const llmApiKey = process.env.LLM_API_KEY
    let text = ''
    if (llmUrl && llmModel && llmApiKey) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        text = await this.askLLM(prompt, [], llmUrl, llmModel, llmApiKey, true, controller.signal)
        clearTimeout(timeout)
      } catch { /* timeout or error — fall through to fallback */ }
    }
    if (!text) {
      const uniqueFiles = stats.files.map(f => {
        const parts = f.replace(/\\/g, '/').split('/')
        return parts[parts.length - 1]
      }).filter(Boolean)
      const topFiles = uniqueFiles.slice(0, 3).map(f => `\`${f}\``).join(', ')

      const activeApps = stats.apps.slice(0, 3).map(a => a.name).join(', ')

      const uniquePages: string[] = []
      const seenPages = new Set<string>()
      for (const b of stats.browsers) {
        for (const t of b.titles) {
          const clean = cleanTitle(t)
          if (clean && !seenPages.has(clean.toLowerCase())) {
            seenPages.add(clean.toLowerCase())
            uniquePages.push(clean)
          }
        }
      }
      const topPages = uniquePages.slice(0, 3).map(p => `**${p}**`).join(', ')

      let summaryText = `You've been active across several apps, primarily using **${activeApps || 'development tools'}**.`
      if (uniqueFiles.length > 0) {
        summaryText += ` You spent time working on code files, including ${topFiles}.`
      }
      if (uniquePages.length > 0) {
        summaryText += ` You also browsed the web, visiting pages like ${topPages}.`
      }
      text = summaryText
    }

    this.summaryCache = { text, stats, expiresAt: now + 5 * 60 * 1000 }
    return { text, stats, cached: false }
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
    signal?: AbortSignal,
  ): Promise<string> {
    if (raw) {
      const systemPrompt = 'You are an AI assistant analyzing the user\'s computer activity log.'
      const userPrompt = query
      return this.callLLM(systemPrompt, userPrompt, [], llmUrl, llmModel, llmApiKey, signal)
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
    const context = items.slice(0, 35).join('\n')

    const hasData = memories.length > 0
    const systemPrompt = hasData
      ? 'You are a friendly personal memory assistant analyzing the user\'s activity log. Answer their question in a warm, direct, and conversational tone based ONLY on the activity data below.'
      : 'You are a helpful assistant. The user asked about their recent activity but no data is available yet.'
    const userPrompt = `Based on my recent activity, please answer: ${query}

First, give a friendly, direct, and concise one-sentence answer (under 30 words) on its own line, then a separator "---", then provide a nicely formatted detailed explanation.

Recent activity:
${context}`

    return this.callLLM(systemPrompt, userPrompt, [], llmUrl, llmModel, llmApiKey, signal)
  }

  private async callLLM(
    systemPrompt: string,
    userPrompt: string,
    history: { role: string; text: string }[],
    llmUrl: string,
    llmModel: string,
    llmApiKey?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (llmApiKey) headers['Authorization'] = `Bearer ${llmApiKey}`

      const messages: { role: string; content: string }[] = [
        { role: 'system', content: systemPrompt }
      ]

      for (const h of history) {
        messages.push({
          role: h.role === 'ai' ? 'assistant' : 'user',
          content: h.text,
        })
      }

      messages.push({ role: 'user', content: userPrompt })

      const res = await fetch(`${llmUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: llmModel,
          messages,
          stream: false,
        }),
        signal: signal ?? AbortSignal.timeout(15000),
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

  private generateLocalAnswer(query: string, memories: SupermemoryMemory[]): string {
    if (memories.length === 0) {
      return "I couldn't find any matching activity in your logs.\n---\nNo recent events matched your query."
    }

    const sorted = [...memories].sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tB - tA
    })

    const cleanQuery = query.toLowerCase()
    const seen = new Set<string>()
    const unique: SupermemoryMemory[] = []
    for (const m of sorted) {
      const rawText = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
      if (!rawText) continue
      const clean = cleanTitle(rawText).toLowerCase().trim()
      if (seen.has(clean)) continue
      seen.add(clean)
      unique.push(m)
    }

    const specificAnswer = findSpecificAnswer(cleanQuery, unique)

    const ICONS: Record<string, string> = { filesystem: '📁', browser: '🌐', editor: '✏️', terminal: '💻', system: '⚙️', media: '🎵' }

    const detailLines = unique.slice(0, 15).map(m => {
      const rawText = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
      const clean = cleanTitle(rawText)
      const src = (m.source ?? m.metadata?.source ?? 'filesystem') as string
      const icon = ICONS[src] ?? '📄'
      const relativeTime = getRelativeTime(m.createdAt)
      const app = (m.metadata?.app as string) ?? src
      return `${icon} **${clean}** (${app} · ${relativeTime})`
    }).join('\n')

    return `${specificAnswer}\n---\nHere is the timeline of matching activity:\n${detailLines}`
  }
}
