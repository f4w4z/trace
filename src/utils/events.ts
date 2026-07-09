import type { Event, EventSource, EventType, EventMetadata } from '../types.js'

let counter = 0

export function createEvent(
  source: EventSource,
  type: EventType,
  content: string,
  metadata: EventMetadata = {},
): Event {
  return {
    id: `${source}-${Date.now()}-${++counter}`,
    source,
    type,
    content,
    metadata,
    timestamp: new Date(),
  }
}

export function extractProject(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] && !parts[i].startsWith('.') && parts[i].length > 1) {
      return parts[i]
    }
  }
  return 'unknown'
}

export function timeBucket(date: Date): string {
  const h = date.getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'night'
}
