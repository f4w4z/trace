const ICONS = { filesystem: '📁', browser: '🌐', editor: '✏️', terminal: '💻', system: '⚙️' }

let selectedIndex = -1
let currentResults = []
let searchDebounce = null
let activeEvents = []

const input = document.getElementById('search-input')
const results = document.getElementById('results')
const activeSection = document.getElementById('active-section')
const activeList = document.getElementById('active-list')
const searchSection = document.getElementById('search-section')
const searchList = document.getElementById('search-list')
const emptyState = document.getElementById('empty-state')

window.smt.onFocusSearch(() => setTimeout(() => input.focus(), 50))

input.addEventListener('input', () => {
  clearTimeout(searchDebounce)
  const q = input.value.trim()
  if (!q) {
    searchSection.style.display = 'none'
    activeSection.style.display = 'block'
    emptyState.style.display = 'none'
    return
  }
  activeSection.style.display = 'none'
  emptyState.style.display = 'none'
  searchDebounce = setTimeout(() => doSearch(q), 200)
})

input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    input.value = ''
    searchSection.style.display = 'none'
    activeSection.style.display = 'block'
    emptyState.style.display = 'none'
    input.blur()
    window.smt.api('GET', '/context/current')
    return
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1) }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1) }
  if (e.key === 'Enter') { e.preventDefault(); openSel() }
})

function moveSel(dir) {
  const items = (searchSection.style.display !== 'none' ? searchList : activeList).querySelectorAll('.result-item')
  if (!items.length) return
  selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + dir))
  items.forEach((el, i) => el.classList.toggle('selected', i === selectedIndex))
  items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
}

function openSel() {
  const items = searchSection.style.display !== 'none' ? currentResults : activeEvents
  if (selectedIndex < 0 || selectedIndex >= items.length) return
  const item = items[selectedIndex]
  const url = item.metadata?.url
  if (url && !url.startsWith('file://')) window.smt.openUrl(url)
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'now'
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

function escape(s) {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = String(s).slice(0, 200)
  return d.innerHTML
}

async function doSearch(q) {
  const data = await window.smt.api('GET', `/context/query?q=${encodeURIComponent(q)}`)
  const memories = data.memories ?? data.results ?? []
  currentResults = memories
  selectedIndex = -1
  searchSection.style.display = 'block'

  if (!memories.length) {
    searchList.innerHTML = '<div class="result-item" style="cursor:default;color:rgba(255,255,255,0.2);justify-content:center;padding:16px">No results</div>'
    return
  }

  searchList.innerHTML = memories.map((m, i) => {
    const s = m.metadata?.source ?? 'filesystem'
    const icon = ICONS[s] ?? '📄'
    const title = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
    const detail = m.metadata?.path ?? m.metadata?.url ?? m.metadata?.project ?? ''
    const ts = m.createdAt ?? m.metadata?.rawTimestamp
    return `<div class="result-item" data-index="${i}" style="animation-delay:${(i % 15) * 0.03}s">
      <div class="result-icon ${s}">${icon}</div>
      <div class="result-body">
        <div class="result-title">${escape(title)}</div>
        ${detail ? `<div class="result-detail">${escape(detail)}</div>` : ''}
      </div>
      ${ts ? `<div class="result-time">${timeAgo(ts)}</div>` : ''}
    </div>`
  }).join('')
}

async function loadActive() {
  const data = await window.smt.api('GET', '/context/current')
  if (!data) return
  const events = data.recentEvents ?? []
  activeEvents = events
  selectedIndex = -1

  if (!events.length) {
    if (searchSection.style.display === 'none') {
      emptyState.style.display = 'flex'
    }
    return
  }

  emptyState.style.display = 'none'
  activeList.innerHTML = events.slice(0, 8).map((e, i) => {
    const icon = ICONS[e.source] ?? '📄'
    const title = e.content || ''
    const detail = e.metadata?.path || e.metadata?.url || e.metadata?.project || e.metadata?.app || ''
    const ts = e.timestamp || e.metadata?.rawTimestamp
    return `<div class="result-item" data-index="${i}" style="animation-delay:${(i % 8) * 0.04}s">
      <div class="result-icon ${e.source}">${icon}</div>
      <div class="result-body">
        <div class="result-title">${escape(title)}</div>
        ${detail ? `<div class="result-detail">${escape(detail)}</div>` : ''}
      </div>
      ${ts ? `<div class="result-time">${timeAgo(ts)}</div>` : ''}
    </div>`
  }).join('')
}

loadActive()
setInterval(loadActive, 5000)
