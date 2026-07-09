import type { SupermemoryClient } from '../supermemory.js'
import type { Config } from '../types.js'
import { logger } from '../utils/logger.js'
import { FilesystemWatcher } from './filesystem.js'
import { BrowserWatcher } from './browser.js'
import { EditorWatcher } from './editor.js'
import { TerminalWatcher } from './terminal.js'

export class Daemon {
  private config: Config
  private client: SupermemoryClient
  private filesystem: FilesystemWatcher
  private browser: BrowserWatcher
  private editor: EditorWatcher
  private terminal: TerminalWatcher
  private running = false

  constructor(config: Config, client: SupermemoryClient) {
    this.config = config
    this.client = client
    this.filesystem = new FilesystemWatcher(client)
    this.browser = new BrowserWatcher(client)
    this.editor = new EditorWatcher(client)
    this.terminal = new TerminalWatcher(client)
  }

  start(): void {
    if (this.running) return
    this.running = true

    logger.info(`daemon starting — containerTag: ${this.config.containerTag}`)
    logger.info(`sources: ${this.config.watchSources.join(', ')}`)

    if (this.config.watchSources.includes('filesystem')) {
      this.filesystem.start(this.config.watchPaths)
    }
    if (this.config.watchSources.includes('browser')) {
      this.browser.start(
        { name: 'chrome', historyPath: this.config.chromeHistory },
        { name: 'edge', historyPath: this.config.edgeHistory },
        { name: 'brave', historyPath: this.config.braveHistory },
      )
    }
    if (this.config.watchSources.includes('editor')) {
      this.editor.start(this.config.watchPaths)
    }
    if (this.config.watchSources.includes('terminal')) {
      this.terminal.start(this.config.shellHistory)
    }

    logger.info('daemon running')
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    logger.info('stopping daemon...')
    this.filesystem.stop()
    this.browser.stop()
    this.editor.stop()
    this.terminal.stop()
    logger.info('daemon stopped')
  }

  isRunning(): boolean {
    return this.running
  }
}
