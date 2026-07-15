const ICONS = { filesystem: '📁', browser: '🌐', editor: '✏️', terminal: '💻', system: '⚙️', media: '🎵' }

let username = 'there'
let selectedIndex = -1
let chatMode = false
let aiMode = false
let activeConv = null
let iconDataUrl = null
const loadingConversations = new Set()

const input = document.getElementById('search-input')
const searchLogo = document.getElementById('search-logo')

const greetingText = document.getElementById('greeting-text')
const greetingSub = document.getElementById('greeting-sub')
const summary = document.getElementById('summary')
const summaryText = document.getElementById('summary-text')
const summaryStats = document.getElementById('summary-stats')
const home = document.getElementById('home')
const convSection = document.getElementById('convs-section')
const convList = document.getElementById('conv-list')
const searchRow = document.getElementById('search-row')

window.trace.getIcon().then(url => {
  if (url) {
    iconDataUrl = url
  }
})

window.trace.username().then(name => {
  username = name
  renderGreeting()
})

function playOpenAnimation() {
  const w = document.getElementById('window')
  if (!w) return
  w.classList.remove('opening', 'closing')
  void w.offsetWidth
  w.classList.add('opening')
}

window.trace.onFocusSearch(() => {
  playOpenAnimation()
  setTimeout(() => input.focus(), 50)
  renderGreeting(true)
  const now = Date.now()
  if (now - lastSummaryTime > 15 * 60 * 1000) {
    pollSummary()
  }
})

window.trace.onBlurHide(() => {
  closeWindow()
})

const GREETING_WORD = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Good evening' }
const GREETING_LINES = {
  morning: [
    "Fresh start — what are we diving into today?",
    "Morning. What can I help you pick back up?",
    "A new day. Ask me anything about your work.",
    "Rise and shine. What were you last on?",
  ],
  afternoon: [
    "Hope your day's flowing. What can I find for you?",
    "Midday already — want to recap what you've been on?",
    "What are you in the middle of? I've got it.",
    "The afternoon's yours. What should we look at?",
  ],
  evening: [
    "Winding down? I've got today's notes ready.",
    "Evening. What would you like to revisit?",
    "Almost done for the day? Ask me anything.",
    "Quiet moment — what are you curious about?",
  ],
  night: [
    "Still here — what can I help with?",
    "Late one. What are you hunting for?",
    "Burning the midnight oil? I'm right here.",
  ],
}

let greetingLineIdx = 0

function periodForHour(h) {
  if (h < 5) return 'night'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 21) return 'evening'
  return 'night'
}

function renderGreeting(advance = false) {
  if (advance) greetingLineIdx++
  const h = new Date().getHours()
  const period = periodForHour(h)
  const name = username && username !== 'there' ? `${username}` : ''
  greetingText.textContent = name ? `${GREETING_WORD[period]}, ${name}` : GREETING_WORD[period]
  const pool = GREETING_LINES[period]
  greetingSub.textContent = pool[greetingLineIdx % pool.length]
}

function renderSummary(data) {
  if (!data || !data.text) {
    summary.classList.remove('visible')
    return
  }
  document.getElementById('summary-loading').classList.remove('visible')
  summaryText.innerHTML = renderMarkdown(escape(data.text))
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
  let list = await window.trace.conversationsList()
  if (list) {
    list = list.filter(c => {
      if (c.title && c.title.trim().startsWith('/')) return false
      if (c.preview && c.preview.trim().startsWith('/')) return false
      return true
    })
  }
  if (!list || !list.length) {
    convSection.classList.remove('visible')
    return
  }
  convSection.classList.add('visible')
  convList.innerHTML = list.map((c, i) => {
    const title = c.title || 'New conversation'
    const date = formatTimestamp(c.createdAt)
    const preview = c.preview ? escape(c.preview).slice(0, 60) : ''
    return `<div class="conv-entry" data-id="${c.id}" style="animation-delay:${(i % 12) * 0.035}s">
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
  if (loadingConversations.has(id)) {
    showTyping()
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

async function saveConversation(conv) {
  if (!conv || !conv.messages.length) return
  if (!conv.title) {
    const first = conv.messages.find(m => m.role === 'user')
    if (first) conv.title = first.text.slice(0, 80)
  }
  await window.trace.conversationSave(conv)
}

async function saveCurrentConversation() {
  await saveConversation(activeConv)
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

let lastSummary = null
let pollingSummary = false
let lastSummaryTime = 0

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(r => setTimeout(() => r(null), ms))
  ])
}

async function pollSummary() {
  if (pollingSummary) return
  pollingSummary = true
  if (!chatMode) {
    summary.classList.add('visible')
    document.getElementById('summary-loading').classList.add('visible')
  }
  try {
    const data = await withTimeout(window.trace.api('GET', '/context/summary'), 30000)
    if (!data) {
      throw new Error('Timeout fetching summary')
    }
    if (data.error) {
      throw new Error(data.error)
    }
    if (!chatMode) document.getElementById('summary-loading').classList.remove('visible')
    if (!data.text) {
      summary.classList.remove('visible')
      lastSummaryTime = Date.now()
      pollingSummary = false
      return
    }
    lastSummary = data
    lastSummaryTime = Date.now()
    if (!chatMode) renderSummary(data)
  } catch (err) {
    console.error('Failed to poll summary, retrying in 3s:', err)
    if (!chatMode) document.getElementById('summary-loading').classList.remove('visible')
    setTimeout(pollSummary, 3000)
  } finally {
    pollingSummary = false
  }
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
pollSummary()
setInterval(() => renderGreeting(false), 60000)

// ---- chat ----

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (chatMode) {
        if (input.value) {
          input.value = ''
        } else {
          exitChat()
        }
        return
      }
      if (input.value) {
        input.value = ''
        return
      }
      closeWindow()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      aiMode = !aiMode
      searchRow.classList.toggle('ai-mode', aiMode)
      input.placeholder = aiMode ? 'Ask anything...' : 'Ask anything, or search your memory...'
      input.focus()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })

const COMMANDS = {
  help: { desc: 'Show available commands' },
  chat: { desc: 'Show all previous chats' },
  new: { desc: 'Start a new conversation' },
  restart: { desc: 'Restart the entire app' },
  'restart-server': { desc: 'Restart the trace server only' },
  stop: { desc: 'Stop all servers, UIs, and exit' },
  clear: { desc: 'Delete all stored memories' },
  status: { desc: 'Show daemon and supermemory status' },
  onboarding: { desc: 'Re-show the onboarding wizard' },
}

async function handleCommand(cmd) {
  const parts = cmd.slice(1).trim().split(/\s+/)
  const name = parts[0]
  const args = parts.slice(1)

  if (name === 'help' || !name) {
    const lines = Object.entries(COMMANDS).map(([k, v]) => `<span class="cmd-name">/${k}</span> — ${v.desc}`)
    return `<div class="cmd-help-list">${lines.join('<br>')}</div>`
  }

  if (!COMMANDS[name] && name !== 'slashsummaryregen' && name !== 'summaryregen') {
    return `Unknown command: <span class="cmd-name">/${name}</span>. Type <span class="cmd-name">/help</span> for available commands.`
  }

  switch (name) {
    case 'chat': {
      let list = await window.trace.conversationsList()
      if (list) {
        list = list.filter(c => {
          if (c.title && c.title.trim().startsWith('/')) return false
          if (c.preview && c.preview.trim().startsWith('/')) return false
          return true
        })
      }
      if (!list || !list.length) {
        return 'No past conversations found.'
      }
      
      const renderItem = c => {
        const title = c.title || 'New conversation'
        const date = formatTimestamp(c.createdAt)
        const preview = c.preview ? escape(c.preview).slice(0, 60) : ''
        return `<div class="chat-conv-entry" onclick="openConversation('${c.id}')">
          <div class="chat-conv-title">💬 ${escape(title)}</div>
          <div class="chat-conv-meta">
            ${date} · ${c.messageCount} message${c.messageCount !== 1 ? 's' : ''}${preview ? ' · <span class="chat-conv-preview">' + preview + '</span>' : ''}
          </div>
        </div>`
      }

      const top10 = list.slice(0, 10).map(renderItem).join('')
      const remaining = list.slice(10)
      
      let html = `<div class="chat-conv-list">
        <div class="chat-conv-header">Past Conversations:</div>
        ${top10}`
        
      if (remaining.length > 0) {
        const remHtml = remaining.map(renderItem).join('')
        const moreId = 'more-convs-' + Date.now()
        html += `
        <div id="${moreId}" style="display: none; flex-direction: column; gap: 6px;">${remHtml}</div>
        <button class="onb-btn" style="margin-top: 8px; width: 100%; padding: 6px;" onclick="document.getElementById('${moreId}').style.display = 'flex'; this.remove();">Load more</button>`
      }
      
      html += `</div>`
      return html
    }
    case 'restart':
    case 'restart-server':
    case 'stop':
      return await window.trace.execCommand(name)
    case 'clear': {
      const result = await window.trace.api('DELETE', '/admin/memories')
      return result?.cleared ? 'All memories deleted.' : 'Failed to clear memories.'
    }
    case 'status': {
      const s = await window.trace.api('GET', '/admin/status')
      if (!s) return 'Server unreachable.'
      return `Status: <b>${s.status}</b><br>Daemon: <b>${s.daemon ? 'running' : 'stopped'}</b><br>Supermemory: <b>${s.supermemory ? 'connected' : 'disconnected'}</b><br>Container: <code class="inline-code">${s.containerTag}</code>`
    }
    case 'onboarding': {
      onbData = { name: '', theme: 'dark', runAtStartup: true, sources: ['browser', 'filesystem', 'editor', 'terminal'] }
      showOnboarding()
      return 'Opened onboarding wizard.'
    }
    case 'slashsummaryregen':
    case 'summaryregen': {
      const cmdEndIdx = cmd.indexOf(name) + name.length
      let instruction = cmd.slice(cmdEndIdx).trim()
      
      if (instruction.startsWith('--')) {
        instruction = instruction.slice(2).trim()
      }
      
      if (!instruction) {
        return 'Please provide a context instruction, e.g., <code class="inline-code">slashsummaryregen --dont mention any songs</code>'
      }
      
      try {
        const result = await window.trace.api('GET', `/context/summary?context=${encodeURIComponent(instruction)}`)
        if (result && result.text) {
          lastSummary = result
          renderSummary(result)
          return `<b>Summary regenerated with context:</b> "${escape(instruction)}"<br><br>${renderMarkdown(escape(result.text))}`
        } else {
          return 'Failed to regenerate summary (empty response).'
        }
      } catch (err) {
        return `Error regenerating summary: ${escape(String(err))}`
      }
    }
    default:
      return `Unknown command: <span class="cmd-name">/${name}</span>`
  }
}

async function sendMessage() {
  let q = input.value.trim()
  if (!q) return
  input.value = ''

  if (q.toLowerCase().startsWith('slashsummaryregen') || q.toLowerCase().startsWith('/slashsummaryregen') || q.toLowerCase().startsWith('/summaryregen')) {
    if (!q.startsWith('/')) {
      q = '/' + q
    }
  }

  if (q.trim() === '/new') {
    if (!chatMode) startNewConversation()
    else { chat.innerHTML = ''; activeConv = null; startNewConversation() }
    input.focus()
    return
  }

  if (!chatMode) {
    // Starting from the home screen — always open a fresh conversation.
    activeConv = null
    enterChat()
  }

  if (q.startsWith('/')) {
    const targetConv = activeConv
    if (targetConv) loadingConversations.add(targetConv.id)
    showTyping()
    scrollToBottom()
    const reply = await handleCommand(q)
    hideTyping()
    if (targetConv) {
      loadingConversations.delete(targetConv.id)
      addAiMsgToConv(targetConv, reply, [], true)
    } else {
      const msg = { role: 'ai', text: reply, raw: true, timestamp: new Date().toISOString() }
      renderChatMessage(msg)
    }
    scrollToBottom()
    return
  }

  addUserMsg(q)
  const targetConv = activeConv
  if (targetConv) loadingConversations.add(targetConv.id)
  showTyping()
  scrollToBottom()

  try {
    const tz = -new Date().getTimezoneOffset()
    const endpoint = aiMode ? '/context/chat' : '/context/query'
    const history = targetConv && targetConv.messages.length > 1
      ? targetConv.messages.slice(0, -1).map(m => ({ role: m.role, text: m.text }))
      : []

    const data = await window.trace.api('POST', endpoint, {
      q,
      history,
      llm: !aiMode,
      tz
    })
    if (data?.error) {
      const msg = data.error === 'timeout'
        ? 'Query timed out. Your activity was found but the AI response took too long. Try a simpler question.'
        : `Error: ${data.error}`
      addAiMsgToConv(targetConv, msg, data.memories ?? [])
    } else if (data?.answer) {
      addAiMsgToConv(targetConv, data.answer, data.memories ?? [])
    } else if (data?.memories?.length) {
      const fallback = formatFallbackAnswer(q, data.memories)
      addAiMsgToConv(targetConv, fallback, data.memories)
    } else {
      addAiMsgToConv(targetConv, 'No relevant activity found for that question.', [])
    }
  } catch (err) {
    addAiMsgToConv(targetConv, 'Sorry, something went wrong.', [])
  } finally {
    if (targetConv) {
      loadingConversations.delete(targetConv.id)
    }
    if (chatMode && activeConv && activeConv.id === targetConv?.id) {
      hideTyping()
      scrollToBottom()
    }
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
    const count = Math.min(memories.length, 6)
    html += `<div class="msg-sources-toggle">Show sources (${count})</div>`
    html += '<div class="msg-memories" style="display:none">'
    html += memories.slice(0, 6).map(m => {
      const s = m.source ?? m.metadata?.source ?? 'filesystem'
      const icon = ICONS[s] ?? '📄'
      const title = cleanTitle(m.title ?? m.content ?? m.memory ?? m.chunk ?? '')
      const detail = m.metadata?.path ?? m.metadata?.url ?? m.metadata?.project ?? ''
      const isUrl = String(detail).startsWith('http')
      const detailHtml = isUrl
        ? `<a class="src-link" href="#" onclick="event.preventDefault(); window.trace.openUrl('${escape(detail)}')">${escape(detail)}</a>`
        : escape(detail)
      return `<div class="src-item">
        <div class="src-title">${escape(title)}</div>
        ${detail ? `<div class="src-detail">${detailHtml}</div>` : ''}
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

  const srcToggle = el.querySelector('.msg-sources-toggle')
  if (srcToggle) {
    const mem = el.querySelector('.msg-memories')
    srcToggle.addEventListener('click', () => {
      const open = mem.style.display !== 'none'
      mem.style.display = open ? 'none' : 'flex'
      srcToggle.textContent = open
        ? srcToggle.textContent.replace('Hide', 'Show')
        : srcToggle.textContent.replace('Show', 'Hide')
    })
  }

  chat.appendChild(el)
}

function enterChat() {
  chatMode = true
  summary.classList.remove('visible')
  home.style.display = 'none'
  chat.classList.add('visible')
}

function exitChat() {
  chatMode = false
  activeConv = null
  chat.classList.remove('visible')
  home.style.display = ''
  renderSummary(lastSummary)
  renderConversations()
}

function addUserMsg(text) {
  if (!activeConv) {
    activeConv = {
      id: 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: '',
      createdAt: new Date().toISOString(),
      messages: [],
    }
    chat.innerHTML = ''
  }
  const msg = { role: 'user', text, timestamp: new Date().toISOString() }
  activeConv.messages.push(msg)
  renderChatMessage(msg)
  saveCurrentConversation()
}

function addAiMsgToConv(conv, text, memories, raw) {
  if (!conv) return
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
  conv.messages.push(msg)
  if (activeConv && activeConv.id === conv.id) {
    renderChatMessage(msg)
  }
  saveConversation(conv)
}

function showTyping() {
  const el = document.createElement('div')
  el.className = 'typing-indicator'
  el.id = 'typing-indicator'
  const isLight = document.body.classList.contains('light')
  const logoPath = isLight ? 'assets/logo-lightmode.png' : 'assets/logo-darkmode.png'
  el.innerHTML = `<div class="typing-line"><img class="typing-logo" src="${logoPath}"><div class="typing-dots"><span></span><span></span><span></span></div></div>`
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

// ---- Onboarding ----

let onbStep = 1
let onbData = { name: '', theme: 'dark', runAtStartup: true, sources: ['browser', 'filesystem', 'editor', 'terminal'] }

function getOnbEl(id) { return document.getElementById(id) }

function showOnboarding() {
  const overlay = document.getElementById('onboarding-overlay')
  overlay.classList.add('visible')
  goOnbStep(1)
  setTimeout(() => getOnbEl('onb-name')?.focus(), 300)
}

function hideOnboarding() {
  document.getElementById('onboarding-overlay').classList.remove('visible')
}

function goOnbStep(n) {
  onbStep = n
  document.querySelectorAll('.onb-panel').forEach(p => p.classList.remove('visible'))
  document.querySelectorAll('.onb-step').forEach(s => s.classList.remove('active', 'done'))
  for (let i = 1; i < n; i++) {
    const step = document.querySelector(`.onb-step[data-step="${i}"]`)
    if (step) step.classList.add('done')
  }
  const stepEl = document.querySelector(`.onb-step[data-step="${n}"]`)
  if (stepEl) stepEl.classList.add('active')
  const panel = document.querySelector(`.onb-panel[data-panel="${n}"]`)
  if (panel) panel.classList.add('visible')
}

function initOnboarding() {
  // Step 1: Name
  getOnbEl('onb-next-1').addEventListener('click', () => {
    const name = getOnbEl('onb-name').value.trim()
    if (!name) { getOnbEl('onb-name').focus(); return }
    onbData.name = name
    goOnbStep(2)
  })
  getOnbEl('onb-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') getOnbEl('onb-next-1').click()
  })

  // Step 2: Theme
  document.querySelectorAll('.onb-theme-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.onb-theme-card').forEach(c => c.classList.remove('selected'))
      card.classList.add('selected')
      card.querySelector('input[type="radio"]').checked = true
    })
  })
  getOnbEl('onb-next-2').addEventListener('click', () => {
    const selected = document.querySelector('.onb-theme-card.selected')
    onbData.theme = selected ? selected.dataset.theme : 'dark'
    goOnbStep(3)
  })

  // Step 3: Startup
  getOnbEl('onb-next-3').addEventListener('click', () => {
    onbData.runAtStartup = getOnbEl('onb-startup').checked
    goOnbStep(4)
  })

  // Step 4: Sources
  document.querySelectorAll('.onb-source').forEach(el => {
    el.addEventListener('click', () => {
      el.classList.toggle('checked')
      const cb = el.querySelector('input[type="checkbox"]')
      if (cb) cb.checked = el.classList.contains('checked')
    })
  })
  getOnbEl('onb-next-4').addEventListener('click', () => {
    const checked = document.querySelectorAll('.onb-source.checked')
    onbData.sources = Array.from(checked).map(el => el.dataset.source)
    goOnbStep(5)
  })

  // Step 5: Done
  getOnbEl('onb-done').addEventListener('click', async () => {
    getOnbEl('onb-done').disabled = true
    getOnbEl('onb-done').textContent = 'Saving...'
    onbData.onboarded = true
    try {
      await window.trace.saveSettings(onbData)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
    try {
      if (onbData.runAtStartup) await window.trace.setRunAtStartup(true)
    } catch (err) {
      console.error('Failed to set run at startup:', err)
    }
    applyTheme(onbData.theme)
    username = onbData.name
    renderGreeting()
    hideOnboarding()
  })
}

function populateOnbSummary() {
  getOnbEl('onb-summary-name').textContent = onbData.name
  getOnbEl('onb-summary-theme').textContent = onbData.theme === 'dark' ? 'Dark' : 'Light'
  getOnbEl('onb-summary-startup').textContent = onbData.runAtStartup ? 'Yes' : 'No'
  const sourceNames = { browser: 'Browser', filesystem: 'Files', editor: 'Editor', terminal: 'Terminal' }
  getOnbEl('onb-summary-sources').textContent = onbData.sources.map(s => sourceNames[s] || s).join(', ')
}

function applyTheme(theme) {
  const isLight = theme === 'light'
  document.body.classList.toggle('light', isLight)
  const logoPath = isLight ? 'assets/logo-lightmode.png' : 'assets/logo-darkmode.png'
  if (searchLogo) searchLogo.src = logoPath
  const onbLogoImg = document.querySelector('.onb-logo-img')
  if (onbLogoImg) onbLogoImg.src = logoPath
}

// Override goOnbStep to refresh summary on step 5
const _origGoOnbStep = goOnbStep
goOnbStep = function(n) {
  _origGoOnbStep(n)
  if (n === 5) populateOnbSummary()
}

// Check if onboarding needed
loadInitialState = (function(orig) {
  return async function() {
    const settings = await window.trace.getSettings()
    if (!settings || !settings.onboarded || !settings.name) {
      showOnboarding()
      orig()
      return
    }
    username = settings.name || username
    renderGreeting()
    if (settings.theme) applyTheme(settings.theme)
    orig()
  }
})(loadInitialState)

// Init onboarding at the end (after DOM ready)
initOnboarding()

  function formatFallbackAnswer(query, memories) {
  if (!memories || memories.length === 0) {
    return "I couldn't find any matching activity in your logs.\n---\nNo recent events matched your query."
  }

  const sorted = [...memories].sort((a, b) => {
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tB - tA
  })

  const cleanQuery = query.toLowerCase()
  const seen = new Set()
  const unique = []
  for (const m of sorted) {
    const rawText = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
    if (!rawText) continue
    const clean = cleanTitle(rawText).toLowerCase().trim()
    if (seen.has(clean)) continue
    seen.add(clean)
    unique.push(m)
  }

  const specificAnswer = findSpecificAnswer(cleanQuery, unique)

  const ICONS = { filesystem: '📁', browser: '🌐', editor: '✏️', terminal: '💻', system: '⚙️', media: '🎵' }

  const detailLines = unique.slice(0, 15).map(m => {
    const rawText = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
    const clean = cleanTitle(rawText)
    const src = m.source ?? m.metadata?.source ?? 'filesystem'
    const icon = ICONS[src] ?? '📄'
    const relativeTime = getRelativeTime(m.createdAt)
    const app = m.metadata?.app ?? src
    return `${icon} **${clean}** (${app} · ${relativeTime})`
  }).join('\n')

  return `${specificAnswer}\n---\nHere is the timeline of matching activity:\n${detailLines}`
}

function pollSupermemoryStatus() {
  const container = document.getElementById('supermemory-status-container')
  const logsEl = document.getElementById('supermemory-logs')
  if (!container || !logsEl) return

  const titleEl = container.querySelector('.shimmer')
  let wasStarting = false

  const interval = setInterval(async () => {
    try {
      const info = await window.trace.getSupermemoryStatus()
      if (info && info.status === 'starting') {
        wasStarting = true
        container.style.display = 'block'
        logsEl.textContent = info.logs || 'Initializing Supermemory local...'
      } else {
        if (wasStarting) {
          // Transition to success state
          if (titleEl) {
            titleEl.textContent = 'Supermemory started successfully!'
            titleEl.style.color = '#10b981'
          }
          logsEl.textContent = 'All services are now online.'
          logsEl.style.color = '#34d399'

          setTimeout(() => {
            container.style.display = 'none'
            // Reset styles for future launches
            if (titleEl) {
              titleEl.textContent = 'Supermemory is starting...'
              titleEl.style.color = '#a855f7'
            }
            logsEl.style.color = '#c084fc'
          }, 2000)

          clearInterval(interval)
        } else {
          container.style.display = 'none'
          clearInterval(interval)
        }
      }
    } catch (err) {
      console.error('Failed to get Supermemory status:', err)
    }
  }, 1000)
}

pollSupermemoryStatus()
