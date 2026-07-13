import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContextService } from '../src/api/context.ts'
import type { SupermemoryMemory } from '../src/types.ts'

const now = Date.now()
const docs: SupermemoryMemory[] = [
  { id: '1', content: 'Edited index.ts', source: 'filesystem', createdAt: new Date(now - 1000).toISOString(), metadata: { source: 'filesystem', path: 'C:/Projects/trace/src/index.ts', app: 'code' } },
  { id: '2', content: 'Commit in foo', source: 'editor', createdAt: new Date(now - 2000).toISOString(), metadata: { source: 'editor', path: 'C:/Projects/foo/x.ts', project: 'foo', tags: ['foo'] } },
  { id: '3', content: 'Browsed github', source: 'browser', createdAt: new Date(now - 3000).toISOString(), metadata: { source: 'browser', url: 'https://github.com' } },
]

class FakeClient {
  async listDocuments(limit = 100) { return limit > 0 ? docs.slice(0, limit) : docs }
  async searchQuery() { return [] }
  async addDocument() { return 'x' }
  async deleteContainerTag() { return true }
}

const ctx = new ContextService(new FakeClient() as unknown as import('../src/types.ts').SupermemoryClient)

test('getRecentFiles lists file events newest-first', async () => {
  const files = await ctx.getRecentFiles(10)
  assert.equal(files.length, 2)
  assert.equal(files[0].path, 'C:/Projects/trace/src/index.ts')
  assert.ok(files[0].count >= 1)
})

test('recallByProject returns only that project', async () => {
  const memories = await ctx.recallByProject('foo')
  assert.equal(memories.length, 1)
  assert.equal((memories[0].metadata as { project?: string }).project, 'foo')
})

test('getTopics derives topics from activity', async () => {
  const topics = await ctx.getTopics(5)
  assert.ok(Array.isArray(topics))
  assert.ok(topics.some(t => t.name === 'foo'))
})

test('predictContext surfaces relevant memories and files', async () => {
  const result = await ctx.predictContext('foo')
  assert.equal(result.project, 'foo')
  assert.ok(result.relatedMemories.some(m => (m.metadata as { project?: string }).project === 'foo'))
  assert.ok(result.suggestedFiles.some(f => f.includes('foo')))
})
