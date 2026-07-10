const { app, globalShortcut, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

const API_PORT = 6768
const SERVER_SCRIPT = path.join(__dirname, '..', 'dist', 'index.js').replace(/\\/g, '/')

let win = null
let tray = null
let serverProcess = null

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
  console.log('starting smt server...')
  serverProcess = spawn('node', [SERVER_SCRIPT], {
    stdio: 'ignore',
    detached: false,
  })
  // wait for it to be ready
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000))
    if (await isServerRunning()) return
  }
  console.error('smt server failed to start')
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

  win.on('blur', () => {
    if (win && win.isVisible()) {
      win.webContents.send('blur-hide')
    }
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
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('smt — Context Search')
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

  ipcMain.on('hide-window', () => {
    if (win && win.isVisible()) win.hide()
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
