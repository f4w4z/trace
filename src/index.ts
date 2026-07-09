import { loadConfig } from './config.js'
import { SupermemoryClient } from './supermemory.js'
import { Daemon } from './daemon/index.js'
import { createApi } from './api/index.js'
import { createHudServer } from './hud/index.js'
import { logger } from './utils/logger.js'

const config = loadConfig()
const supermemory = new SupermemoryClient(config.supermemoryUrl, config.apiKey, config.containerTag)
const daemon = new Daemon(config, supermemory)

const daemonCtl = {
  stop: () => daemon.stop(),
  start: () => daemon.start(),
  isRunning: () => daemon.isRunning(),
}

const api = createApi(config, supermemory, daemonCtl)
const hud = createHudServer(config, supermemory)

async function main(): Promise<void> {
  logger.info('smt — Local Context Cloud starting')
  logger.info(`  supermemory: ${config.supermemoryUrl}`)
  logger.info(`  containerTag: ${config.containerTag}`)
  logger.info(`  apiKey: ${config.apiKey ? 'set' : 'not set (optional for local)'}`)

  const healthy = await supermemory.healthCheck()
  if (!healthy) {
    logger.warn('supermemory local not reachable — start it on localhost:6767 first')
    logger.info('continuing in degraded mode')
  } else {
    logger.info('supermemory local reachable')
  }

  daemon.start()

  api.listen(config.apiPort, () => {
    logger.info(`context API at http://localhost:${config.apiPort}`)
    logger.info(`  GET  /context/current   — what you are doing now`)
    logger.info(`  GET  /context/query?q=   — search your memories (?llm=true for Q&A)`)
    logger.info(`  GET  /context/day?date=  — daily summary`)
    logger.info(`  POST /mcp                — MCP tool integration`)
    logger.info(`  GET  /mcp/tools           — list available MCP tools`)
    logger.info(`  POST /admin/daemon/pause  — pause ingestion`)
    logger.info(`  POST /admin/daemon/resume — resume ingestion`)
    logger.info(`  DELETE /admin/memories    — clear all memories`)
    logger.info(`  GET  /health             — service health`)
  })

  hud.start()
  logger.info(`hud: http://localhost:${config.hudPort} — Alt+Space overlay in your browser`)
}

process.on('SIGINT', () => { logger.info('shutting down...'); daemon.stop(); process.exit(0) })
process.on('SIGTERM', () => { daemon.stop(); process.exit(0) })

main().catch(err => { logger.error(`fatal: ${err}`); process.exit(1) })
