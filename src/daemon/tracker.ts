import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import type { SupermemoryClient } from '../supermemory.js'
import { createEvent, timeBucket } from '../utils/events.js'
import { logger } from '../utils/logger.js'

const PS_SCRIPT = `
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$loaded = $false
try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class WinAPI {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
}
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
"@
    $loaded = $true
} catch {
    Write-Host "First Add-Type failed: $_"
    Start-Sleep -Seconds 30
    try {
        Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public class WinAPI {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
}
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
"@
        $loaded = $true
    } catch {
        Write-Host "Second Add-Type failed, exiting: $_"
        exit 1
    }
}
if (-not $loaded) { exit 1 }
$uiLoaded = $false
function Get-BrowserUrl {
  param($hWnd)
  if (-not $uiLoaded) {
    try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop; Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop; $script:uiLoaded = $true } catch { return $null }
  }
  try {
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
    if (-not $el) { return $null }
    # Primary: search known automation IDs
    foreach ($id in @("omnibox","addressEditBox","urlbar-edit-view","urlbar")) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
      $found = $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($found) {
        $vp = $found.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($vp -and $vp.Current.Value -match '^https?://') { return $vp.Current.Value }
      }
    }
    # Fallback 1: any Edit control with a URL
    $editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $edits = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
    foreach ($e in $edits) {
      $vp = $null; try { $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch { continue }
      $val = $vp.Current.Value; if ($val -match '^https?://') { return $val }
    }
    # Fallback 2: Document control (used by newer Edge/Chrome)
    $docCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
    $docs = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCond)
    foreach ($d in $docs) {
      try { $vp = $d.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch { continue }
      $val = $vp.Current.Value; if ($val -match '^https?://') { return $val }
    }
  } catch {}
  return $null
}
$lastFgApp = ""
$lastFgTitle = ""
$lastMediaTitle = ""
$lastMediaApp = ""
$lastPsSnapshot = ""
$fgEvents = @()
$lastIdleTick = [Environment]::TickCount
$idleReported = $false
$tick = 0

# SMTC media helper (load once)
$smtcLoaded = $false
$smtcMgr = $null
$smtcAwait = $null
function Get-MediaInfo {
  if (-not $script:smtcLoaded) {
    try {
      Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
      $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
      $script:smtcAwait = {
        param($WinRtTask, $ResultType)
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        $netTask.Result
      }.GetNewClosure()
      [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.System,ContentType=WindowsRuntime] | Out-Null
      $script:smtcLoaded = $true
    } catch { return $null }
  }
  try {
    if (-not $script:smtcMgr) {
      $script:smtcMgr = & $script:smtcAwait ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    }
    $sessions = $script:smtcMgr.GetSessions()
    foreach ($s in $sessions) {
      $pi = $s.GetPlaybackInfo()
      if ($pi -and [int]$pi.PlaybackStatus -eq 4) {
        $props = & $script:smtcAwait $s.TryGetMediaPropertiesAsync() ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if ($props -and $props.Title) {
          $artist = if ($props.Artist) { $props.Artist } else { "" }
          $title = if ($artist) { "$artist - $($props.Title)" } else { $props.Title }
          return @{title=$title; app=$s.SourceAppUserModelId}
        }
      }
    }
  } catch { $script:smtcMgr = $null }
  return $null
}
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
    # Skip self: trace overlay + node server
    $isSelf = ($app -eq 'electron' -and $title -eq 'trace') -or ($app -eq 'node')
    if (-not $isSelf) {
      $json = '{"t":"fg","app":' + (ConvertTo-Json $app -Compress) + ',"title":' + (ConvertTo-Json $title -Compress) + ',"pid":' + $procId + ',"ts":' + $epoch + '}'
      Write-Output $json
    }
  }

  # Browser URL (every poll, not just on change — the omnibox value changes without window title changing)
  if ($app -match 'msedge|chrome|brave') {
    $url = Get-BrowserUrl -hWnd $hwnd
    if ($url) {
      $urlJson = '{"t":"browser","app":' + (ConvertTo-Json $app -Compress) + ',"title":' + (ConvertTo-Json $title -Compress) + ',"url":' + (ConvertTo-Json $url -Compress) + ',"pid":' + $procId + ',"ts":' + $epoch + '}'
      Write-Output $urlJson
    }
  }

  # Background media check via Windows SMTC (uses cached helper defined above)
  $mediaResult = Get-MediaInfo
  if ($mediaResult -and $mediaResult.title -ne $lastMediaTitle) {
    $lastMediaTitle = $mediaResult.title
    Write-Output ('{"t":"media","app":"' + $mediaResult.app + '","title":' + (ConvertTo-Json $mediaResult.title -Compress) + ',"ts":' + $epoch + '}')
  }

  # Process snapshot every 10s
  if ($tick % 4 -eq 0) {
    $procs = Get-Process | Where-Object { $_.MainWindowTitle -ne "" -and $_.ProcessName -notin @('electron','node') } | Select-Object @{N="n";E={$_.ProcessName}},@{N="p";E={$_.Id}} | ConvertTo-Json -Compress
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

interface PSMedia {
  t: 'media'
  app: string
  title: string
  ts: number
}

type PSEvent = PSForeground | PSBrowser | PSProcessList | PSIdleStart | PSIdleEnd | PSMedia

export class SystemTracker {
  private client: SupermemoryClient
  private proc: ChildProcess | null = null
  private lineReader: ReturnType<typeof createInterface> | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private previousProcs: Map<number, string> = new Map()
  private browserReported: Map<string, number> = new Map()
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
    // Max 5 restarts per minute to prevent crash loops
    const now = Date.now()
    if (now - this.restartWindowStart > 60000) {
      this.restartCount = 0
      this.restartWindowStart = now
    }
    this.restartCount++
    if (this.restartCount > 5) {
      logger.error('system tracker crashed too many times, giving up')
      return
    }
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

        case 'media':
          this.onMedia(evt)
          break
      }
    } catch (err) {
      logger.warn(`tracker handler error: ${err}`)
    }
  }

  private onForeground(evt: PSForeground): void {
    if (evt.app === 'electron' || evt.app === 'node') return
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

    const meta: Record<string, string> = { url: evt.url, title: evt.title, app: evt.app }

    // Parse search engine URLs to extract search queries
    try {
      const uri = new URL(evt.url)
      if (uri.hostname.includes('google.')) {
        const q = uri.searchParams.get('q')
        if (q) {
          meta.searchEngine = 'google'
          meta.searchQuery = q
          meta.resultType = 'search'
        }
      } else if (uri.hostname.includes('bing.')) {
        const q = uri.searchParams.get('q')
        if (q) {
          meta.searchEngine = 'bing'
          meta.searchQuery = q
          meta.resultType = 'search'
        }
      } else if (uri.hostname.includes('duckduckgo.')) {
        const q = uri.searchParams.get('q')
        if (q) {
          meta.searchEngine = 'duckduckgo'
          meta.searchQuery = q
          meta.resultType = 'search'
        }
      } else if (uri.hostname.includes('amazon.')) {
        meta.resultType = 'product'
        const q = uri.searchParams.get('k')
        if (q) meta.searchQuery = q
      } else if (uri.hostname.includes('youtube.')) {
        const q = uri.searchParams.get('search_query')
        if (q) {
          meta.searchEngine = 'youtube'
          meta.searchQuery = q
          meta.resultType = 'search'
        }
      }
    } catch {}

    this.client.addDocument(createEvent('browser', 'url_visited', meta.searchQuery ? `${meta.searchEngine} search: ${meta.searchQuery}` : (evt.title || evt.url), {
      ...meta,
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

  private mediaTitles: Map<string, string> = new Map()

  private onMedia(evt: PSMedia): void {
    const last = this.mediaTitles.get(evt.app) ?? ''
    if (evt.title === last) return
    this.mediaTitles.set(evt.app, evt.title)
    const sepIdx = evt.title.indexOf(' - ')
    const artist = sepIdx !== -1 ? evt.title.slice(0, sepIdx).trim() : ''
    const song = sepIdx !== -1 ? evt.title.slice(sepIdx + 3).trim() : evt.title
    this.client.addDocument(createEvent('media', 'track_change', `Now playing: ${evt.title}`, {
      app: evt.app, title: evt.title, artist, song,
      tags: ['media', evt.app, timeBucket(new Date(evt.ts))],
    }))
  }

  private guessProject(title: string, app: string): string {
    const lower = title.toLowerCase()
    if (lower.includes('code') || lower.includes('cursor') || lower.includes('vim')) return 'coding'
    if (lower.includes('terminal') || lower.includes('cmd') || lower.includes('powershell')) return 'terminal'
    return app
  }
}
