import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import type { SupermemoryClient } from '../supermemory.js'
import { createEvent, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

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
$uiLoaded = $false
function Get-BrowserUrl {
  param($hWnd)
  if (-not $uiLoaded) {
    try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop; Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop; $script:uiLoaded = $true } catch { return $null }
  }
  try {
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
    if (-not $el) { return $null }
    foreach ($id in @("omnibox","addressEditBox","urlbar-edit-view","urlbar")) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
      $found = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($found) {
        $vp = $found.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($vp -and $vp.Current.Value -match '^https?://') { return $vp.Current.Value }
      }
    }
    $editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $edits = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
    foreach ($e in $edits) {
      $vp = $null; try { $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch { continue }
      $val = $vp.Current.Value; if ($val -match '^https?://') { return $val }
    }
  } catch {}
  return $null
}
$lastFgApp = ""
$lastFgTitle = ""
$lastPsSnapshot = ""
$fgEvents = @()
$lastIdleTick = [Environment]::TickCount
$idleReported = $false
$tick = 0
while ($true) {
  $tick++
  $now = [DateTime]::UtcNow
  $epoch = [long]($now - [DateTime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc)).TotalMilliseconds
  $hwnd = [WinAPI]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [WinAPI]::GetWindowText($hwnd, $sb, 512) | Out-Null
  $title = $sb.ToString().Trim()
  $procId = [uint32]0; [WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  $app = if ($proc) { $proc.ProcessName } else { "unknown" }
  $exe = if ($proc) { $proc.MainModule.FileName } else { "" }

  # Idle detection
  $idleMs = [Environment]::TickCount - $lastIdleTick
  $isIdle = (-not $hwnd -or $hwnd -eq 0 -or (-not $app -and -not $title)) -and $idleMs -ge 300000
  if ($isIdle -and -not $idleReported) {
    $idleReported = $true
    Write-Output ('{"t":"idle_start","ts":' + $epoch + '}')
  }
  if ($isIdle) { Start-Sleep -Seconds 3; continue }

  if ($idleReported) {
    $idleReported = $false
    Write-Output ('{"t":"idle_end","ts":' + $epoch + '}')
  }
  $lastIdleTick = [Environment]::TickCount

  # Foreground changed
  $changed = ($app -ne $lastFgApp -or $title -ne $lastFgTitle)
  if ($changed) {
    $lastFgApp = $app; $lastFgTitle = $title
    $json = '{"t":"fg","app":' + (ConvertTo-Json $app -Compress) + ',"title":' + (ConvertTo-Json $title -Compress) + ',"pid":' + $procId + ',"ts":' + $epoch + '}'
    Write-Output $json
  }

  # Browser URL (every poll, not just on change — the omnibox value changes without window title changing)
  if ($app -match 'msedge|chrome|brave') {
    $url = Get-BrowserUrl -hWnd $hwnd
    if ($url) {
      $urlJson = '{"t":"browser","app":' + (ConvertTo-Json $app -Compress) + ',"title":' + (ConvertTo-Json $title -Compress) + ',"url":' + (ConvertTo-Json $url -Compress) + ',"pid":' + $procId + ',"ts":' + $epoch + '}'
      Write-Output $urlJson
    }
  }

  # Process snapshot every 10s
  if ($tick % 4 -eq 0) {
    $procs = Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object @{N="n";E={$_.ProcessName}},@{N="p";E={$_.Id}} | ConvertTo-Json -Compress
    Write-Output ('{"t":"ps","procs":' + $procs + ',"ts":' + $epoch + '}')
  }

  Start-Sleep -Seconds 3
}
`

interface PSForeground {
  t: 'fg'
  app: string
  title: string
  pid: number
  ts: number
}

interface PSBrowser {
  t: 'browser'
  app: string
  title: string
  url: string
  pid: number
  ts: number
}

interface PSProcessList {
  t: 'ps'
  procs: { n: string; p: number }[]
  ts: number
}

interface PSIdleStart {
  t: 'idle_start'
  ts: number
}

interface PSIdleEnd {
  t: 'idle_end'
  ts: number
}

type PSEvent = PSForeground | PSBrowser | PSProcessList | PSIdleStart | PSIdleEnd

export class SystemTracker {
  private client: SupermemoryClient
  private proc: ChildProcess | null = null
  private lineReader: ReturnType<typeof createInterface> | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private previousProcs: Map<number, string> = new Map()
  private browserReported: Map<string, number> = new Map()

  constructor(client: SupermemoryClient) {
    this.client = client
  }

  start(): void {
    this.spawn()
  }

  stop(): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.proc) {
      try { this.proc.kill() } catch {}
      this.proc = null
    }
    if (this.lineReader) {
      this.lineReader.close()
      this.lineReader = null
    }
  }

  private spawn(): void {
    if (this.proc) this.stop()

    logger.info('starting system tracker (persistent PowerShell)')

    this.proc = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-Command', PS_SCRIPT,
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

    this.proc.on('error', (err) => {
      logger.warn(`system tracker process error: ${err.message}`)
      this.scheduleRestart()
    })

    this.proc.on('exit', (code) => {
      logger.warn(`system tracker exited (code ${code}), restarting in 5s`)
      this.proc = null
      this.lineReader = null
      this.scheduleRestart()
    })

    this.proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      if (msg) logger.info(`[tracker] ${msg}`)
    })

    this.lineReader = createInterface({ input: this.proc.stdout!, crlfDelay: Infinity })
    this.lineReader.on('line', (line: string) => this.handleLine(line.trim()))
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      logger.info('restarting system tracker...')
      this.spawn()
    }, 5000)
  }

  private handleLine(line: string): void {
    if (!line) return
    let evt: PSEvent
    try { evt = JSON.parse(line) } catch { return }

    try {
      switch (evt.t) {
        case 'idle_start':
          this.client.addDocument(createEvent('system', 'idle_start', 'User went idle', {
            app: 'system', tags: ['system', timeBucket(new Date(evt.ts))],
          }))
          break

        case 'idle_end':
          this.client.addDocument(createEvent('system', 'idle_end', 'User returned from idle', {
            app: 'system', tags: ['system', timeBucket(new Date(evt.ts))],
          }))
          break

        case 'fg':
          this.onForeground(evt)
          break

        case 'browser':
          this.onBrowser(evt)
          break

        case 'ps':
          this.onProcessSnapshot(evt)
          break
      }
    } catch (err) {
      logger.warn(`tracker handler error: ${err}`)
    }
  }

  private onForeground(evt: PSForeground): void {
    const project = this.guessProject(evt.title, evt.app)
    const content = `${evt.app} · ${evt.title}`
    this.client.addDocument(createEvent('system', 'app_focused', content, {
      app: evt.app, title: evt.title, project,
      tags: ['system', evt.app, timeBucket(new Date(evt.ts))],
    }))
  }

  private onBrowser(evt: PSBrowser): void {
    // Debounce same-URL reports to 30s
    const key = `${evt.url}|${evt.pid}`
    const last = this.browserReported.get(key) ?? 0
    if (Date.now() - last < 30000) return
    this.browserReported.set(key, Date.now())

    this.client.addDocument(createEvent('browser', 'url_visited', evt.title || evt.url, {
      url: evt.url, title: evt.title, app: evt.app,
      tags: ['browser', evt.app, timeBucket(new Date(evt.ts))],
    }))
  }

  private onProcessSnapshot(evt: PSProcessList): void {
    const current = new Map<number, string>()
    for (const p of evt.procs) current.set(p.p, p.n)

    // Detect newly opened apps
    const prevNames = new Set(this.previousProcs.values())
    for (const [pid, name] of current) {
      if (!prevNames.has(name) && !this.previousProcs.has(pid)) {
        const project = this.guessProject('', name)
        this.client.addDocument(createEvent('system', 'app_focused', `Opened ${name}`, {
          app: name, project, tags: ['system', name, timeBucket(new Date(evt.ts))],
        }))
      }
    }

    // Detect closed apps
    for (const [pid, name] of this.previousProcs) {
      if (!current.has(pid)) {
        this.client.addDocument(createEvent('system', 'app_closed', `Closed ${name}`, {
          app: name, tags: ['system', name, timeBucket(new Date(evt.ts))],
        }))
      }
    }

    this.previousProcs = current
  }

  private guessProject(title: string, app: string): string {
    const lower = title.toLowerCase()
    if (lower.includes('code') || lower.includes('cursor') || lower.includes('vim')) return 'coding'
    if (lower.includes('terminal') || lower.includes('cmd') || lower.includes('powershell')) return 'terminal'
    return app
  }
}
