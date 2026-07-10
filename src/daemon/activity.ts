import { spawn } from 'child_process'
import type { Event } from '../types.js'
import type { SupermemoryClient } from '../supermemory.js'
import { createEvent, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

const POLL_MS = 3000
const IDLE_THRESHOLD_MS = 5 * 60 * 1000

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class WinAPI {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
try {
  $hwnd = [WinAPI]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [WinAPI]::GetWindowText($hwnd, $sb, 512) | Out-Null
  $title = $sb.ToString().Trim()
  $pid = 0
  [WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  $name = if ($proc) { $proc.ProcessName } else { "unknown" }
  $exe = if ($proc) { $proc.MainModule.FileName } else { "" }
  Write-Output "$name|$title|$exe"
} catch { Write-Output "||" }
`

interface ActiveWindow {
  app: string
  title: string
  exe: string
}

export class ActivityTracker {
  private client: SupermemoryClient
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastWindow: ActiveWindow | null = null
  private lastActivity = Date.now()
  private idleReported = false

  constructor(client: SupermemoryClient) {
    this.client = client
  }

  start(): void {
    logger.info('activity tracker started (polling every 3s)')
    this.pollTimer = setInterval(() => this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async poll(): Promise<void> {
    const now = Date.now()
    const window = await this.getActiveWindow()

    if (!window || (!window.app && !window.title)) {
      if (now - this.lastActivity > IDLE_THRESHOLD_MS && !this.idleReported) {
        this.idleReported = true
        const event = createEvent('system', 'idle_start', 'User went idle', {
          tags: ['system', timeBucket(new Date())],
          app: 'system',
          idleMs: IDLE_THRESHOLD_MS,
        })
        this.client.addDocument(event)
      }
      return
    }

    this.lastActivity = now
    if (this.idleReported) {
      this.idleReported = false
      const event = createEvent('system', 'idle_end', 'User returned from idle', {
        tags: ['system', timeBucket(new Date())],
        app: 'system',
      })
      this.client.addDocument(event)
    }

    if (!this.lastWindow || this.lastWindow.app !== window.app || this.lastWindow.title !== window.title) {
      this.lastWindow = window
      const tags = [timeBucket(new Date()), window.app]
      const project = this.guessProject(window.title)

      const details: string[] = []
      if (window.app) details.push(`App: ${window.app}`)
      if (window.title) details.push(window.title)
      const content = details.join(' · ')

      const event = createEvent('system', 'app_focused', content, {
        app: window.app,
        title: window.title,
        exe: window.exe,
        project,
        tags,
      })
      this.client.addDocument(event)

      const browserName = this.detectBrowser(window.exe)
      if (browserName && window.title) {
        const url = this.extractUrl(window.title)
        const browserEvent = createEvent('browser', url ? 'url_visited' : 'browser_focus', window.title, {
          app: browserName,
          url: url || window.title,
          title: window.title,
          tags: ['browser', browserName, timeBucket(new Date())],
        })
        this.client.addDocument(browserEvent)
      }
    }
  }

  private async getActiveWindow(): Promise<ActiveWindow | null> {
    return new Promise((resolve) => {
      const proc = spawn('powershell', ['-NoProfile', '-Command', PS_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let output = ''
      proc.stdout?.on('data', (d: Buffer) => output += d.toString())
      proc.stderr?.on('data', () => {})
      proc.on('close', () => {
        const parts = output.trim().split('|')
        if (parts.length >= 2) {
          resolve({ app: parts[0].trim(), title: parts[1].trim(), exe: parts[2]?.trim() ?? '' })
        } else {
          resolve(null)
        }
      })
      proc.on('error', () => resolve(null))
    })
  }

  private guessProject(title: string): string {
    const lower = title.toLowerCase()
    const editors = ['code', 'cursor', 'vim', 'nano', 'sublime', 'atom', 'webstorm', 'intellij', 'pycharm']
    for (const ed of editors) {
      if (lower.includes(ed)) return 'coding'
    }
    if (lower.includes('chrome') || lower.includes('edge') || lower.includes('firefox')) return 'browsing'
    if (lower.includes('terminal') || lower.includes('cmd') || lower.includes('powershell')) return 'terminal'
    return 'unknown'
  }

  private detectBrowser(exe: string): string | null {
    if (!exe) return null
    const lower = exe.toLowerCase()
    if (lower.includes('chrome')) return 'chrome'
    if (lower.includes('msedge') || lower.includes('edge')) return 'edge'
    if (lower.includes('brave')) return 'brave'
    if (lower.includes('firefox')) return 'firefox'
    if (lower.includes('opera')) return 'opera'
    return null
  }

  private extractUrl(title: string): string | null {
    const patterns = [
      /https?:\/\/[^\s]+/i,
      /[a-z0-9][-a-z0-9]*\.[a-z]{2,}[^\s]*/i,
    ]
    for (const p of patterns) {
      const m = title.match(p)
      if (m) return m[0].replace(/[)>\]]$/, '')
    }
    return null
  }
}
