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
      const tz = parseInt(req.query.tz as string, 10) || 0
      const result = useLLM
        ? await context.queryWithLLM(q, [], config.llmUrl, config.llmModel, config.llmApiKey, tz)
        : await context.searchContext(q, tz)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.post('/context/query', async (req: Request, res: Response) => {
    try {
      const q = req.body.q ?? ''
      const history = req.body.history ?? []
      if (!q) { res.status(400).json({ error: 'q required' }); return }
      const useLLM = req.body.llm === true
      const tz = parseInt(req.body.tz, 10) || 0
      const result = useLLM
        ? await context.queryWithLLM(q, history, config.llmUrl, config.llmModel, config.llmApiKey, tz)
        : await context.searchContext(q, tz)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/context/chat', async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) ?? ''
      if (!q) { res.status(400).json({ error: 'q required' }); return }
      const result = await context.chat(q, [], config.llmUrl, config.llmModel, config.llmApiKey)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.post('/context/chat', async (req: Request, res: Response) => {
    try {
      const q = req.body.q ?? ''
      const history = req.body.history ?? []
      if (!q) { res.status(400).json({ error: 'q required' }); return }
      const result = await context.chat(q, history, config.llmUrl, config.llmModel, config.llmApiKey)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/context/summary', async (req: Request, res: Response) => {
    try {
      const since = req.query.since as string | undefined
      const contextParam = req.query.context as string | undefined
      const result = await context.getSummary(since, contextParam)
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

  app.get('/context/recent-files', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 20
      res.json({ files: await context.getRecentFiles(limit) })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/context/project', async (req: Request, res: Response) => {
    try {
      const project = (req.query.project as string) ?? ''
      if (!project) { res.status(400).json({ error: 'project required' }); return }
      res.json({ project, memories: await context.recallByProject(project) })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/context/timeline', async (req: Request, res: Response) => {
    try {
      const start = (req.query.start as string) ?? ''
      const end = (req.query.end as string) ?? ''
      if (!start) { res.status(400).json({ error: 'start required' }); return }
      res.json(await context.getTimelineRange(start, end))
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/context/topics', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 8
      res.json({ topics: await context.getTopics(limit) })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  app.get('/context/predict', async (req: Request, res: Response) => {
    try {
      const project = (req.query.project as string) ?? undefined
      const p = (req.query.path as string) ?? undefined
      res.json(await context.predictContext(project, p))
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

  app.post('/admin/compact', async (_req: Request, res: Response) => {
    try {
      const result = await supermemory.compact()
      res.json({ compacted: result.archived, bytesSaved: result.bytesSaved })
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
            ? await context.queryWithLLM(q, [], config.llmUrl, config.llmModel, config.llmApiKey)
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
        case 'get_recent_files': {
          const limit = (args?.limit as number) ?? 20
          res.json({ tool, result: { files: await context.getRecentFiles(limit) } })
          break
        }
        case 'recall_by_project': {
          const project = (args?.project ?? args?.q ?? '') as string
          if (!project) { res.status(400).json({ tool, error: 'project required' }); break }
          res.json({ tool, result: { project, memories: await context.recallByProject(project) } })
          break
        }
        case 'get_timeline_range': {
          const start = (args?.start ?? '') as string
          const end = (args?.end as string) ?? ''
          if (!start) { res.status(400).json({ tool, error: 'start required' }); break }
          res.json({ tool, result: await context.getTimelineRange(start, end) })
          break
        }
        case 'get_topics': {
          const limit = (args?.limit as number) ?? 8
          res.json({ tool, result: { topics: await context.getTopics(limit) } })
          break
        }
        case 'predict_context': {
          const project = (args?.project as string) ?? undefined
          const p = (args?.path as string) ?? undefined
          res.json({ tool, result: await context.predictContext(project, p) })
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
        {
          name: 'get_recent_files',
          description: 'List the most recently touched files with last-seen time and edit count',
          schema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max files to return (default 20)' },
            },
          },
        },
        {
          name: 'recall_by_project',
          description: 'Recall all memories associated with a specific project',
          schema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Project name' },
            },
            required: ['project'],
          },
        },
        {
          name: 'get_timeline_range',
          description: 'Get every event between a start and end timestamp (ISO)',
          schema: {
            type: 'object',
            properties: {
              start: { type: 'string', description: 'ISO start timestamp' },
              end: { type: 'string', description: 'ISO end timestamp (default: now)' },
            },
            required: ['start'],
          },
        },
        {
          name: 'get_topics',
          description: 'Return emergent topics/clusters derived from recent activity',
          schema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max topics (default 8)' },
            },
          },
        },
        {
          name: 'predict_context',
          description: 'Proactively surface memories and files relevant to a project or path',
          schema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Project name' },
              path: { type: 'string', description: 'File path to infer context from' },
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
