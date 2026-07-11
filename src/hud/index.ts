import express from 'express'
import type { Express, Request, Response } from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Config } from '../types.js'
import type { SupermemoryClient } from '../supermemory.js'
import { ContextService } from '../api/context.js'
import { logger } from '../utils/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const hudUiPath = path.resolve(__dirname, '..', '..', 'hud-ui')

export function createHudServer(config: Config, supermemory: SupermemoryClient): { app: Express; start: () => void } {
  const context = new ContextService(supermemory)
  const app = express()
  const server = createServer(app)
  const wss = new WebSocketServer({ server })

  app.use(express.static(hudUiPath))

  app.get('/api/current', async (_req: Request, res: Response) => {
    try { res.json(await context.getCurrentContext()) }
    catch (err) { res.status(500).json({ error: String(err) }) }
  })

  app.get('/api/day', async (req: Request, res: Response) => {
    try {
      const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10)
      res.json(await context.getDayContext(date))
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  app.get('/api/query', async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) ?? ''
      if (!q) { res.status(400).json({ error: 'q required' }); return }
      const useLLM = req.query.llm === 'true'
      res.json(useLLM
        ? await context.queryWithLLM(q, [], config.llmUrl, config.llmModel, config.llmApiKey)
        : await context.searchContext(q))
    } catch (err) { res.status(500).json({ error: String(err) }) }
  })

  wss.on('connection', (ws: WebSocket) => {
    logger.debug('HUD WebSocket connected')
    const interval = setInterval(async () => {
      try { ws.send(JSON.stringify({ type: 'context_update', data: await context.getCurrentContext() })) }
      catch { /* ignore */ }
    }, 15000)
    ws.on('close', () => { clearInterval(interval); logger.debug('HUD WebSocket disconnected') })
  })

  function start(): void {
    server.listen(config.hudPort, () => {
      logger.info(`HUD UI at http://localhost:${config.hudPort}`)
    })
  }

  return { app, start }
}
