import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import fetch from 'node-fetch'
import { logger } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_PATH = path.resolve(__dirname, '..', 'package.json')
const RELEASE_DIR = path.resolve(__dirname, '..', '..', 'release')

interface ReleaseInfo {
  version: string
  url?: string
  notes?: string
}

function semverGreater(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

// Lightweight update check. Polls a configurable JSON endpoint that returns
// { version, url, notes }. Reports when a newer release is available.
export async function checkForUpdate(updateUrl?: string): Promise<ReleaseInfo | null> {
  if (!updateUrl) return null
  try {
    const res = await fetch(updateUrl, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) return null
    const data = (await res.json()) as ReleaseInfo
    const raw = fs.readFileSync(PKG_PATH, 'utf-8')
    const current = (JSON.parse(raw).version ?? '0.0.0') as string
    if (semverGreater(data.version, current)) {
      logger.info(`update available: ${data.version} (current ${current})${data.url ? ' — ' + data.url : ''}`)
      if (data.notes) logger.info(`release notes: ${data.notes}`)
      return data
    }
    logger.debug(`up to date (${current})`)
    return null
  } catch (err) {
    logger.debug(`update check skipped: ${err}`)
    return null
  }
}

// Download the release asset to ./release so the user has the new binary.
// Returns the destination path on success.
export async function downloadUpdate(release: ReleaseInfo): Promise<string | null> {
  if (!release.url) return null
  try {
    if (!fs.existsSync(RELEASE_DIR)) fs.mkdirSync(RELEASE_DIR, { recursive: true })
    const ext = path.extname(new URL(release.url).pathname) || '.exe'
    const dest = path.join(RELEASE_DIR, `trace-${release.version}${ext}`)
    const res = await fetch(release.url)
    if (!res.ok || !res.body) {
      logger.error(`update download failed: HTTP ${res.status}`)
      return null
    }
    await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(dest))
    logger.info(`update downloaded: ${dest}`)
    return dest
  } catch (err) {
    logger.error(`update download failed: ${err}`)
    return null
  }
}

// Attempt to swap the running packaged binary with the downloaded one.
// Only runs for pkg-built executables. On Windows the running exe is usually
// locked, so this falls back to a clear log telling the user to restart.
export function applyDownloadedUpdate(downloadedPath: string): void {
  const exe = process.execPath
  if (!(process as { pkg?: unknown }).pkg) {
    logger.info(`not a packaged binary; apply the update manually (e.g. npm update) — downloaded to ${downloadedPath}`)
    return
  }
  try {
    const old = exe + '.old'
    if (fs.existsSync(old)) fs.unlinkSync(old)
    fs.renameSync(exe, old)
    fs.renameSync(downloadedPath, exe)
    logger.info('update applied; exiting so the supervisor can restart the new binary')
    process.exit(0)
  } catch (err) {
    logger.warn(`could not apply update in place (${String(err)}); restart and replace ${exe} with ${downloadedPath}`)
  }
}

