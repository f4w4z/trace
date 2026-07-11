export interface TimeRange {
  startDate?: string
  endDate?: string
  cleanQuery: string
}

function getLocalParts(utcDate: Date, offsetMinutes: number): { year: number; month: number; day: number } {
  const localMs = utcDate.getTime() + offsetMinutes * 60000
  const d = new Date(localMs)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
  }
}

function localToUtcIso(year: number, month: number, day: number, hour: number, offsetMinutes: number): string {
  const localMs = Date.UTC(year, month, day, hour, 0, 0, 0)
  return new Date(localMs - offsetMinutes * 60000).toISOString()
}

function parseMonthName(s: string): number | undefined {
  const names: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }
  return names[s]
}

export function parseTimeRange(query: string, offsetMinutes = 0): TimeRange {
  const lower = query.toLowerCase().trim()
  const now = new Date()

  // "on July 11" or "July 11" or "July 11th"
  const onDateMatch = lower.match(/\b(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
  if (onDateMatch) {
    const month = parseMonthName(onDateMatch[1])
    const day = parseInt(onDateMatch[2], 10)
    if (month !== undefined) {
      const year = now.getUTCFullYear()
      const start = localToUtcIso(year, month, day, 0, offsetMinutes)
      const end = localToUtcIso(year, month, day, 23, offsetMinutes)
      return {
        startDate: start,
        endDate: end,
        cleanQuery: lower.replace(onDateMatch[0], '').replace(/\s+/g, ' ').trim(),
      }
    }
  }

  // "N months ago"
  const monthsAgoMatch = lower.match(/\b(\d+)\s+months?\s+ago\b/)
  if (monthsAgoMatch) {
    const n = parseInt(monthsAgoMatch[1], 10)
    const start = new Date(now.getFullYear(), now.getMonth() - n, 1)
    const end = new Date()
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      cleanQuery: lower.replace(monthsAgoMatch[0], '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "N days ago"
  const daysAgoMatch = lower.match(/\b(\d+)\s+days?\s+ago\b/)
  if (daysAgoMatch) {
    const n = parseInt(daysAgoMatch[1], 10)
    const start = new Date(now.getTime() - n * 86400000)
    const end = new Date()
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      cleanQuery: lower.replace(daysAgoMatch[0], '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "N weeks ago"
  const weeksAgoMatch = lower.match(/\b(\d+)\s+weeks?\s+ago\b/)
  if (weeksAgoMatch) {
    const n = parseInt(weeksAgoMatch[1], 10)
    const start = new Date(now.getTime() - n * 7 * 86400000)
    const end = new Date()
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      cleanQuery: lower.replace(weeksAgoMatch[0], '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "last month"
  const lastMonthMatch = lower.match(/\blast\s+month\b/)
  if (lastMonthMatch) {
    const { year, month, day } = getLocalParts(now, offsetMinutes)
    const start = localToUtcIso(year, month - 1, day, 0, offsetMinutes)
    const end = now.toISOString()
    return {
      startDate: start,
      endDate: end,
      cleanQuery: lower.replace(/\blast\s+month\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "last year"
  const lastYearMatch = lower.match(/\blast\s+year\b/)
  if (lastYearMatch) {
    const { year, month, day } = getLocalParts(now, offsetMinutes)
    const start = localToUtcIso(year - 1, month, day, 0, offsetMinutes)
    const end = now.toISOString()
    return {
      startDate: start,
      endDate: end,
      cleanQuery: lower.replace(/\blast\s+year\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "yesterday"
  const yesterdayMatch = lower.match(/\byesterday\b/)
  if (yesterdayMatch) {
    const { year, month, day } = getLocalParts(now, offsetMinutes)
    const start = localToUtcIso(year, month, day - 1, 0, offsetMinutes)
    const end = localToUtcIso(year, month, day - 1, 23, offsetMinutes)
    return {
      startDate: start,
      endDate: end,
      cleanQuery: lower.replace(/\byesterday\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "last night" — 18:00 previous day to 06:00 today, local
  // Before 6 AM local, "last night" means TWO nights back (the fully completed night)
  const lastNightMatch = lower.match(/\blast\s+night\b/)
  if (lastNightMatch) {
    const { year, month, day } = getLocalParts(now, offsetMinutes)
    const localHour = new Date(now.getTime() + offsetMinutes * 60000).getUTCHours()
    const shift = localHour < 6 ? 1 : 0  // before 6 AM: shift one more day back
    const start = localToUtcIso(year, month, day - 1 - shift, 18, offsetMinutes)
    const end = localToUtcIso(year, month, day - shift, 6, offsetMinutes)
    return {
      startDate: start,
      endDate: end,
      cleanQuery: lower.replace(/\blast\s+night\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "today"
  const todayMatch = lower.match(/\btoday\b/)
  if (todayMatch) {
    const { year, month, day } = getLocalParts(now, offsetMinutes)
    const start = localToUtcIso(year, month, day, 0, offsetMinutes)
    return {
      startDate: start,
      endDate: now.toISOString(),
      cleanQuery: lower.replace(/\btoday\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "this week" — Monday 00:00 local to now
  const thisWeekMatch = lower.match(/\bthis\s+week\b/)
  if (thisWeekMatch) {
    const { year, month, day } = getLocalParts(now, offsetMinutes)
    const dow = new Date(now.getTime() + offsetMinutes * 60000).getUTCDay()
    const mondayOffset = dow === 0 ? -6 : 1 - dow // Monday = 1
    const start = localToUtcIso(year, month, day + mondayOffset, 0, offsetMinutes)
    return {
      startDate: start,
      endDate: now.toISOString(),
      cleanQuery: lower.replace(/\bthis\s+week\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "this month" — month start local to now
  const thisMonthMatch = lower.match(/\bthis\s+month\b/)
  if (thisMonthMatch) {
    const { year, month } = getLocalParts(now, offsetMinutes)
    const start = localToUtcIso(year, month, 1, 0, offsetMinutes)
    return {
      startDate: start,
      endDate: now.toISOString(),
      cleanQuery: lower.replace(/\bthis\s+month\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "past N hours"
  const pastHoursMatch = lower.match(/\bpast\s+(\d+)\s+hours?\b/)
  if (pastHoursMatch) {
    const n = parseInt(pastHoursMatch[1], 10)
    const start = new Date(now.getTime() - n * 3600000)
    return {
      startDate: start.toISOString(),
      endDate: now.toISOString(),
      cleanQuery: lower.replace(/\bpast\s+\d+\s+hours?\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "past N days"
  const pastDaysMatch = lower.match(/\bpast\s+(\d+)\s+days?\b/)
  if (pastDaysMatch) {
    const n = parseInt(pastDaysMatch[1], 10)
    const start = new Date(now.getTime() - n * 86400000)
    return {
      startDate: start.toISOString(),
      endDate: now.toISOString(),
      cleanQuery: lower.replace(/\bpast\s+\d+\s+days?\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  // "last week"
  const lastWeekMatch = lower.match(/\blast\s+week\b/)
  if (lastWeekMatch) {
    const start = new Date(now.getTime() - 7 * 86400000)
    return {
      startDate: start.toISOString(),
      endDate: now.toISOString(),
      cleanQuery: lower.replace(/\blast\s+week\b/gi, '').replace(/\s+/g, ' ').trim(),
    }
  }

  return { cleanQuery: query }
}
