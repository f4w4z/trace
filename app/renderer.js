const ICONS = { filesystem: '📁', browser: '🌐', editor: '✏️', terminal: '💻', system: '⚙️', media: '🎵' }

let username = 'there'
let activeEvents = []
let selectedIndex = -1
let chatMode = false
let aiMode = false
let activeConv = null
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
const convSection = document.getElementById('convs-section')
const convList = document.getElementById('conv-list')
const searchRow = document.getElementById('search-row')

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
  document.getElementById('summary-loading').classList.remove('visible')
  summaryText.innerHTML = renderMarkdown(escape(data.text))
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

function renderMarkdown(s) {
  if (!s) return ''
  return s
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="inline-code">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\n/g, '<br>')
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'now'
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

function formatTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---- conversations ----

async function renderConversations() {
  const list = await window.trace.conversationsList()
  if (!list || !list.length) {
    convSection.classList.remove('visible')
    return
  }
  convSection.classList.add('visible')
  convList.innerHTML = list.map(c => {
    const title = c.title || 'New conversation'
    const date = formatTimestamp(c.createdAt)
    const preview = c.preview ? escape(c.preview).slice(0, 60) : ''
    return `<div class="conv-entry" data-id="${c.id}">
      <div class="conv-entry-icon">💬</div>
      <div class="conv-entry-body">
        <div class="conv-entry-title">${escape(title)}</div>
        <div class="conv-entry-meta">${date} · ${c.messageCount} message${c.messageCount !== 1 ? 's' : ''}${preview ? ' · ' + preview : ''}</div>
      </div>
      <button class="conv-del" data-id="${c.id}" title="Delete conversation">✕</button>
    </div>`
  }).join('')

  convList.querySelectorAll('.conv-entry').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.conv-del')) return
      openConversation(el.dataset.id)
    })
  })
  convList.querySelectorAll('.conv-del').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      deleteConversation(el.dataset.id)
    })
  })
}

async function openConversation(id) {
  const conv = await window.trace.conversationGet(id)
  if (!conv) return
  activeConv = conv
  chat.innerHTML = ''
  for (const msg of conv.messages) {
    renderChatMessage(msg)
  }
  enterChat()
  scrollToBottom()
}

async function deleteConversation(id) {
  await window.trace.conversationDelete(id)
  if (activeConv && activeConv.id === id) {
    activeConv = null
    exitChat()
  }
  renderConversations()
}

async function startNewConversation() {
  if (activeConv && activeConv.messages.length === 0) return
  activeConv = {
    id: 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title: '',
    createdAt: new Date().toISOString(),
    messages: [],
  }
  chat.innerHTML = ''
  enterChat()
}

async function saveCurrentConversation() {
  if (!activeConv || !activeConv.messages.length) return
  if (!activeConv.title) {
    const first = activeConv.messages.find(m => m.role === 'user')
    if (first) activeConv.title = first.text.slice(0, 80)
  }
  await window.trace.conversationSave(activeConv)
}

async function loadInitialState() {
  for (let i = 0; i < 10; i++) {
    const list = await window.trace.conversationsList()
    if (list !== null) {
      if (list.length) renderConversations()
      return
    }
    greetingSub.textContent = 'Connecting...'
    await new Promise(r => setTimeout(r, 2000))
  }
  greetingSub.textContent = 'Could not reach server'
}

// ---- background polling ----

let eventsKey = ''
let lastSummary = null

async function pollEvents() {
  const data = await window.trace.api('GET', '/context/current')
  if (!data) {
    if (!eventsKey) greetingSub.textContent = 'Connecting...'
    return
  }
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
  if (!chatMode) {
    summary.classList.add('visible')
    document.getElementById('summary-loading').classList.add('visible')
  }
  const data = await window.trace.api('GET', '/context/summary')
  if (!chatMode) document.getElementById('summary-loading').classList.remove('visible')
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

loadInitialState()
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
  if (e.key === 'Tab') {
    e.preventDefault()
    aiMode = !aiMode
    searchRow.classList.toggle('ai-mode', aiMode)
    input.placeholder = aiMode ? 'Ask anything...' : "Ask what you've been doing..."
    input.focus()
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
  new: { desc: 'Start a new conversation' },
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
    const lines = Object.entries(COMMANDS).map(([k, v]) => `<span style="display:inline-block;padding:0 5px;font-weight:500;color:rgba(100,210,255,0.7)">/${k}</span> — ${v.desc}`)
    return `<div style="font-size:13.5px;line-height:2.2">${lines.join('<br>')}</div>`
  }

  if (!COMMANDS[name]) {
    return `Unknown command: <span style="font-weight:500;color:rgba(100,210,255,0.7)">/${name}</span>. Type <span style="font-weight:500;color:rgba(100,210,255,0.7)">/help</span> for available commands.`
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

  if (q.trim() === '/new') {
    if (!chatMode) startNewConversation()
    else { chat.innerHTML = ''; activeConv = null; startNewConversation() }
    input.focus()
    return
  }

  if (!chatMode) enterChat()
  addUserMsg(q)
  showTyping()
  scrollToBottom()

  if (q.startsWith('/')) {
    const reply = await handleCommand(q)
    hideTyping()
    addAiMsg(reply, [], true)
    scrollToBottom()
    return
  }

  try {
    const endpoint = aiMode ? '/context/chat' : '/context/query'
    const data = await window.trace.api('GET', `${endpoint}?q=${encodeURIComponent(q)}${aiMode ? '' : '&llm=true'}`)
    if (data?.answer) {
      addAiMsg(data.answer, data.memories ?? [])
    } else if (data?.memories?.length) {
      const fallback = data.memories.map(m => m.title ?? m.content ?? m.memory ?? m.chunk ?? '').filter(Boolean).join('\n')
      addAiMsg(fallback || 'No relevant activity found.', [])
    } else {
      addAiMsg('No relevant activity found for that question.', [])
    }
  } catch (err) {
    addAiMsg('Sorry, something went wrong.', [])
  } finally {
    hideTyping()
    scrollToBottom()
  }
}

function renderChatMessage(msg) {
  const el = document.createElement('div')
  el.className = `chat-msg ${msg.role}`
  const label = msg.role === 'user' ? 'you' : 'trace'
  const ts = formatTimestamp(msg.timestamp)

  if (msg.role === 'user') {
    el.innerHTML = `<div class="msg-label">${label} · ${ts}</div><div class="msg-text">${escape(msg.text)}</div>`
    chat.appendChild(el)
    return
  }

  let text = msg.raw ? msg.text : renderMarkdown(escape(msg.text))
  let html = `<div class="msg-label">${label} · ${ts}</div>`

  if (!msg.raw && msg.full) {
    let short = renderMarkdown(escape(msg.short))
    html += `<div class="msg-text msg-text-short">${short} <span class="msg-more">Show more →</span></div>
      <div class="msg-text msg-text-full" style="display:none">${text}</div>`
  } else {
    html += `<div class="msg-text">${text}</div>`
  }

  const memories = msg.memories || []
  if (memories.length) {
    html += '<div class="msg-memories">'
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

  if (!msg.raw && msg.full) {
    const more = el.querySelector('.msg-more')
    if (more) {
      more.addEventListener('click', () => {
        el.querySelector('.msg-text-short').style.display = 'none'
        el.querySelector('.msg-text-full').style.display = 'block'
      })
    }
  }

  chat.appendChild(el)
}

function enterChat() {
  chatMode = true
  summary.classList.remove('visible')
  events.style.display = 'none'
  chat.style.display = 'flex'
}

function exitChat() {
  chatMode = false
  chat.style.display = 'none'
  events.style.display = ''
  summary.classList.remove('hidden')
  renderSummary(lastSummary)
  renderEvents()
  renderConversations()
}

function addUserMsg(text) {
  if (!activeConv) activeConv = {
    id: 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title: '',
    createdAt: new Date().toISOString(),
    messages: [],
  }
  const msg = { role: 'user', text, timestamp: new Date().toISOString() }
  activeConv.messages.push(msg)
  renderChatMessage(msg)
  saveCurrentConversation()
}

function addAiMsg(text, memories, raw) {
  if (!activeConv) return
  let short = text
  let full = ''
  if (!raw) {
    const sepIdx = text.indexOf('---')
    if (sepIdx !== -1) {
      short = text.slice(0, sepIdx).trim()
      full = text.slice(sepIdx + 3).trim()
    } else if (text.length > 200) {
      // Fallback: first sentence as summary
      const dotIdx = text.indexOf('. ')
      if (dotIdx !== -1 && dotIdx < 250) {
        short = text.slice(0, dotIdx + 1).trim()
        full = text
      }
    }
  }
  const msg = { role: 'ai', text, short, full, memories: memories || [], raw: !!raw, timestamp: new Date().toISOString() }
  activeConv.messages.push(msg)
  renderChatMessage(msg)
  saveCurrentConversation()
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
