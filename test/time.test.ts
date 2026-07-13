import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTimeRange } from '../src/utils/time.ts'

test('today sets a start date and strips the token', () => {
  const r = parseTimeRange('what did I do today')
  assert.ok(r.startDate)
  assert.ok(!r.cleanQuery.includes('today'))
})

test('yesterday sets start and end', () => {
  const r = parseTimeRange('yesterday I coded')
  assert.ok(r.startDate)
  assert.ok(r.endDate)
  assert.ok(!r.cleanQuery.includes('yesterday'))
})

test('N days ago sets a start', () => {
  const r = parseTimeRange('commits from 3 days ago')
  assert.ok(r.startDate)
  assert.ok(!r.cleanQuery.includes('days'))
})

test('named month date parses', () => {
  const r = parseTimeRange('on July 11 I shipped the feature')
  assert.ok(r.startDate)
  assert.ok(r.startDate!.includes('-07-11'))
  assert.ok(!r.cleanQuery.includes('july'))
})
