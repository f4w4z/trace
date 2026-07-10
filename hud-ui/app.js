const API = 'http://localhost:6768'
const ICONS = { filesystem: '📁', browser: '🌐', editor: '✏️', terminal: '💻', system: '⚙️' }

let searchDebounce = null
let selectedIndex = -1
let pollTimer = null

const $ = s => document.querySelector(s)
const $$ = s => document.querySelectorAll(s)

async function api(path) {
  try {
    const r = await fetch(API + path)
    return await r.json()
  } catch { return null }
}

function timeAgo(ts) {
  const d = new Date(ts).getTime()
  const diff = Date.now() - d
  if (diff < 60000) return 'now'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h`
}

function escape(s) {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = String(s).slice(0, 300)
  return d.innerHTML
}

function renderEvent(e, index) {
  const icon = ICONS[e.source] ?? '📄'
  const title = e.content || ''
  const detail = e.metadata?.path || e.metadata?.url || e.metadata?.project || e.metadata?.app || ''
  const ts = e.timestamp || e.metadata?.rawTimestamp
  return `<div class="event-item" data-index="${index}" style="animation-delay:${(index % 10) * 0.04}s">
    <div class="event-icon ${e.source}">${icon}</div>
    <div class="event-body">
      <div class="event-title">${escape(title)}</div>
      ${detail ? `<div class="event-detail">${escape(detail)}</div>` : ''}
    </div>
    ${ts ? `<div class="event-time">${timeAgo(ts)}</div>` : ''}
  </div>`
}

let lastSessionKey = ''

async function loadSession() {
  const data = await api('/context/current')
  if (!data) return
  const events = data.recentEvents || []
  const key = events.map(e => e.id ?? e.content).join('|')
  if (key === lastSessionKey) return
  lastSessionKey = key

  const container = $('#active-events')
  if (!events.length) {
    container.innerHTML = '<div style="color:var(--text3);padding:12px;text-align:center;font-size:12px">No recent activity</div>'
    return
  }
  container.innerHTML = events.slice(0, 15).map((e, i) => renderEvent(e, i)).join('')
}

async function doSearch(q) {
  const data = await api(`/context/query?q=${encodeURIComponent(q)}`)
  const memories = data?.memories ?? data?.results ?? []
  const section = $('#results-section')
  const list = $('#results-list')
  const tl = $('#timeline-section')

  if (!memories.length) {
    section.classList.add('hidden')
    tl.classList.remove('hidden')
    return
  }

  section.classList.remove('hidden')
  tl.classList.add('hidden')
  selectedIndex = -1

  list.innerHTML = memories.map((m, i) => {
    const source = m.metadata?.source ?? 'filesystem'
    const icon = ICONS[source] ?? '📄'
    const title = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
    const detail = m.metadata?.path || m.metadata?.url || m.metadata?.project || ''
    const ts = m.createdAt || m.metadata?.rawTimestamp
    return `<div class="event-item" data-index="${i}" style="animation-delay:${(i % 15) * 0.03}s" onclick="openItem(${i})">
      <div class="event-icon ${source}">${icon}</div>
      <div class="event-body">
        <div class="event-title">${escape(title)}</div>
        ${detail ? `<div class="event-detail">${escape(detail)}</div>` : ''}
      </div>
      ${ts ? `<div class="event-time">${timeAgo(ts)}</div>` : ''}
    </div>`
  }).join('')
}

function openItem(i) {
  const items = $$('#results-list .event-item')
  items.forEach((el, idx) => {
    if (idx === i) el.classList.add('selected')
    else el.classList.remove('selected')
  })
}

// Search input
$('#search').addEventListener('input', () => {
  clearTimeout(searchDebounce)
  const q = $('#search').value.trim()
  if (!q) {
    $('#results-section').classList.add('hidden')
    $('#timeline-section').classList.remove('hidden')
    $('#empty-state').classList.add('hidden')
    return
  }
  searchDebounce = setTimeout(() => doSearch(q), 250)
})

$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('#search').value = ''
    $('#search').blur()
    $('#results-section').classList.add('hidden')
    $('#timeline-section').classList.remove('hidden')
    $('#empty-state').classList.add('hidden')
  }
})

// Polling
async function poll() {
  const health = await api('/health')
  if (health) {
    const dot = $('#status-dot')
    const cls = 'status-dot' + (health.supermemory ? '' : ' degraded')
    if (dot.className !== cls) dot.className = cls
    const badge = $('#index-badge')
    if (health.supermemory && badge.textContent !== 'live') {
      badge.textContent = 'live'
      badge.classList.remove('pulse')
    }
  }
  const data = await api('/admin/status')
  if (data) {
    const mc = $('#mem-count')
    const v = String(data.memoryCount ?? '?')
    if (mc.textContent !== v) mc.textContent = v
  }
  await loadSession()
}

pollTimer = setInterval(poll, 5000)
poll()

// Listen for the Electron window focus signal
if (window.trace?.onFocusSearch) {
  window.trace.onFocusSearch(() => setTimeout(() => $('#search').focus(), 100))
}
