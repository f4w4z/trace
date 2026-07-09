import chokidar, { FSWatcher } from 'chokidar'
import path from 'path'
import type { Event } from '../types.js'
import type { SupermemoryClient } from '../supermemory.js'
import { createEvent, extractProject, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

export class FilesystemWatcher {
  private client: SupermemoryClient
  private watcher: FSWatcher | null = null
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()

  constructor(client: SupermemoryClient) {
    this.client = client
  }

  start(paths: string[]): void {
    logger.info(`watching paths: ${paths.join(', ')}`)

    this.watcher = chokidar.watch(paths, {
      ignored: /(node_modules|\.git|__pycache__|\.next|dist|build|\.venv|My Music|My Videos|My Pictures|AppData)/,
      persistent: true,
      ignoreInitial: true,
      depth: 6,
    })

    this.watcher
      .on('add', (p: string) => this.handleEvent('file_opened', p))
      .on('change', (p: string) => this.handleEvent('file_edited', p))
      .on('error', (err: unknown) => logger.error(`watcher error: ${err}`))
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    for (const t of this.debounceTimers.values()) clearTimeout(t)
    this.debounceTimers.clear()
  }

  private handleEvent(type: 'file_opened' | 'file_edited', filePath: string): void {
    const key = `${type}:${filePath}`
    if (this.debounceTimers.has(key)) return

    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key)
    }, 5000))

    const ext = path.extname(filePath).toLowerCase()
    const isCode = /\.(ts|js|tsx|jsx|py|rs|go|c|cpp|java|rb|php|swift|kt|scala|ex|exs)$/.test(ext)
    const isDoc = /\.(md|txt|docx?|pdf|pptx?|xlsx?|csv)$/.test(ext)

    const tags: string[] = [timeBucket(new Date())]
    if (isCode) tags.push('code')
    if (isDoc) tags.push('document')

    const project = extractProject(filePath)
    if (project) tags.push(project)

    const event = createEvent('filesystem', type, `${type === 'file_opened' ? 'Opened' : 'Edited'} ${path.basename(filePath)}`, {
      path: filePath,
      app: ext === '.md' ? 'markdown' : 'code',
      project,
      tags,
    })

    this.client.addDocument(event)
  }
}
