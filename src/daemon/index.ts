import type { SupermemoryClient } from '../supermemory.js'
import type { Config } from '../types.js'
import { logger } from '../utils/logger.js'
import { FilesystemWatcher } from './filesystem.js'
import { EditorWatcher } from './editor.js'
import { TerminalWatcher } from './terminal.js'
import { SystemTracker } from './tracker.js'
import { ClipboardWatcher } from './clipboard.js'
import { BrowserHistoryWatcher } from './browser.js'

export class Daemon {
  private config: Config
  private client: SupermemoryClient
  private filesystem: FilesystemWatcher
  private editor: EditorWatcher
  private terminal: TerminalWatcher
  private tracker: SystemTracker
  private clipboard: ClipboardWatcher
  private browser: BrowserHistoryWatcher
  private running = false

  constructor(config: Config, client: SupermemoryClient) {
    this.config = config
    this.client = client
    this.filesystem = new FilesystemWatcher(client)
    this.editor = new EditorWatcher(client)
    this.terminal = new TerminalWatcher(client)
    this.tracker = new SystemTracker(client)
    this.clipboard = new ClipboardWatcher(client)
    this.browser = new BrowserHistoryWatcher(client, config)
  }

  start(): void {
    if (this.running) return
    this.running = true

    logger.info(`daemon starting — containerTag: ${this.config.containerTag}`)
    logger.info(`sources: ${this.config.watchSources.join(', ')}`)

    this.tracker.start()

    if (this.config.watchSources.includes('filesystem')) {
      this.filesystem.start(this.config.watchPaths)
    }
    if (this.config.watchSources.includes('editor')) {
      this.editor.start(this.config.watchPaths)
    }
    if (this.config.watchSources.includes('terminal')) {
      this.terminal.start(this.config.shellHistory)
    }
    if (this.config.watchSources.includes('clipboard')) {
      this.clipboard.start()
    }
    if (this.config.watchSources.includes('browser')) {
      logger.info('browser tracking is always active via system tracker')
      this.browser.backfill().catch(err => logger.warn(`browser backfill error: ${err}`))
    }

    logger.info('daemon running')
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    logger.info('stopping daemon...')
    this.tracker.stop()
    this.filesystem.stop()
    this.editor.stop()
    this.terminal.stop()
    this.clipboard.stop()
    logger.info('daemon stopped')
  }

  isRunning(): boolean {
    return this.running
  }
}
