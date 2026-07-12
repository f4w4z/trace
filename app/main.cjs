const { app, globalShortcut, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, shell } = require('electron')
const { spawn, fork } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const net = require('net')

const isPackaged = app.isPackaged
const API_PORT = 6768

// __dirname works in both dev and packaged (asar) — Electron patches fs for asar reads
const SERVER_SCRIPT = path.join(__dirname, '..', 'dist', 'index.js').replace(/\\/g, '/')

// Writable paths — logs and config go to userData in packaged mode
const logDir = isPackaged ? app.getPath('userData') : path.join(__dirname, '..')
const backendLogPath = path.join(logDir, 'backend.log')
const supermemoryLogPath = path.join(logDir, 'supermemory.log')

// In packaged mode, load .env from userData so user config persists across updates
if (isPackaged) {
  const userEnv = path.join(app.getPath('userData'), '.env')
  if (!fs.existsSync(userEnv)) {
    const bundledEnv = path.join(process.resourcesPath, '.env.example')
    if (fs.existsSync(bundledEnv)) fs.copyFileSync(bundledEnv, userEnv)
  }
  if (fs.existsSync(userEnv)) {
    require('dotenv').config({ path: userEnv })
  }
}

let win = null
let tray = null
let serverProcess = null
let startupComplete = false

function checkPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => {
      resolve(false)
    })
    socket.connect(port, host)
  })
}

function killPort(port) {
  return new Promise((resolve) => {
    const proc = spawn('cmd', [
      '/c',
      `for /f "tokens=5" %a in ('netstat -ano ^| findstr ":${port} "') do taskkill /f /pid %a`
    ], { stdio: 'ignore', windowsHide: true })
    proc.on('close', () => resolve())
    proc.on('error', () => resolve())
  })
}

let wslIp = ''

const WSL_DISTRO = 'trace-vm'
const VM_DIR = isPackaged
  ? path.join('C:\\ProgramData', 'Trace', 'vm')
  : path.join(os.homedir(), '.trace', 'vm')
const TARBALL = isPackaged
  ? path.join(process.resourcesPath, 'supermemory-ubuntu.tar.gz')
  : path.join(__dirname, '..', 'build', 'supermemory-ubuntu.tar.gz')

function execCommand(cmd, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const proc = spawn('cmd', ['/c', cmd], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let out = ''
    let done = false
    proc.stdout.on('data', (d) => { out += d.toString() })
    const timer = setTimeout(() => {
      if (!done) { done = true; proc.kill(); resolve(out.trim()) }
    }, timeoutMs)
    proc.on('close', () => { if (!done) { done = true; clearTimeout(timer); resolve(out.trim()) } })
    proc.on('error', () => { if (!done) { done = true; clearTimeout(timer); resolve('') } })
  })
}

function execCommandLong(cmd, timeoutMs = 120000) {
  return execCommand(cmd, timeoutMs)
}

async function isWslInstalled() {
  try {
    const feature = await execCommand('powershell -NoProfile -Command "Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux | Select -Expand State"')
    return feature === 'Enabled'
  } catch { return false }
}

async function isDistroRegistered(name) {
  const list = await execCommand('wsl -l -q')
  if (!list) return false
  return list.split(/\r?\n/).some(line => line.trim() === name)
}

async function importDistro(splashWindow) {
  const update = (msg) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('status-update', { statusText: msg })
    }
  }

  console.log(`wsl: importing ${WSL_DISTRO} from ${TARBALL}`)

  // Ensure VM directory exists
  if (!fs.existsSync(VM_DIR)) fs.mkdirSync(VM_DIR, { recursive: true })

  // Remove old distro if it exists but is broken
  await execCommand(`wsl --unregister ${WSL_DISTRO}`, 30000)

  update('Importing Supermemory image (first time only)...')

  // Import — this extracts the tarball into a new WSL distro
  const result = await execCommandLong(
    `wsl --import ${WSL_DISTRO} "${VM_DIR}" "${TARBALL}"`,
    180000
  )

  console.log(`wsl: import result: ${result}`)

  // Verify it worked
  const registered = await isDistroRegistered(WSL_DISTRO)
  if (!registered) {
    throw new Error(`WSL import failed: ${result}`)
  }

  console.log(`wsl: ${WSL_DISTRO} imported successfully`)
}

async function startSupermemory(splashWindow) {
  // Kill any existing instance
  await execCommand(`wsl -d ${WSL_DISTRO} -u root -- pkill -9 -f supermemory-server`, 5000)

  const logPath = isPackaged ? supermemoryLogPath : path.join(__dirname, '..', 'supermemory.log')
  const wslLogPath = logPath.replace(/\\/g, '/')
  // Convert Windows path to WSL mount path (C:\foo -> /mnt/c/foo)
  const wslMountLog = wslLogPath.replace(/^([A-Za-z]):\//, (_, drive) => `/mnt/${drive.toLowerCase()}/`)

  const cmd = `wsl -d ${WSL_DISTRO} -u root -- bash -c "export SUPERMEMORY_NO_PROMPT=1; export OPENAI_API_KEY=dummy; /root/.supermemory/bin/supermemory-server 2>&1 | tee ${wslMountLog}"`
  spawn('cmd', ['/c', cmd], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref()
}

async function detectWslIp() {
  for (let i = 0; i < 10; i++) {
    const ip = await execCommand(`wsl -d ${WSL_DISTRO} hostname -I`)
    if (ip) { wslIp = ip; console.log(`wsl: detected IP ${wslIp}`); return wslIp }
    await new Promise(r => setTimeout(r, 2000))
  }
  console.log('wsl: could not detect IP')
  return ''
}

async function waitForSupermemory() {
  // 120 iterations × 500ms = 60s timeout (first boot can be slow)
  return new Promise(async (resolve) => {
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (await checkPortOpen(6767, wslIp || '127.0.0.1')) { resolve(true); return }
    }
    resolve(false)
  })
}

function pollSupermemoryLogs(splashWindow) {
  let lastLogs = ''
  const interval = setInterval(() => {
    if (!splashWindow || splashWindow.isDestroyed()) { clearInterval(interval); return }
    const logs = readLastLogLines()
    if (logs && logs !== lastLogs) {
      lastLogs = logs
      splashWindow.webContents.send('status-update', { logs })
    }
  }, 1000)
  return interval
}

async function runServicesStartup(splashWindow) {
  const update = (steps, statusText, progress) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('status-update', { steps, statusText, progress })
    }
  }

  // 1. Port prep
  update({ env: 'active' }, 'Preparing network ports...', 5)
  await killPort(6768)
  await new Promise(r => setTimeout(r, 500))

  // 2. Ensure WSL is installed
  update({ env: 'active' }, 'Checking WSL...', 10)
  const wslReady = await isWslInstalled()
  if (!wslReady) {
    update({ env: 'error' }, 'WSL not found. Please install WSL and restart.', 10)
    return
  }

  // 3. Ensure the trace-vm distro is registered (auto-import on first run)
  const hasDistro = await isDistroRegistered(WSL_DISTRO)
  if (!hasDistro) {
    try {
      update({ env: 'active' }, 'Setting up Supermemory (first time — one moment)...', 15)
      await importDistro(splashWindow)
    } catch (err) {
      console.error('wsl: import failed:', err.message)
      update({ env: 'error' }, `WSL import failed: ${err.message}`, 15)
      return
    }
  }
  update({ env: 'done' }, 'WSL ready', 25)

  // 4. Detect WSL IP for direct connection
  if (!wslIp) await detectWslIp()

  // 5. Start Supermemory inside the distro
  update({ db: 'active' }, 'Starting Supermemory Local...', 40)
  await startSupermemory(splashWindow)

  // 6. Wait for Supermemory to be reachable
  const logInterval = pollSupermemoryLogs(splashWindow)
  const dbUp = await waitForSupermemory()
  clearInterval(logInterval)
  const finalLogs = readLastLogLines()
  if (finalLogs && splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('status-update', { logs: finalLogs })
  }

  if (dbUp) {
    update({ db: 'done', daemon: 'active' }, 'Starting context daemon...', 70)
  } else {
    update({ db: 'error', daemon: 'active' }, 'Supermemory unavailable. Starting degraded...', 70)
  }

  // 7. Start backend daemon
  const currentSettings = loadSettings()
  const needsOnboarding = !currentSettings || !currentSettings.onboarded || !currentSettings.name
  const readyMsg = needsOnboarding ? 'Starting onboarding wizard...' : 'Trace is active in tray! Press Alt+X to search.'

  const daemonStarted = await ensureServer()
  if (daemonStarted) {
    update({ db: dbUp ? 'done' : 'error', daemon: 'done' }, readyMsg, 100)
  } else {
    update({ db: dbUp ? 'done' : 'error', daemon: 'error' }, 'Trace daemon failed to start.', 100)
  }

  await new Promise(r => setTimeout(r, 1500))
}

function readLastLogLines() {
  try {
    const logPath = supermemoryLogPath
    if (!fs.existsSync(logPath)) return ''
    const content = fs.readFileSync(logPath, 'utf8')
    const lines = content.split('\n')
    const filtered = lines
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => !line.includes('[better-auth/magic-link]'))
    return filtered.slice(-15).join('\n')
  } catch (err) {
    return `Error reading logs: ${err.message}`
  }
}

let settingsPath = null
function getSettingsPath() {
  if (!settingsPath) settingsPath = path.join(app.getPath('userData'), 'settings.json')
  return settingsPath
}

function loadSettings() {
  try {
    const p = getSettingsPath()
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch { return null }
}

function saveSettings(s) {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(s, null, 2), 'utf-8')
    return true
  } catch { return false }
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      win.show()
    }
  })
}

function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${API_PORT}/health`, (res) => {
      let data = ''
      res.on('data', (c) => data += c)
      res.on('end', () => resolve(true))
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => { req.destroy(); resolve(false) })
  })
}

async function ensureServer() {
  const running = await isServerRunning()
  if (running) return true
  console.log('starting trace server...')
  
  const env = { ...process.env, SUPERMEMORY_URL: wslIp ? `http://${wslIp}:6767` : undefined }

  try {
    const logStream = fs.createWriteStream(backendLogPath, { flags: 'a' })
    
    if (isPackaged) {
      // In packaged app, fork() uses Electron's bundled Node.js runtime
      serverProcess = fork(SERVER_SCRIPT, {
        silent: true,
        env,
      })
      serverProcess.stdout.pipe(logStream)
      serverProcess.stderr.pipe(logStream)
    } else {
      serverProcess = spawn('node', [SERVER_SCRIPT], {
        detached: false,
        windowsHide: true,
        env,
      })
      serverProcess.stdout.pipe(logStream)
      serverProcess.stderr.pipe(logStream)
    }
  } catch (err) {
    console.error('Failed to create backend.log write stream:', err.message)
    if (isPackaged) {
      serverProcess = fork(SERVER_SCRIPT, { silent: true, env })
    } else {
      serverProcess = spawn('node', [SERVER_SCRIPT], {
        stdio: 'ignore',
        detached: false,
        windowsHide: true,
        env,
      })
    }
  }

  // wait for it to be ready
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await isServerRunning()) return true
  }
  console.error('trace server failed to start')
  return false
}

let splash = null

function createSplashWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const splashWidth = Math.min(700, width - 100)
  const splashHeight = Math.min(500, height - 200)

  const settings = loadSettings()
  const logoName = (settings && settings.theme === 'light') ? 'logo-lightmode.png' : 'logo-darkmode.png'
  const iconPath = path.join(__dirname, 'assets', logoName)

  splash = new BrowserWindow({
    width: splashWidth,
    height: splashHeight,
    x: Math.round((width - splashWidth) / 2),
    y: Math.round(height * 0.1),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    thickFrame: false,
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  splash.setBackgroundColor('#00000000')
  splash.loadFile(path.join(__dirname, 'splash.html'))
  
  splash.once('ready-to-show', () => {
    splash.show()
  })

  splash.on('closed', () => { splash = null })
}

function createWindow(showOnStart) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const winWidth = Math.min(700, width - 100)
  const winHeight = Math.min(500, height - 200)

  const settings = loadSettings()
  const logoName = (settings && settings.theme === 'light') ? 'logo-lightmode.png' : 'logo-darkmode.png'
  const iconPath = path.join(__dirname, 'assets', logoName)

  win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: Math.round((width - winWidth) / 2),
    y: Math.round(height * 0.1),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    thickFrame: false,
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.setBackgroundColor('#00000000')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.loadFile(path.join(__dirname, 'index.html'))

  if (showOnStart) {
    win.once('ready-to-show', () => { win.show(); win.focus() })
  }

  let blurTimer = null
  win.on('blur', () => {
    if (blurTimer) return
    blurTimer = setTimeout(() => {
      blurTimer = null
      if (win && win.isVisible()) {
        win.webContents.send('blur-hide')
      }
    }, 300)
  })
  win.on('focus', () => {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
  })

  win.on('closed', () => { win = null })
}

function toggleWindow() {
  if (!win) createWindow()
  if (win.isVisible()) {
    win.hide()
  } else {
    win.show()
    win.focus()
    win.webContents.send('focus-search')
  }
}

function createTray(theme) {
  const isLight = theme === 'light'
  const logoName = isLight ? 'logo-lightmode.png' : 'logo-darkmode.png'
  const iconPath = path.join(__dirname, 'assets', logoName)
  let icon
  try { icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) } catch {}
  if (!icon || icon.isEmpty()) icon = nativeImage.createEmpty()
  
  if (tray) {
    tray.setImage(icon)
  } else {
    tray = new Tray(icon)
    tray.setToolTip('trace — Context Search')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show (Alt+X)', click: toggleWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true
          app.quit()
        },
      },
    ]))
    tray.on('click', toggleWindow)
  }
}

app.whenReady().then(async () => {
  const isHidden = process.argv.includes('--hidden')

  if (!isHidden) {
    createSplashWindow()
    // Let the splash window finish loading its HTML and DOM
    await new Promise(r => setTimeout(r, 600))
  }

  const settings = loadSettings()

  // Enforce correct startup registry configuration on boot
  if (settings && settings.runAtStartup) {
    try {
      const execPath = process.env.APP_EXEC_PATH || process.execPath
      const args = []
      if (!app.isPackaged) {
        args.push(path.resolve(__dirname, 'main.cjs'))
      }
      args.push('--hidden')
      app.setLoginItemSettings({
        openAtLogin: true,
        path: execPath,
        args: args,
        name: 'Trace',
      })
    } catch (err) {
      console.error('Failed to auto-apply login item settings:', err.message)
    }
  }

  // Register ALL IPC handlers before ensureServer so renderer can use them immediately
  const registered = globalShortcut.register('Alt+X', toggleWindow)
  if (!registered) {
    console.error('Alt+X shortcut registration failed, trying Alt+Space...')
    globalShortcut.register('Alt+Space', toggleWindow)
  }

  ipcMain.handle('open-url', async (_, url) => {
    if (url && !url.startsWith('file://')) shell.openExternal(url)
  })

  ipcMain.handle('get-username', () => process.env.USERNAME || 'there')

  ipcMain.handle('get-supermemory-status', async () => {
    const online = await checkPortOpen(6767, wslIp || '127.0.0.1')
    if (online) {
      return { status: 'online' }
    } else {
      const logs = readLastLogLines()
      return { status: 'starting', logs }
    }
  })

  ipcMain.handle('get-settings', async () => loadSettings())

  ipcMain.handle('save-settings', async (_, settings) => {
    const success = saveSettings(settings)
    if (success && settings && settings.theme) {
      createTray(settings.theme)
      if (win) {
        const logoName = settings.theme === 'light' ? 'logo-lightmode.png' : 'logo-darkmode.png'
        const iconPath = path.join(__dirname, 'assets', logoName)
        try { win.setIcon(nativeImage.createFromPath(iconPath)) } catch {}
      }
    }
    return success
  })

  ipcMain.handle('set-run-at-startup', async (_, enable) => {
    try {
      const execPath = process.env.APP_EXEC_PATH || process.execPath
      const args = []
      if (!app.isPackaged) {
        args.push(path.resolve(__dirname, 'main.cjs'))
      }
      app.setLoginItemSettings({
        openAtLogin: enable,
        path: execPath,
        args: args,
        name: 'Trace',
      })
      return true
    } catch (err) {
      console.error('run-at-startup failed:', err.message)
      return false
    }
  })

  ipcMain.handle('get-icon', () => {
    const settings = loadSettings()
    const theme = settings ? settings.theme : 'dark'
    const logoName = theme === 'light' ? 'logo-lightmode.png' : 'logo-darkmode.png'
    const iconPath = path.join(__dirname, 'assets', logoName)
    try {
      const data = fs.readFileSync(iconPath)
      return `data:image/png;base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.on('hide-window', () => {
    if (win && win.isVisible()) win.hide()
  })

  const convPath = path.join(app.getPath('userData'), 'conversations.json')

  function loadConvs() {
    try {
      if (!fs.existsSync(convPath)) return { conversations: [], activeId: null }
      return JSON.parse(fs.readFileSync(convPath, 'utf-8'))
    } catch { return { conversations: [], activeId: null } }
  }

  function saveConvs(data) {
    try { fs.writeFileSync(convPath, JSON.stringify(data), 'utf-8'); return true }
    catch { return false }
  }

  ipcMain.handle('conversations-list', async () => {
    const data = loadConvs()
    return data.conversations.map(c => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      messageCount: c.messages.length,
      preview: c.messages.length > 0 ? (c.messages[0].text || '').slice(0, 80) : '',
    }))
  })

  ipcMain.handle('conversation-get', async (_, id) => {
    const data = loadConvs()
    const conv = data.conversations.find(c => c.id === id)
    return conv || null
  })

  ipcMain.handle('conversation-save', async (_, conv) => {
    const data = loadConvs()
    const idx = data.conversations.findIndex(c => c.id === conv.id)
    conv.updatedAt = new Date().toISOString()
    if (idx >= 0) {
      data.conversations[idx] = conv
    } else {
      data.conversations.unshift(conv)
    }
    if (data.conversations.length > 50) {
      data.conversations = data.conversations.slice(0, 50)
    }
    data.activeId = conv.id
    return saveConvs(data)
  })

  ipcMain.handle('conversation-delete', async (_, id) => {
    const data = loadConvs()
    data.conversations = data.conversations.filter(c => c.id !== id)
    if (data.activeId === id) data.activeId = data.conversations[0]?.id || null
    return saveConvs(data)
  })

  ipcMain.handle('exec-command', async (_, cmd) => {
    switch (cmd) {
      case 'restart': {
        if (isPackaged) {
          // In packaged mode, just relaunch the exe
          app.relaunch()
          app.quit()
        } else {
          spawn('wscript.exe', [path.join(__dirname, '..', 'start.vbs')], {
            detached: true, stdio: 'ignore', windowsHide: true,
          }).unref()
          app.quit()
        }
        return 'Restarting...'
      }
      case 'restart-server': {
        if (serverProcess) {
          serverProcess.kill()
          serverProcess = null
        }
        ensureServer()
        return 'Server restarted'
      }
      case 'stop': {
        if (serverProcess) {
          serverProcess.kill()
          serverProcess = null
        }
        spawn('cmd', ['/c', 'for /f "tokens=5" %a in (\'netstat -ano ^| findstr ":6768 "\') do taskkill /f /pid %a'], {
          detached: true, stdio: 'ignore', windowsHide: true,
        }).unref()
        spawn('wsl', ['-d', WSL_DISTRO, '-u', 'root', 'pkill', '-f', 'supermemory'], {
          detached: true, stdio: 'ignore', windowsHide: true,
        }).unref()
        setTimeout(() => {
          app.quit()
        }, 500)
        return 'Shutting down trace server and overlay...'
      }
      default:
        return `Unknown command: ${cmd}`
    }
  })

  ipcMain.handle('api-request', async (_, method, endpoint, body) => {
    return new Promise((resolve) => {
      const opts = {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: endpoint,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        timeout: 60000,
      }
      const req = http.request(opts, (res) => {
        let data = ''
        res.on('data', (c) => data += c)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch { resolve({ error: 'parse error' }) }
        })
      })
      req.on('error', () => resolve({ error: 'server unreachable' }))
      req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }) })
      if (body) req.write(JSON.stringify(body))
      req.end()
    })
  })

  // Start background services (WSL, Supermemory, Node API Server)
  await runServicesStartup(splash)

  // Fade out and close the splash screen if visible
  if (splash && !splash.isDestroyed()) {
    splash.webContents.send('status-update', { action: 'close' })
    await new Promise(r => setTimeout(r, 300))
    if (splash && !splash.isDestroyed()) splash.close()
  }

  // Load final settings to build windows and tray
  const finalSettings = loadSettings()
  const needsOnboarding = !finalSettings || !finalSettings.onboarded || !finalSettings.name
  
  createTray(finalSettings ? finalSettings.theme : 'dark')
  createWindow(needsOnboarding)
  startupComplete = true
})

app.on('window-all-closed', () => {
  if (!startupComplete) return  // Don't quit while splash is closing during startup
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('activate', () => {
  if (!win) createWindow()
})
