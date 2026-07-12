export const STOP_WORDS = new Set([
  'what', 'were', 'when', 'where', 'that', 'this', 'there', 'with', 'have', 'been', 'your', 'about', 'tell', 'from',
  'was', 'did', 'does', 'had', 'not', 'the', 'and', 'for', 'are', 'but', 'you', 'our', 'him', 'her', 'its', 'out',
  'has', 'get', 'set', 'who', 'how', 'why', 'can', 'will', 'would', 'should', 'could', 'than', 'then', 'them',
  'they', 'their', 'she', 'his', 'any', 'some', 'all', 'into', 'onto', 'over', 'under', 'here'
])

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^\w]/g, ''))
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w))
}

export function expandSearchTerms(terms: string[]): string[] {
  const expanded = new Set(terms)
  for (const t of terms) {
    if (t === 'yt' || t === 'youtube' || t === 'video' || t === 'videos') {
      expanded.add('yt')
      expanded.add('youtube')
    }
    if (t === 'spotify' || t === 'music' || t === 'song' || t === 'listening' || t === 'listen' || t === 'track' || t === 'playing') {
      expanded.add('spotify')
      expanded.add('media')
      expanded.add('track_change')
    }
    if (t === 'netflix' || t === 'show' || t === 'movie' || t === 'watching' || t === 'watch') {
      expanded.add('netflix')
    }
  }
  return Array.from(expanded)
}
