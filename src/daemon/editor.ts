import fs from 'fs'
import path from 'path'
import chokidar, { FSWatcher } from 'chokidar'
import type { Event } from '../types.js'
import type { SupermemoryClient } from '../supermemory.js'
import { createEvent, extractProject, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

export class EditorWatcher {
  private client: SupermemoryClient
  private watcher: FSWatcher | null = null
  private watchedRepos = new Set<string>()

  constructor(client: SupermemoryClient) {
    this.client = client
  }

  start(dirs: string[]): void {
    const gitDirs: string[] = []
    for (const dir of dirs) {
      if (fs.existsSync(dir)) {
        this.scanGitDirs(dir, gitDirs, 3)
      }
    }

    if (gitDirs.length === 0) {
      logger.info('no git repos found, editor watcher idle')
      return
    }

    logger.info(`watching ${gitDirs.length} git repos for commits`)

    this.watcher = chokidar.watch(
      gitDirs.map(d => path.join(d, '.git', 'HEAD')),
      { persistent: true, ignoreInitial: true },
    )

    this.watcher.on('change', (p: string) => {
      const repoPath = path.dirname(path.dirname(p))
      this.checkNewCommits(repoPath)
    })
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  private scanGitDirs(dir: string, acc: string[], depth: number): void {
    if (depth <= 0) return
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) {
          if (e.name === '.git') {
            acc.push(dir)
          } else if (!e.name.startsWith('.') && e.name !== 'node_modules') {
            this.scanGitDirs(path.join(dir, e.name), acc, depth - 1)
          }
        }
      }
    } catch { /* permission denied */ }
  }

  private seenCommits = new Set<string>()

  private checkNewCommits(repoPath: string): void {
    const gitDir = path.join(repoPath, '.git')
    const headPath = path.join(gitDir, 'HEAD')

    try {
      const refContent = fs.readFileSync(headPath, 'utf-8').trim()
      const refMatch = refContent.match(/^ref:\s+(.+)/)
      if (!refMatch) return

      const refPath = path.join(gitDir, refMatch[1].replace(/\//g, '\\'))
      if (!fs.existsSync(refPath)) return

      const currentHead = fs.readFileSync(refPath, 'utf-8').trim()
      if (this.seenCommits.has(currentHead)) return
      this.seenCommits.add(currentHead)

      const project = path.basename(repoPath)
      const event = createEvent('editor', 'commit_made', `New commit in ${project}: ${currentHead.slice(0, 7)}`, {
        app: 'git',
        project,
        tags: [project, timeBucket(new Date())],
      })

      this.client.addDocument(event)
    } catch { /* ignore */ }
  }
}
