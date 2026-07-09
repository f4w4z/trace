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
    const results = (await this.client.searchV4(query)).filter(d => !this.isSummary(d))
    return { query, memories: results, answer: undefined }
  }

  async queryWithLLM(query: string, llmUrl?: string, llmModel?: string, llmApiKey?: string): Promise<QueryResult> {
    const results = (await this.client.searchV4(query, 10)).filter(d => !this.isSummary(d))
    let answer: string | undefined
    if (llmUrl && llmModel) {
      answer = await this.askLLM(query, results, llmUrl, llmModel, llmApiKey)
    }
    return { query, memories: results, answer }
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
        app: 'smt',
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
  ): Promise<string> {
    const context = memories.map(m => {
      const text = m.title ?? m.memory ?? m.chunk ?? m.content ?? ''
      const path = m.metadata?.path ?? m.metadata?.url ?? ''
      return `- ${text}${path ? ` (${path})` : ''}`
    }).join('\n')

    const systemPrompt = 'You are a helpful assistant that answers questions based on the user\'s activity context. Use the provided memories to answer accurately. If the memories don\'t contain enough information, say so.'
    const userPrompt = `Based on my recent activity, please answer: ${query}\n\nMy recent memories:\n${context}`

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
      })
      if (!res.ok) {
        logger.warn(`LLM returned ${res.status}`)
        return 'LLM unavailable'
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] }
      return data.choices?.[0]?.message?.content ?? 'No response from LLM'
    } catch (err) {
      logger.error(`LLM query failed: ${err}`)
      return 'LLM unavailable'
    }
  }
}
