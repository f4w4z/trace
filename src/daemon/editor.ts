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

    this.gitDirs = gitDirs

    logger.info(`watching ${gitDirs.length} git repos for commits/branches`)

    this.watcher = chokidar.watch(
      gitDirs.flatMap(d => [
        path.join(d, '.git', 'HEAD'),
        path.join(d, '.git', 'logs', 'HEAD'),
      ]),
      { persistent: true, ignoreInitial: true },
    )

    this.watcher.on('change', (p: string) => {
      const repoPath = path.dirname(path.dirname(p))
      if (p.endsWith(path.join('.git', 'HEAD'))) {
        // HEAD content changed: this is a branch switch or a fresh checkout
        const branch = this.readBranch(repoPath)
        if (branch && branch !== this.lastBranch.get(repoPath)) {
          this.lastBranch.set(repoPath, branch)
          const project = path.basename(repoPath)
          this.client.addDocument(createEvent('editor', 'branch_switch', `Switched to branch ${branch} in ${project}`, {
            app: 'git', project, branch, tags: [project, branch, timeBucket(new Date())],
          }))
        }
        this.checkNewCommits(repoPath)
      } else {
        // reflog change: capture commit message + detect branch switches
        this.checkNewCommits(repoPath)
      }
    })

    // Seed current branch state so the first switch is detected cleanly
    for (const d of gitDirs) {
      this.lastBranch.set(d, this.readBranch(d))
    }
  }

  private gitDirs: string[] = []
  private lastBranch = new Map<string, string | undefined>()
  private seenReflogOffsets = new Map<string, number>()

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

  private readBranch(repoPath: string): string | undefined {
    try {
      const headPath = path.join(repoPath, '.git', 'HEAD')
      const refContent = fs.readFileSync(headPath, 'utf-8').trim()
      const refMatch = refContent.match(/^ref:\s+refs\/heads\/(.+)/)
      return refMatch ? refMatch[1] : '(detached)'
    } catch { return undefined }
  }

  private readLastCommitMessage(repoPath: string): string | null {
    try {
      const reflogPath = path.join(repoPath, '.git', 'logs', 'HEAD')
      if (!fs.existsSync(reflogPath)) return null
      const lines = fs.readFileSync(reflogPath, 'utf-8').split('\n').filter(Boolean)
      for (let i = lines.length - 1; i >= 0; i--) {
        const parts = lines[i].split('\t')
        if (parts.length >= 2) {
          const msg = parts[1].replace(/^.*?:\s*/, '').trim()
          if (msg && !msg.startsWith('checkout:')) return msg
        }
      }
    } catch { /* ignore */ }
    return null
  }

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
      if (!currentHead || this.seenCommits.has(currentHead)) return
      this.seenCommits.add(currentHead)

      const project = path.basename(repoPath)
      const branch = this.readBranch(repoPath) ?? 'HEAD'
      const message = this.readLastCommitMessage(repoPath) ?? ''
      const event = createEvent('editor', 'commit_made', message
        ? `Commit in ${project}/${branch}: ${message} (${currentHead.slice(0, 7)})`
        : `New commit in ${project}/${branch}: ${currentHead.slice(0, 7)}`, {
        app: 'git',
        project,
        branch,
        commit: currentHead.slice(0, 40),
        message,
        tags: [project, branch, timeBucket(new Date())],
      })

      this.client.addDocument(event)
    } catch { /* ignore */ }
  }
}
