const API = 'http://localhost:6768'
const ICONS = { filesystem: '📁', browser: '🌐', editor: '✏️', terminal: '💻', system: '⚙️' }

let searchDebounce = null
let selectedIndex = -1

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

function renderResult(m, index) {
  const source = m.metadata?.source ?? m.source ?? 'filesystem'
  const icon = ICONS[source] ?? '📄'
  const title = m.title ?? m.content ?? m.memory ?? m.chunk ?? ''
  const detail = m.metadata?.path || m.metadata?.url || m.metadata?.project || m.metadata?.app || ''
  const ts = m.createdAt || m.timestamp || m.metadata?.rawTimestamp
  return `<div class="result-item" data-index="${index}" style="animation-delay:${(index % 12) * 0.03}s" onclick="openItem(${index})">
    <div class="result-icon ${source}">${icon}</div>
    <div class="result-body">
      <div class="result-title">${escape(title)}</div>
      ${detail ? `<div class="result-detail">${escape(detail)}</div>` : ''}
    </div>
    ${ts ? `<div class="result-time">${timeAgo(ts)}</div>` : ''}
  </div>`
}

async function doSearch(q) {
  const data = await api(`/context/query?q=${encodeURIComponent(q)}`)
  const memories = data?.memories ?? data?.results ?? []
  const section = $('#results-section')
  const list = $('#results-list')
  const empty = $('#empty-state')

  if (!memories.length) {
    section.classList.add('hidden')
    empty.classList.remove('hidden')
    return
  }

  empty.classList.add('hidden')
  section.classList.remove('hidden')
  selectedIndex = -1

  list.innerHTML = memories.map((m, i) => renderResult(m, i)).join('')
}

function openItem(i) {
  const items = $$('#results-list .result-item')
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
    $('#empty-state').classList.remove('hidden')
    return
  }
  searchDebounce = setTimeout(() => doSearch(q), 250)
})

$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('#search').value = ''
    $('#search').blur()
    $('#results-section').classList.add('hidden')
    $('#empty-state').classList.remove('hidden')
  }
})

// Listen for the Electron window focus signal
if (window.trace?.onFocusSearch) {
  window.trace.onFocusSearch(() => setTimeout(() => $('#search').focus(), 100))
}
