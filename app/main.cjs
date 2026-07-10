const { app, globalShortcut, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')

const API_PORT = 6768
const SERVER_SCRIPT = path.join(__dirname, '..', 'dist', 'index.js').replace(/\\/g, '/')

let win = null
let tray = null
let serverProcess = null

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
  if (running) return
  console.log('starting trace server...')
  serverProcess = spawn('node', [SERVER_SCRIPT], {
    stdio: 'ignore',
    detached: false,
  })
  // wait for it to be ready
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000))
    if (await isServerRunning()) return
  }
  console.error('trace server failed to start')
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const winWidth = Math.min(700, width - 100)
  const winHeight = Math.min(500, height - 200)

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.setBackgroundColor('#00000000')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.loadFile(path.join(__dirname, 'index.html'))

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

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'logo.png')
  let icon
  try { icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) } catch {}
  if (!icon || icon.isEmpty()) icon = nativeImage.createEmpty()
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

app.whenReady().then(async () => {
  await ensureServer()
  createWindow()
  createTray()

  const registered = globalShortcut.register('Alt+X', toggleWindow)
  if (!registered) {
    console.error('Alt+X shortcut registration failed, trying Alt+Space...')
    globalShortcut.register('Alt+Space', toggleWindow)
  }

  ipcMain.handle('open-url', async (_, url) => {
    if (url && !url.startsWith('file://')) shell.openExternal(url)
  })

  ipcMain.handle('get-username', () => process.env.USERNAME || 'there')

  ipcMain.handle('get-icon', () => {
    const iconPath = path.join(__dirname, 'assets', 'logo.png')
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

  const chatPath = path.join(app.getPath('userData'), 'chat-history.json')

  ipcMain.handle('save-chat', async (_, messages) => {
    try {
      fs.writeFileSync(chatPath, JSON.stringify(messages), 'utf-8')
      return true
    } catch { return false }
  })

  ipcMain.handle('load-chat', async () => {
    try {
      if (!fs.existsSync(chatPath)) return []
      return JSON.parse(fs.readFileSync(chatPath, 'utf-8'))
    } catch { return [] }
  })

  ipcMain.handle('exec-command', async (_, cmd) => {
    switch (cmd) {
      case 'restart': {
        spawn('cmd', ['/c', 'start', '', path.join(__dirname, '..', 'start.bat')], {
          detached: true, stdio: 'ignore', windowsHide: true,
        }).unref()
        app.quit()
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
      default:
        return `Unknown command: ${cmd}`
    }
  })

  ipcMain.handle('api-request', async (_, method, endpoint, body) => {
    return new Promise((resolve) => {
      const opts = {
        hostname: 'localhost',
        port: API_PORT,
        path: endpoint,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
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
      if (body) req.write(JSON.stringify(body))
      req.end()
    })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('activate', () => {
  if (!win) createWindow()
})
