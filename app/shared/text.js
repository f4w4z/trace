function cleanTitle(text) {
  if (!text) return ''
  let clean = text
  clean = clean.replace(/^[a-zA-Z0-9_-]+\s+·\s+/, '')
  clean = clean.replace(/\s+and\s+\d+\s+more\s+page.*/gi, '')
  clean = clean.replace(/\s*-\s*Zeny\s*-\s*Microsoft.*Edge/gi, '')
  clean = clean.replace(/\s*-\s*Microsoft.*Edge/gi, '')
  clean = clean.replace(/\s*-\s*Google Chrome/gi, '')
  clean = clean.replace(/\s*-\s*Brave.*/gi, '')
  clean = clean.replace(/\s*-\s*Vivaldi/gi, '')
  clean = clean.replace(/\s*-\s*YouTube/gi, '')
  clean = clean.replace(/\s*-\s*Netflix/gi, '')
  clean = clean.replace(/\s*-\s*Discord/gi, '')
  clean = clean.replace(/^\(\d+\)\s+/, '')
  clean = clean.replace(/^Now playing:\s+/i, '')
  return clean.trim()
}

function getRelativeTime(createdAt) {
  if (!createdAt) return 'some time ago'
  const diff = Date.now() - new Date(createdAt).getTime()
  if (diff < 60000) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(createdAt).toLocaleDateString()
}

function findSpecificAnswer(query, memories) {
  const cleanQuery = query.toLowerCase()
  let specificAnswer = ''

  if (cleanQuery.includes('youtube') || cleanQuery.includes('video') || cleanQuery.includes('watch')) {
    const ytEvent = memories.find(m => {
      const text = (m.title ?? m.content ?? m.memory ?? m.chunk ?? '').toLowerCase()
      const url = String(m.metadata?.url ?? '').toLowerCase()
      return text.includes('youtube') || url.includes('youtube.com') || url.includes('youtu.be')
    })
    if (ytEvent) {
      const title = cleanTitle(ytEvent.title ?? ytEvent.content ?? ytEvent.memory ?? ytEvent.chunk ?? '')
      specificAnswer = `The last YouTube video you watched was **${title}** (${getRelativeTime(ytEvent.createdAt)}).`
    }
  }

  if (!specificAnswer && (cleanQuery.includes('song') || cleanQuery.includes('music') || cleanQuery.includes('spotify') || cleanQuery.includes('playing') || cleanQuery.includes('listen'))) {
    const mediaEvent = memories.find(m => {
      const text = (m.title ?? m.content ?? m.memory ?? m.chunk ?? '').toLowerCase()
      const source = String(m.source ?? m.metadata?.source ?? '').toLowerCase()
      return source === 'media' || text.includes('now playing') || text.includes('spotify')
    })
    if (mediaEvent) {
      const title = cleanTitle(mediaEvent.title ?? mediaEvent.content ?? mediaEvent.memory ?? mediaEvent.chunk ?? '')
      specificAnswer = `The last song you listened to was **${title}** (${getRelativeTime(mediaEvent.createdAt)}).`
    }
  }

  if (!specificAnswer && (cleanQuery.includes('netflix') || cleanQuery.includes('movie') || cleanQuery.includes('show'))) {
    const netflixEvent = memories.find(m => {
      const text = (m.title ?? m.content ?? m.memory ?? m.chunk ?? '').toLowerCase()
      const url = String(m.metadata?.url ?? '').toLowerCase()
      return text.includes('netflix') || url.includes('netflix.com')
    })
    if (netflixEvent) {
      const title = cleanTitle(netflixEvent.title ?? netflixEvent.content ?? netflixEvent.memory ?? netflixEvent.chunk ?? '')
      specificAnswer = `The last Netflix page you visited was **${title}** (${getRelativeTime(netflixEvent.createdAt)}).`
    }
  }

  if (!specificAnswer && (cleanQuery.includes('search') || cleanQuery.includes('google'))) {
    const searchEvent = memories.find(m => {
      const text = (m.title ?? m.content ?? m.memory ?? m.chunk ?? '').toLowerCase()
      return text.includes('google search:') || text.includes('searchquery')
    })
    if (searchEvent) {
      const title = cleanTitle(searchEvent.title ?? searchEvent.content ?? searchEvent.memory ?? searchEvent.chunk ?? '')
      specificAnswer = `Your last search was for **${title}** (${getRelativeTime(searchEvent.createdAt)}).`
    }
  }

  if (!specificAnswer && (cleanQuery.includes('discord') || cleanQuery.includes('chat') || cleanQuery.includes('message'))) {
    const discordEvent = memories.find(m => {
      const text = (m.title ?? m.content ?? m.memory ?? m.chunk ?? '').toLowerCase()
      const app = String(m.metadata?.app ?? '').toLowerCase()
      return text.includes('discord') || app === 'discord'
    })
    if (discordEvent) {
      const title = cleanTitle(discordEvent.title ?? discordEvent.content ?? discordEvent.memory ?? discordEvent.chunk ?? '')
      specificAnswer = `You were last active on Discord in **${title}** (${getRelativeTime(discordEvent.createdAt)}).`
    }
  }

  if (!specificAnswer && (cleanQuery.includes('file') || cleanQuery.includes('code') || cleanQuery.includes('editor') || cleanQuery.includes('project') || cleanQuery.includes('work'))) {
    const fileEvent = memories.find(m => {
      const source = String(m.source ?? m.metadata?.source ?? '').toLowerCase()
      return source === 'filesystem' || source === 'editor'
    })
    if (fileEvent) {
      const title = cleanTitle(fileEvent.title ?? fileEvent.content ?? fileEvent.memory ?? fileEvent.chunk ?? '')
      specificAnswer = `You were last working on **${title}** (${getRelativeTime(fileEvent.createdAt)}).`
    }
  }

  if (!specificAnswer) {
    specificAnswer = `I found ${memories.length} matching activities in your log.`
  }

  return specificAnswer
}
