import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ClipboardWatcher } from '../src/daemon/clipboard.ts'

test('redacts sensitive patterns', () => {
  const r = ClipboardWatcher.redact('password: hunter2')
  assert.equal(r.text, '[REDACTED sensitive content]')
  assert.equal(r.redacted, true)
})

test('redacts cloud keys', () => {
  const r = ClipboardWatcher.redact('token ghp_abcdef1234567890')
  assert.equal(r.redacted, true)
})

test('trims overly long text with ellipsis', () => {
  const r = ClipboardWatcher.redact('x'.repeat(500))
  assert.ok(r.text.endsWith('…'))
  assert.ok(r.text.length <= 282)
})

test('keeps normal text and flags not redacted', () => {
  const r = ClipboardWatcher.redact('hello world')
  assert.equal(r.text, 'hello world')
  assert.equal(r.redacted, false)
})
