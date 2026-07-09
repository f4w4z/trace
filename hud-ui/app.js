const API_BASE = ''

const searchInput = document.getElementById('search-input')
const searchBtn = document.getElementById('search-btn')
const llmToggle = document.getElementById('llm-toggle')
const timelineContent = document.getElementById('timeline-content')
const summaryContent = document.getElementById('summary-content')
const queryResults = document.getElementById('query-results')
const queryContent = document.getElementById('query-content')
const statusEl = document.getElementById('status')

let ws = null

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${location.host}`
  ws = new WebSocket(url)

  ws.onopen = () => {
    statusEl.textContent = 'connected'
    statusEl.className = 'connected'
  }

  ws.onclose = () => {
    statusEl.textContent = 'disconnected'
    statusEl.className = ''
    setTimeout(connectWebSocket, 3000)
  }

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'context_update') {
        renderTimeline(msg.data)
      }
    } catch { /* ignore */ }
  }
}

async function loadDay() {
  try {
    const res = await fetch(`${API_BASE}/api/day`)
    const day = await res.json()
    renderSummary(day)
    renderTimelineFromDay(day)
  } catch (err) {
    timelineContent.innerHTML = '<div class="empty-state">Failed to load day data</div>'
  }
}

async function handleSearch() {
  const q = searchInput.value.trim()
  if (!q) return

  const useLLM = llmToggle.checked
  const url = `${API_BASE}/api/query?q=${encodeURIComponent(q)}${useLLM ? '&llm=true' : ''}`

  queryContent.innerHTML = '<div class="loading">Searching...</div>'
  queryResults.classList.remove('hidden')

  try {
    const res = await fetch(url)
    const data = await res.json()
    renderQueryResults(data, useLLM)
  } catch (err) {
    queryContent.innerHTML = '<div class="empty-state">Search failed</div>'
  }
}

function renderTimeline(ctx) {
  if (!ctx || !ctx.activeSession) return
  const s = ctx.activeSession
  const startStr = new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const endStr = new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  timelineContent.innerHTML = `
    <div class="session">
      <div class="session-header">
        <span class="session-project">${escHtml(s.project)}</span>
        <span class="session-time">${startStr} - ${endStr}</span>
      </div>
      <div class="event-count">${s.events.length} events</div>
    </div>
  `
}

function renderTimelineFromDay(day) {
  if (!day || !day.sessions || day.sessions.length === 0) {
    timelineContent.innerHTML = '<div class="empty-state">No activity recorded yet</div>'
    return
  }

  timelineContent.innerHTML = day.sessions.map(s => {
    const startStr = new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const endStr = new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const events = s.events.slice(0, 5).map(e =>
      `<li>${escHtml(e.content)}</li>`
    ).join('')

    return `
      <div class="session">
        <div class="session-header">
          <span class="session-project">${escHtml(s.project)}</span>
          <span class="session-time">${startStr} - ${endStr}</span>
        </div>
        <div class="session-summary">
          <ul>${events}</ul>
        </div>
        <div class="event-count">${s.events.length} events</div>
      </div>
    `
  }).join('')
}

function renderSummary(day) {
  if (!day || day.eventCount === 0) {
    summaryContent.innerHTML = '<div class="empty-state">No activity today</div>'
    return
  }

  const bullets = day.sessions.map(s =>
    `<li>${escHtml(s.summary)}</li>`
  ).join('')

  summaryContent.innerHTML = `
    <ul class="bullet-list">
      <li>${day.eventCount} events recorded across ${day.sessions.length} sessions</li>
      ${bullets}
    </ul>
  `
}

function renderQueryResults(data, isLLM) {
  if (isLLM && data.answer) {
    queryContent.innerHTML = `
      <div class="llm-answer">${escHtml(data.answer)}</div>
      <h2 style="font-size:12px;margin-bottom:8px;">Supporting Memories</h2>
      ${renderMemoryList(data.memories)}
    `
  } else {
    queryContent.innerHTML = renderMemoryList(data.memories)
  }
}

function renderMemoryList(memories) {
  if (!memories || memories.length === 0) {
    return '<div class="empty-state">No results found</div>'
  }

  return memories.map(m => {
    const source = m.source || ''
    const path = m.metadata?.path || m.metadata?.url || ''
    return `
      <div class="memory-item">
        <div>${escHtml(m.content)}</div>
        <div class="memory-source">${escHtml(source)}${path ? ' — ' + escHtml(path) : ''}</div>
      </div>
    `
  }).join('')
}

function escHtml(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

searchBtn.addEventListener('click', handleSearch)
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSearch()
})

loadDay()
connectWebSocket()
