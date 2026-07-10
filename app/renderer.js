const ICONS = { filesystem: '📁', browser: '🌐', editor: '✏️', terminal: '💻', system: '⚙️' }

let username = 'there'
let activeEvents = []
let selectedIndex = -1
let currentResults = []
let searchDebounce = null

const input = document.getElementById('search-input')
const greetingText = document.getElementById('greeting-text')
const greetingSub = document.getElementById('greeting-sub')
const summary = document.getElementById('summary')
const summaryText = document.getElementById('summary-text')
const summaryStats = document.getElementById('summary-stats')
const events = document.getElementById('events')
const eventsEmpty = document.getElementById('events-empty')

window.smt.username().then(name => {
  username = name
  renderGreeting()
})

window.smt.onFocusSearch(() => {
  setTimeout(() => input.focus(), 50)
})

window.smt.onBlurHide(() => {
  closeWindow()
})

function renderGreeting() {
  const h = new Date().getHours()
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  greetingText.textContent = `Hey ${username}`
  greetingSub.textContent = activeEvents.length
    ? `You've been working on ${activeEvents[0]?.metadata?.project || 'a few things'}`
    : `Good ${time} — start working and smt will catch it`
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

function escape(s) {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = String(s).slice(0, 200)
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
  const data = await window.smt.api('GET', '/context/current')
  if (!data) return
  const evts = data.recentEvents ?? []
  const key = evts.map(e => e.id ?? e.content).join('|')
  if (key === eventsKey) return
  eventsKey = key
  activeEvents = evts
  selectedIndex = -1
  renderGreeting()
  renderEvents()
}

async function pollSummary() {
  const data = await window.smt.api('GET', '/context/summary')
  if (!data) return
  lastSummary = data
  renderSummary(data)
}

function closeWindow() {
  const w = document.getElementById('window')
  w.classList.add('closing')
  w.addEventListener('animationend', () => {
    w.classList.remove('closing')
    window.smt.hideWindow()
  }, { once: true })
}

pollEvents()
pollSummary()
setInterval(pollEvents, 5000)
setInterval(pollSummary, 300000) // every 5 min

// ---- search ----

input.addEventListener('input', () => {
  clearTimeout(searchDebounce)
  const q = input.value.trim()
  if (!q) {
    summary.classList.remove('hidden')
    renderEvents()
    return
  }
  summary.classList.add('hidden')
  searchDebounce = setTimeout(() => doSearch(q), 200)
})

input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (input.value) {
      input.value = ''
      summary.classList.remove('hidden')
      renderEvents()
      return
    }
    closeWindow()
    return
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1) }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1) }
  if (e.key === 'Enter') { e.preventDefault(); openSel() }
})

function moveSel(dir) {
  const items = events.querySelectorAll('.event-item')
  if (!items.length) return
  selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + dir))
  items.forEach((el, i) => el.classList.toggle('selected', i === selectedIndex))
  items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
}

function openSel() {
  if (selectedIndex < 0 || selectedIndex >= activeEvents.length) return
  const item = activeEvents[selectedIndex]
  const url = item.metadata?.url
  if (url && !url.startsWith('file://')) window.smt.openUrl(url)
}

async function doSearch(q) {
  const data = await window.smt.api('GET', `/context/query?q=${encodeURIComponent(q)}`)
  const memories = data.memories ?? data.results ?? []
  currentResults = memories
  selectedIndex = -1

  if (!memories.length) {
    events.innerHTML = '<div class="event-item" style="cursor:default;color:rgba(255,255,255,0.15);justify-content:center;padding:20px">No results</div>'
    return
  }

  events.innerHTML = memories.map((m, i) => {
    const s = m.metadata?.source ?? 'filesystem'
    const icon = ICONS[s] ?? '📄'
    const title = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
    const detail = m.metadata?.path ?? m.metadata?.url ?? m.metadata?.project ?? ''
    const ts = m.createdAt ?? m.metadata?.rawTimestamp
    return `<div class="event-item" data-index="${i}" style="animation-delay:${(i % 15) * 0.02}s">
      <div class="event-icon ${s}">${icon}</div>
      <div class="event-body">
        <div class="event-title">${escape(title)}</div>
        ${detail ? `<div class="event-detail">${escape(detail)}</div>` : ''}
      </div>
      ${ts ? `<div class="event-time">${timeAgo(ts)}</div>` : ''}
    </div>`
  }).join('')
}
