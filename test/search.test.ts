import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeQuery, expandSearchTerms } from '../src/utils/search.ts'

test('tokenizeQuery drops stopwords and punctuation', () => {
  const t = tokenizeQuery('What files did I edit yesterday?')
  assert.ok(!t.includes('what'))
  assert.ok(!t.includes('i'))
  assert.ok(t.includes('files'))
  assert.ok(t.includes('edit'))
  assert.ok(t.includes('yesterday')) // time-range words are stripped later by parseTimeRange
})

test('expandSearchTerms maps media aliases', () => {
  const e = expandSearchTerms(tokenizeQuery('spotify music'))
  assert.ok(e.includes('media'))
  assert.ok(e.includes('track_change'))
})

test('expandSearchTerms maps youtube aliases', () => {
  const e = expandSearchTerms(['youtube'])
  assert.ok(e.includes('yt'))
})
