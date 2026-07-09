import express from 'express'
import type { Express, Request, Response } from 'express'
import type { Config } from '../types.js'
import type { SupermemoryClient } from '../supermemory.js'
import { ContextService } from './context.js'
import { logger } from '../utils/logger.js'

export function createApi(config: Config, supermemory: SupermemoryClient, daemonCtl?: { stop: () => void; start: () => void; isRunning: () => boolean }): Express {
  const context = new ContextService(supermemory)
  const app = express()

  app.use(express.json())

  app.get('/context/current', async (_req: Request, res: Response) => {
    try {
      const ctx = await context.getCurrentContext()
      res.json(ctx)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/context/query', async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) ?? ''
      if (!q) { res.status(400).json({ error: 'q required' }); return }
      const useLLM = req.query.llm === 'true'
      const result = useLLM
        ? await context.queryWithLLM(q, config.llmUrl, config.llmModel, config.llmApiKey)
        : await context.searchContext(q)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/context/day', async (req: Request, res: Response) => {
    try {
      const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10)
      const dayCtx = await context.getDayContext(date)
      res.json(dayCtx)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // Management
  app.get('/admin/status', async (_req: Request, res: Response) => {
    try {
      const smOk = await supermemory.healthCheck()
      res.json({
        status: smOk ? 'ok' : 'degraded',
        supermemory: smOk,
        daemon: daemonCtl ? daemonCtl.isRunning() : false,
        containerTag: config.containerTag,
      })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.post('/admin/daemon/pause', (_req: Request, res: Response) => {
    if (daemonCtl) daemonCtl.stop()
    res.json({ daemon: false })
  })

  app.post('/admin/daemon/resume', (_req: Request, res: Response) => {
    if (daemonCtl) daemonCtl.start()
    res.json({ daemon: daemonCtl ? daemonCtl.isRunning() : false })
  })

  app.delete('/admin/memories', async (_req: Request, res: Response) => {
    try {
      const ok = await context.clearAllMemories()
      res.json({ cleared: ok })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // MCP / OpenCode tool integration
  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const { tool, args } = req.body as { tool: string; args: Record<string, unknown> }

      switch (tool) {
        case 'get_current_context': {
          const ctx = await context.getCurrentContext()
          res.json({ tool, result: ctx })
          break
        }
        case 'search_context': {
          const q = (args?.q ?? args?.query ?? '') as string
          const useLLM = (args?.llm === true || args?.llm === 'true')
          const result = useLLM
            ? await context.queryWithLLM(q, config.llmUrl, config.llmModel, config.llmApiKey)
            : await context.searchContext(q)
          res.json({ tool, result })
          break
        }
        case 'get_day_context': {
          const date = (args?.date as string) ?? new Date().toISOString().slice(0, 10)
          const dayCtx = await context.getDayContext(date)
          res.json({ tool, result: dayCtx })
          break
        }
        default:
          res.status(400).json({ tool, error: `unknown tool: ${tool}` })
      }
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/mcp/tools', (_req: Request, res: Response) => {
    res.json({
      tools: [
        {
          name: 'get_current_context',
          description: 'Return what the user is doing right now — active project, recent events, current session',
          schema: { type: 'object', properties: {} },
        },
        {
          name: 'search_context',
          description: 'Search the user\'s memories for relevant context. Optionally use LLM for Q&A.',
          schema: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Natural language query' },
              query: { type: 'string', description: 'Alias for q' },
              llm: { type: 'boolean', description: 'Use LLM to answer based on memories' },
            },
            required: ['q'],
          },
        },
        {
          name: 'get_day_context',
          description: 'Get a full day summary with sessions grouped by project',
          schema: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'YYYY-MM-DD (default: today)' },
            },
          },
        },
      ],
    })
  })

  app.get('/health', async (_req: Request, res: Response) => {
    const smOk = await supermemory.healthCheck()
    res.json({ status: smOk ? 'ok' : 'degraded', supermemory: smOk })
  })

  return app
}
