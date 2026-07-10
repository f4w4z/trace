const ICONS = {
  filesystem: '📁',
  browser: '🌐',
  editor: '✏️',
  terminal: '💻',
  system: '⚙️',
}

let selectedIndex = -1
let currentResults = []
let searchDebounce = null

const input = document.getElementById('search-input')
const resultsContainer = document.getElementById('search-results')
const resultsList = document.getElementById('search-results-list')
const emptyState = document.getElementById('empty-state')
const activeSession = document.getElementById('active-session')
const activeContent = document.getElementById('active-session-content')

window.smt.onFocusSearch(() => {
  setTimeout(() => input.focus(), 50)
})

input.addEventListener('input', () => {
  clearTimeout(searchDebounce)
  const q = input.value.trim()
  if (!q) {
    resultsContainer.style.display = 'none'
    emptyState.style.display = 'flex'
    return
  }
  emptyState.style.display = 'none'
  searchDebounce = setTimeout(() => doSearch(q), 200)
})

input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    window.smt.api('GET', '/context/query?q=')
    window.close()
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1) }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1) }
  if (e.key === 'Enter') { e.preventDefault(); openSelected() }
})

function moveSelection(dir) {
  const items = resultsList.querySelectorAll('.result-item')
  if (!items.length) return
  selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + dir))
  items.forEach((el, i) => el.classList.toggle('selected', i === selectedIndex))
  items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
}

function openSelected() {
  if (selectedIndex < 0 || selectedIndex >= currentResults.length) return
  const item = currentResults[selectedIndex]
  const url = item.metadata?.url
  if (url && !url.startsWith('file://')) {
    window.smt.api('POST', '/mcp', { tool: 'get_current_context', args: {} })
    window.smt.openUrl(url)
  }
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h`
}

async function doSearch(q) {
  const data = await window.smt.api('GET', `/context/query?q=${encodeURIComponent(q)}`)
  const memories = data.memories ?? data.results ?? []
  currentResults = memories
  selectedIndex = -1
  renderResults(memories)
}

function renderResults(memories) {
  if (!memories.length) {
    resultsList.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.2);font-size:13px">No results</div>'
    resultsContainer.style.display = 'block'
    return
  }

  resultsContainer.style.display = 'block'
  resultsList.innerHTML = memories.map((m, i) => {
    const source = m.metadata?.source ?? 'filesystem'
    const icon = ICONS[source] ?? '📄'
    const title = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
    const detail = m.metadata?.path ?? m.metadata?.url ?? m.metadata?.project ?? ''
    const ts = m.createdAt ?? m.metadata?.rawTimestamp
    return `<div class="result-item" data-index="${i}" onclick="selectAndOpen(${i})">
      <div class="result-icon ${source}">${icon}</div>
      <div class="result-body">
        <div class="result-title">${escapeHtml(title)}</div>
        ${detail ? `<div class="result-detail">${escapeHtml(detail)}</div>` : ''}
      </div>
      ${ts ? `<div class="result-time">${timeAgo(ts)}</div>` : ''}
    </div>`
  }).join('')
}

function selectAndOpen(i) {
  selectedIndex = i
  openSelected()
}

function escapeHtml(s) {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s.slice(0, 200)
  return d.innerHTML
}

// Load active session on open
async function loadActiveSession() {
  const data = await window.smt.api('GET', '/context/current')
  const session = data.activeSession
  if (!session || !session.events?.length) {
    activeSession.style.display = 'none'
    return
  }
  const ev = session.events.slice(0, 5)
  activeContent.innerHTML = ev.map(e => {
    const icon = ICONS[e.source] ?? '📄'
    return `<div class="result-item" style="cursor:default">
      <div class="result-icon ${e.source}">${icon}</div>
      <div class="result-body">
        <div class="result-title">${escapeHtml(e.content)}</div>
        ${e.metadata?.project ? `<div class="result-detail">${escapeHtml(e.metadata.project)}</div>` : ''}
      </div>
      <div class="result-time">${timeAgo(e.timestamp)}</div>
    </div>`
  }).join('')
}

loadActiveSession()
