import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractProject, timeBucket } from '../src/utils/events.ts'

test('extractProject returns the containing directory, not the file', () => {
  assert.equal(extractProject('C:\\Projects\\foo\\src\\index.ts'), 'src')
  assert.equal(extractProject('/home/user/proj/x.ts'), 'proj')
  assert.equal(extractProject('/tmp/.cache/thing'), 'thing')
  assert.equal(extractProject('C:\\Projects\\.git'), 'Projects')
})

test('timeBucket buckets by hour', () => {
  assert.equal(timeBucket(new Date(2026, 0, 1, 9)), 'morning')
  assert.equal(timeBucket(new Date(2026, 0, 1, 14)), 'afternoon')
  assert.equal(timeBucket(new Date(2026, 0, 1, 22)), 'night')
})
