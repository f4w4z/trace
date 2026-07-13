import { spawn, type ChildProcess } from 'child_process'
import { execSync } from 'child_process'
import { createInterface } from 'readline'
import type { SupermemoryClient } from '../supermemory.js'
import { createEvent, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

const PLATFORM = process.platform

const PS_SCRIPT = `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$last = ""
while ($true) {
  try {
    if ([System.Windows.Forms.Clipboard]::ContainsText()) {
      $text = [System.Windows.Forms.Clipboard]::GetText()
      if ($text -and $text -ne $last) {
        $last = $text
        $epoch = [long](([DateTime]::UtcNow) - [DateTime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc)).TotalMilliseconds
        $payload = @{ t = 'clip'; text = $text; ts = $epoch } | ConvertTo-Json -Compress -Depth 1
        Write-Output $payload
      }
    }
  } catch {}
  Start-Sleep -Seconds 1
}
`

// macOS / Linux poll a clipboard command and stream the current text per line.
function posixPollCommand(): { cmd: string; args: string[] } | null {
  if (PLATFORM === 'darwin') {
    return { cmd: 'osascript', args: ['-e', 'try\nreturn (the clipboard as text)\nend try'] }
  }
  if (PLATFORM === 'linux') {
    // Prefer wl-paste (Wayland), fall back to xclip (X11)
    try { execSync('command -v wl-paste', { stdio: 'ignore' }); return { cmd: 'bash', args: ['-c', 'wl-paste --no-newline 2>/dev/null'] } } catch {}
    try { execSync('command -v xclip', { stdio: 'ignore' }); return { cmd: 'bash', args: ['-c', 'xclip -o -selection clipboard 2>/dev/null'] } } catch {}
    return null
  }
  return null
}

const SENSITIVE = [
  /password/i, /passwd/i, /pwd/i, /secret/i, /token/i, /api[_-]?key/i,
  /access[_-]?key/i, /private[_-]?key/i, /client[_-]?secret/i, /bearer\s/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bghp_\w+\b/, /\bxox[baprs]-\w+\b/, /\bAKIA[0-9A-Z]{16}\b/,
]

const MAX_LEN = 280

function redact(text: string): { text: string; redacted: boolean } {
  for (const re of SENSITIVE) {
    if (re.test(text)) return { text: '[REDACTED sensitive content]', redacted: true }
  }
  // Trim whitespace-only / very long dumps
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length > MAX_LEN) {
    return { text: trimmed.slice(0, MAX_LEN) + '…', redacted: false }
  }
  return { text: trimmed, redacted: false }
}

export class ClipboardWatcher {
  private client: SupermemoryClient
  private proc: ChildProcess | null = null
  private lineReader: ReturnType<typeof createInterface> | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartCount = 0
  private restartWindowStart = 0

  constructor(client: SupermemoryClient) {
    this.client = client
  }

  start(): void {
    this.spawn()
  }

  stop(): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.proc) { try { this.proc.kill() } catch {} this.proc = null }
    if (this.lineReader) { this.lineReader.close(); this.lineReader = null }
  }

  private spawn(): void {
    if (this.proc) this.stop()

    if (PLATFORM === 'win32') {
      logger.info('starting clipboard watcher (Windows PowerShell)')
      this.proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      })
      this.proc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim()
        if (msg) logger.debug(`[clipboard] ${msg}`)
      })
      this.lineReader = createInterface({ input: this.proc.stdout!, crlfDelay: Infinity })
      this.lineReader.on('line', (line: string) => this.handleLine(line.trim()))
    } else {
      const poll = posixPollCommand()
      if (!poll) {
        logger.warn('clipboard watcher: no clipboard tool found (need wl-paste/xclip on Linux or osascript on macOS) — disabled')
        return
      }
      logger.info(`starting clipboard watcher (${poll.cmd})`)
      this.proc = spawn(poll.cmd, poll.args, { stdio: ['ignore', 'pipe', 'pipe'] })
      this.proc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim()
        if (msg) logger.debug(`[clipboard] ${msg}`)
      })
      this.lineReader = createInterface({ input: this.proc.stdout!, crlfDelay: Infinity })
      this.lineReader.on('line', (line: string) => this.handlePosixLine(line))
    }

    this.proc.on('error', (err) => {
      logger.warn(`clipboard watcher error: ${err.message}`)
      this.scheduleRestart()
    })
    this.proc.on('exit', (code) => {
      logger.warn(`clipboard watcher exited (code ${code}), restarting in 5s`)
      this.proc = null
      this.lineReader = null
      this.scheduleRestart()
    })
  }

  private handlePosixLine(text: string): void {
    if (!text) return
    const { text: out, redacted: isRedacted } = redact(text)
    if (!out) return
    this.client.addDocument(createEvent('clipboard', 'clipboard_copy', `Copied: ${out}`, {
      app: 'clipboard',
      charCount: text.length,
      redacted: isRedacted,
      tags: ['clipboard', timeBucket(new Date())],
    }))
  }

  private scheduleRestart(): void {
    const now = Date.now()
    if (now - this.restartWindowStart > 60000) {
      this.restartCount = 0
      this.restartWindowStart = now
    }
    this.restartCount++
    if (this.restartCount > 5) {
      logger.error('clipboard watcher crashed too many times, giving up')
      return
    }
    if (this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawn()
    }, 5000)
  }

  private handleLine(line: string): void {
    if (!line) return
    let evt: { t: 'clip'; text: string; ts: number }
    try { evt = JSON.parse(line) } catch { return }

    const { text, redacted } = redact(evt.text)
    if (!text) return
    this.client.addDocument(createEvent('clipboard', 'clipboard_copy', `Copied: ${text}`, {
      app: 'clipboard',
      charCount: evt.text.length,
      redacted,
      tags: ['clipboard', timeBucket(new Date(evt.ts))],
    }))
  }

  static redact = redact
}
