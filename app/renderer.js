const ICONS = { filesystem: '📁', browser: '🌐', editor: '✏️', terminal: '💻', system: '⚙️' }

let username = 'there'
let activeEvents = []
let selectedIndex = -1
let chatMode = false
let chatHistory = []
let iconDataUrl = null

const input = document.getElementById('search-input')
const searchLogo = document.getElementById('search-logo')
const sendBtn = document.getElementById('send-btn')
const greetingText = document.getElementById('greeting-text')
const greetingSub = document.getElementById('greeting-sub')
const summary = document.getElementById('summary')
const summaryText = document.getElementById('summary-text')
const summaryStats = document.getElementById('summary-stats')
const events = document.getElementById('events')
const eventsEmpty = document.getElementById('events-empty')
const chat = document.getElementById('chat')

window.trace.getIcon().then(url => {
  if (url) {
    iconDataUrl = url
    searchLogo.src = url
  }
})

window.trace.username().then(name => {
  username = name
  renderGreeting()
})

window.trace.onFocusSearch(() => {
  setTimeout(() => input.focus(), 50)
})

window.trace.onBlurHide(() => {
  closeWindow()
})

function renderGreeting() {
  const h = new Date().getHours()
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  greetingText.textContent = `Hey ${username}`
  greetingSub.textContent = activeEvents.length
    ? `You've been working on ${activeEvents[0]?.metadata?.project || 'a few things'}`
    : `Good ${time} — start working and trace will catch it`
}

function renderEvents() {
  eventsEmpty.classList.toggle('hidden', activeEvents.length > 0)
  if (!activeEvents.length) { events.innerHTML = ''; return }

  events.innerHTML = activeEvents.slice(0, 12).map((e, i) => {
    const icon = ICONS[e.source] ?? '📄'
    const title = e.content || ''
    const detail = e.metadata?.path || e.metadata?.url || e.metadata?.project || e.metadata?.app || ''
    const ts = e.timestamp || e.metadata?.rawTimestamp
    return `<div class="event-item" data-index="${i}" style="animation-delay:${(i % 12) * 0.03}s">
      <div class="event-icon ${e.source}">${icon}</div>
      <div class="event-body">
        <div class="event-title">${escape(title)}</div>
        ${detail ? `<div class="event-detail">${escape(detail)}</div>` : ''}
      </div>
      ${ts ? `<div class="event-time">${timeAgo(ts)}</div>` : ''}
    </div>`
  }).join('')
}

function renderSummary(data) {
  if (!data || !data.text || !data.stats || !data.stats.total) {
    summary.classList.remove('visible')
    return
  }
  summaryText.textContent = data.text
  summaryStats.innerHTML = ''
  const chips = []
  if (data.stats?.total) chips.push(`<div class="stat-chip"><b>${data.stats.total}</b> events</div>`)
  if (data.stats?.apps?.length) chips.push(`<div class="stat-chip"><b>${data.stats.apps.length}</b> apps</div>`)
  if (data.stats?.files?.length) chips.push(`<div class="stat-chip"><b>${data.stats.files.length}</b> files</div>`)
  const pc = data.stats?.browsers?.reduce((s, b) => s + b.titles.length, 0) || 0
  if (pc) chips.push(`<div class="stat-chip"><b>${pc}</b> pages</div>`)
  summaryStats.innerHTML = chips.join('')
  summary.classList.add('visible')
}

function escape(s, max) {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = max ? String(s).slice(0, max) : String(s)
  return d.innerHTML
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'now'
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

// ---- background polling ----

let eventsKey = ''
let lastSummary = null

async function pollEvents() {
  const data = await window.trace.api('GET', '/context/current')
  if (!data) return
  const evts = data.recentEvents ?? []
  const key = evts.map(e => e.id ?? e.content).join('|')
  if (key === eventsKey) return
  eventsKey = key
  activeEvents = evts
  selectedIndex = -1
  renderGreeting()
  if (!chatMode) renderEvents()
}

async function pollSummary() {
  const data = await window.trace.api('GET', '/context/summary')
  if (!data) return
  lastSummary = data
  if (!chatMode) renderSummary(data)
}

function closeWindow() {
  const w = document.getElementById('window')
  w.classList.add('closing')
  w.addEventListener('animationend', () => {
    w.classList.remove('closing')
    window.trace.hideWindow()
  }, { once: true })
}

pollEvents()
pollSummary()
setInterval(pollEvents, 5000)
setInterval(pollSummary, 300000)

// ---- chat ----

input.addEventListener('input', () => {
  sendBtn.classList.toggle('active', input.value.trim().length > 0)
})

input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (chatMode) {
      if (input.value) {
        input.value = ''
        sendBtn.classList.remove('active')
      } else {
        exitChat()
      }
      return
    }
    if (input.value) {
      input.value = ''
      sendBtn.classList.remove('active')
      return
    }
    closeWindow()
    return
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

sendBtn.addEventListener('click', () => sendMessage())

const COMMANDS = {
  help: { desc: 'Show available commands' },
  restart: { desc: 'Restart the entire app' },
  'restart-server': { desc: 'Restart the trace server only' },
  clear: { desc: 'Delete all stored memories' },
  status: { desc: 'Show daemon and supermemory status' },
}

async function handleCommand(cmd) {
  const parts = cmd.slice(1).trim().split(/\s+/)
  const name = parts[0]
  const args = parts.slice(1)

  if (name === 'help' || !name) {
    const lines = Object.entries(COMMANDS).map(([k, v]) => `<code>/${k}</code> - ${v.desc}`)
    return `<div style="font-size:13px;line-height:1.8">Available commands:<br>${lines.join('<br>')}</div>`
  }

  if (!COMMANDS[name]) {
    return `Unknown command: <code>/${name}</code>. Type <code>/help</code> for available commands.`
  }

  switch (name) {
    case 'restart':
    case 'restart-server':
      return await window.trace.execCommand(name)
    case 'clear': {
      const result = await window.trace.api('DELETE', '/admin/memories')
      return result?.cleared ? 'All memories deleted.' : 'Failed to clear memories.'
    }
    case 'status': {
      const s = await window.trace.api('GET', '/admin/status')
      if (!s) return 'Server unreachable.'
      return `Status: <b>${s.status}</b><br>Daemon: <b>${s.daemon ? 'running' : 'stopped'}</b><br>Supermemory: <b>${s.supermemory ? 'connected' : 'disconnected'}</b><br>Container: <code>${s.containerTag}</code>`
    }
    default:
      return `Unknown command: /${name}`
  }
}

async function sendMessage() {
  const q = input.value.trim()
  if (!q) return
  input.value = ''
  sendBtn.classList.remove('active')

  if (!chatMode) enterChat()
  addUserMsg(q)
  showTyping()
  scrollToBottom()

  if (q.startsWith('/')) {
    const reply = await handleCommand(q)
    hideTyping()
    addAiMsg(reply, [])
    scrollToBottom()
    return
  }

  const data = await window.trace.api('GET', `/context/query?q=${encodeURIComponent(q)}&llm=true`)
  hideTyping()
  if (data?.answer) {
    addAiMsg(data.answer, data.memories ?? [])
  } else if (data?.memories?.length) {
    const fallback = data.memories.map(m => m.title ?? m.content ?? m.memory ?? m.chunk ?? '').filter(Boolean).join('\n')
    addAiMsg(fallback || 'No relevant activity found.', [])
  } else {
    addAiMsg('No relevant activity found for that question.', [])
  }
  scrollToBottom()
}

function enterChat() {
  chatMode = true
  summary.classList.remove('visible')
  events.style.display = 'none'
  chat.style.display = 'flex'
  chat.innerHTML = ''
  chatHistory = []
}

function exitChat() {
  chatMode = false
  chat.style.display = 'none'
  events.style.display = ''
  summary.classList.remove('hidden')
  renderSummary(lastSummary)
  renderEvents()
}

function addUserMsg(text) {
  const el = document.createElement('div')
  el.className = 'chat-msg user'
  el.innerHTML = `<div class="chat-bubble">${escape(text)}</div>`
  chat.appendChild(el)
}

function addAiMsg(text, memories) {
  const el = document.createElement('div')
  el.className = 'chat-msg ai'
  let html = `<div class="chat-bubble">${escape(text).replace(/\n/g, '<br>')}</div>`
  if (memories.length) {
    html += '<div class="chat-events">'
    html += memories.slice(0, 6).map(m => {
      const s = m.metadata?.source ?? 'filesystem'
      const icon = ICONS[s] ?? '📄'
      const title = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
      const detail = m.metadata?.path ?? m.metadata?.url ?? m.metadata?.project ?? ''
      return `<div class="event-item">
        <div class="event-icon ${s}">${icon}</div>
        <div class="event-body">
          <div class="event-title">${escape(title)}</div>
          ${detail ? `<div class="event-detail">${escape(detail)}</div>` : ''}
        </div>
      </div>`
    }).join('')
    html += '</div>'
  }
  el.innerHTML = html
  chat.appendChild(el)
}

function showTyping() {
  const el = document.createElement('div')
  el.className = 'typing-indicator'
  el.id = 'typing-indicator'
  const logo = iconDataUrl
    ? `<img class="typing-logo" src="${iconDataUrl}">`
    : ''
  el.innerHTML = `<div class="typing-line">${logo}<span class="shimmer">thinking</span></div>`
  chat.appendChild(el)
}

function hideTyping() {
  const el = document.getElementById('typing-indicator')
  if (el) el.remove()
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight
  })
}
