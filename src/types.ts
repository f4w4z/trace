export type EventSource = 'filesystem' | 'browser' | 'editor' | 'terminal' | 'system'

export type EventType =
  | 'file_opened'
  | 'file_edited'
  | 'url_visited'
  | 'page_summary'
  | 'project_opened'
  | 'commit_made'
  | 'command_run'
  | 'error_logged'

export interface Event {
  id?: string
  source: EventSource
  type: EventType
  content: string
  metadata: EventMetadata
  timestamp: Date
}

export interface EventMetadata {
  path?: string
  url?: string
  title?: string
  app?: string
  project?: string
  tags?: string[]
  shell?: string
  exitCode?: number
  [key: string]: unknown
}

export interface SupermemoryMemory {
  id?: string
  title?: string
  content?: string
  memory?: string
  chunk?: string
  source?: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  similarity?: number
}

export interface Session {
  id: string
  project: string
  startTime: Date
  endTime: Date
  events: Event[]
  summary: string
  tags: string[]
}

export interface DayContext {
  date: string
  sessions: Session[]
  eventCount: number
  summary: string
}

export interface CurrentContext {
  activeSession: Session | null
  recentEvents: Event[]
  activeProject: string | null
}

export interface QueryResult {
  query: string
  memories: SupermemoryMemory[]
  answer?: string
}

export interface MCPToolRequest {
  tool: string
  args: Record<string, unknown>
}

export interface MCPToolResponse {
  tool: string
  result: unknown
  error?: string
}

export interface Config {
  supermemoryUrl: string
  apiKey: string
  containerTag: string
  watchSources: EventSource[]
  watchPaths: string[]
  chromeHistory: string
  edgeHistory: string
  braveHistory: string
  shellHistory: string
  apiPort: number
  hudPort: number
  llmUrl?: string
  llmModel?: string
  llmApiKey?: string
}
