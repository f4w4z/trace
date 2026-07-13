import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, getRelativeTime } from '../src/shared/text.ts'

test('cleanTitle strips browser suffixes', () => {
  assert.equal(cleanTitle('GitHub — whatever - Google Chrome'), 'GitHub — whatever')
  assert.equal(cleanTitle('Video - YouTube'), 'Video')
})

test('getRelativeTime reports recency', () => {
  assert.equal(getRelativeTime(new Date().toISOString()), 'just now')
  assert.ok(getRelativeTime(new Date(Date.now() - 5 * 60000).toISOString()).endsWith('m ago'))
})
