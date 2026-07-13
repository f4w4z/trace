import dotenv from 'dotenv'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import type { Config, EventSource } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const user = os.userInfo().username

function resolveVars(s: string): string {
  return s.replace(/%USERNAME%/g, user).replace(/%USERPROFILE%/g, os.homedir())
}

function envStr(key: string, fallback: string): string {
  return resolveVars(process.env[key] || fallback)
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key]
  return v ? parseInt(v, 10) : fallback
}

function envSources(key: string, fallback: string): EventSource[] {
  const raw = process.env[key] || fallback
  return raw.split(',').map(s => s.trim()).filter(Boolean) as EventSource[]
}

function envPaths(key: string, fallback: string): string[] {
  const raw = process.env[key] || fallback
  return raw.split(';').map(s => s.trim().replace(/%USERNAME%/g, user)).filter(Boolean)
}

export function loadConfig(): Config {
  const psHistory = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt')
  return {
    supermemoryUrl: envStr('SUPERMEMORY_URL', 'http://localhost:6767'),
    apiKey: envStr('SUPERMEMORY_API_KEY', ''),
    containerTag: envStr('CONTAINER_TAG', 'trace'),
    watchSources: envSources('WATCH_SOURCES', 'filesystem,editor,terminal,clipboard'),
    watchPaths: envPaths('WATCH_PATHS', ''),
    chromeHistory: envStr('CHROME_HISTORY', path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'History')),
    edgeHistory: envStr('EDGE_HISTORY', path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'History')),
    braveHistory: envStr('BRAVE_HISTORY', path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'History')),
    shellHistory: envStr('SHELL_HISTORY', psHistory),
    apiPort: envInt('API_PORT', 6768),
    hudPort: envInt('HUD_PORT', 6769),
    llmUrl: process.env.LLM_URL || undefined,
    llmModel: process.env.LLM_MODEL || undefined,
    llmApiKey: process.env.LLM_API_KEY || undefined,
    digestHour: envInt('DIGEST_HOUR', 21),
    updateUrl: process.env.UPDATE_URL || undefined,
    autoUpdateCheck: process.env.AUTO_UPDATE_CHECK ? process.env.AUTO_UPDATE_CHECK !== 'false' : true,
  }
}
