# trace — Local Context Cloud

`trace` gives your AI assistants and coding tools a persistent memory of what you do on your
computer. It continuously captures activity (foreground apps, browser tabs, file edits, terminal
commands, git activity, clipboard snippets, and media playback), indexes it locally with
[Supermemory Local](https://supermemory.ai), and exposes it through a chat overlay, a web
dashboard, and a REST / MCP API. Nothing leaves your machine unless you point it at an external
LLM.

## Project structure

| Path | What it is |
| --- | --- |
| `setup.bat` / `setup.mjs` | First-run installer — animated, interactive CLI that checks prerequisites, wires up your AI key, installs dependencies, builds, and starts Trace. |
| `start.vbs` | Windows launcher — auto-elevates, cleans up stale processes, starts the Docker service, and opens the Electron app. |
| `stop.vbs` | Windows teardown — stops the Electron app and Docker service. |
| `src/` | The core **backend daemon** (TypeScript). `index.ts` is the entry point; compiled to `dist/`. Contains the capture watchers (`daemon/`), REST/MCP API (`api/`), HUD server (`hud/`), and shared utilities (`utils/`, `services/`, `shared/`). |
| `app/` | The **Electron desktop client** (`main.cjs`, preload, renderer, tray, splash, assets). |
| `hud-ui/` | The **HUD web UI** — the Alt+X overlay, served at runtime by `src/hud`. |
| `site/` | Standalone **landing/marketing page** (`index.html`). |
| `test/` | **Automated test suite** (`*.test.ts`), run with `npm test`. |
| `.github/` | CI workflow (`.github/workflows/ci.yml`). |
| Config files | `docker-compose.yml`, `Dockerfile`, `electron-builder.yml`, `tsconfig.json`, `.env.example` at the root. |

## Why

Every time you ask an AI about your work, it starts blank — it has no idea what files you edited,
what commands you ran, which tabs you had open, or what project you were focused on. `trace`
bridges that gap: it records activity as structured events, indexes them into a searchable memory
store, and lets you query everything with natural language. Your context persists forever, locally.

## How it works

### Capture

A set of daemon watchers run continuously in the background:

| Watcher | What it records |
| --- | --- |
| **System tracker** (`tracker.ts`) | Foreground window changes, browser URLs (via Windows UI Automation), process snapshots, idle start/end, and now-playing media via Windows SMTC |
| **Browser history** (`browser.ts`) | One-time backfill of Chrome, Edge, and Brave SQLite history files on startup (reads a temporary copy so the live database stays unlocked) |
| **Editor / Git** (`editor.ts`) | Branch switches and new commits detected by watching `.git/HEAD` and `.git/logs/HEAD` across all git repos under `WATCH_PATHS` |
| **Filesystem** (`filesystem.ts`) | File-change events under `WATCH_PATHS` via chokidar |
| **Terminal** (`terminal.ts`) | PowerShell history (`PSReadLine`) and configurable shell history files |
| **Clipboard** (`clipboard.ts`) | Windows clipboard changes — sensitive patterns (passwords, tokens, keys) are replaced with `[REDACTED sensitive content]`; other snippets are trimmed to 280 characters |

Every event is timestamped and tagged with source, app, and project, then written to
`~/.trace/events.jsonl` (source of truth) and asynchronously indexed in Supermemory Local.

### Store

- **Primary** — Supermemory Local on port `6767`: hybrid vector + keyword search with chunking
  and embeddings.
- **Fallback** — if Supermemory is unreachable, queries perform a full scan of the local
  `events.jsonl` file.

### Query

An Express server on port `6768` exposes REST endpoints for context retrieval, search, daily
summaries, and MCP-compatible tools for AI agents. An optional LLM-powered Q&A mode sends your
query plus relevant memories to any OpenAI-compatible endpoint and returns a cited
natural-language answer.

### Access

| Interface | How |
| --- | --- |
| **Electron overlay** | Press <kbd>Alt+X</kbd> for a frameless chat window with live activity, AI Q&A, and conversation history |
| **Web HUD** | `http://localhost:6769` — live activity feed, session timeline, and keyboard-navigable search |
| **API / MCP** | Use directly or integrate into OpenCode, Claude Code, Cursor, and other agents |

---

## Quick start

```bash
# 1. Configure
cp .env.example .env        # edit SUPERMEMORY_API_KEY, LLM_URL, etc.

# 2. Run Supermemory Local (Docker required)
docker compose up -d

# 3. Install and start trace
npm install
npm run dev                 # hot-reload with tsx watch
# — or —
npm run build && npm start  # compiled output
```

**Desktop overlay** (Electron):

```bash
npm run app                 # launches app/main.cjs
```

On Windows, double-click **`start.vbs`** to auto-elevate, clean up stale processes, start the
Docker container, and launch the Electron app in one shot. **`stop.vbs`** tears everything down.

---

## Configuration

Copy `.env.example` to `.env`. All variables are read at startup.

| Variable | Default | Description |
| --- | --- | --- |
| `SUPERMEMORY_URL` | `http://localhost:6767` | Supermemory Local endpoint |
| `SUPERMEMORY_API_KEY` | _(empty)_ | Printed on first Supermemory boot |
| `CONTAINER_TAG` | `trace` | Namespace for your memories |
| `WATCH_SOURCES` | `filesystem,editor,terminal,clipboard` | Comma-separated capture sources |
| `WATCH_PATHS` | _(empty)_ | Semicolon-separated directories to monitor |
| `CHROME_HISTORY` | OS default | Chrome SQLite history path |
| `EDGE_HISTORY` | OS default | Edge SQLite history path |
| `BRAVE_HISTORY` | OS default | Brave SQLite history path |
| `SHELL_HISTORY` | PSReadLine history | PowerShell / shell history file path |
| `API_PORT` | `6768` | Context API port |
| `HUD_PORT` | `6769` | Web HUD port |
| `DIGEST_HOUR` | `21` | Local hour (0–23) to write the daily markdown digest |
| `AUTO_UPDATE_CHECK` | `true` | Poll `UPDATE_URL` for a newer release (report only) |
| `AUTO_UPDATE_DOWNLOAD` | `false` | Also download the release asset to `./release` when a newer version is found |
| `UPDATE_URL` | _(empty)_ | JSON endpoint returning `{ version, url, notes }` |
| `LLM_URL` | _(empty)_ | OpenAI-compatible base URL for AI Q&A |
| `LLM_MODEL` | _(empty)_ | Model name (e.g. `gpt-4o`) |
| `LLM_API_KEY` | _(empty)_ | API key for the LLM endpoint |

---

## API

All endpoints return JSON. The server runs on `API_PORT` (default `6768`).

| Endpoint | Method | Description |
| --- | --- | --- |
| `/context/current` | GET | Active project, recent events, and current session |
| `/context/query?q=...&llm=true` | GET / POST | Search memories; add `llm=true` for a cited AI answer |
| `/context/chat?q=...` | GET / POST | Free-form AI chat without activity context |
| `/context/summary?since=...` | GET | LLM summary of recent activity |
| `/context/day?date=YYYY-MM-DD` | GET | Full day grouped by project and session |
| `/context/recent-files?limit=20` | GET | Most recently touched files |
| `/context/project?project=...` | GET | All memories for a project |
| `/context/timeline?start=ISO&end=ISO` | GET | Every event in a time range |
| `/context/topics?limit=8` | GET | Emergent topics clustered from activity |
| `/context/predict?project=&path=` | GET | Proactively relevant memories and files |
| `/admin/status` | GET | Daemon and Supermemory status |
| `/admin/daemon/pause` · `/admin/daemon/resume` | POST | Pause / resume ingestion |
| `/admin/compact` | POST | Gzip old JSONL archives to save disk |
| `/admin/memories` | DELETE | Clear all stored memories |
| `/mcp` | POST | MCP tool call |
| `/mcp/tools` | GET | List available MCP tools |
| `/health` | GET | Service health + Supermemory status |

---

## MCP integration

Point your agent at `POST /mcp` with a tool name and arguments:

```json
{ "tool": "search_context", "args": { "q": "what was I working on yesterday", "llm": true } }
```

Available tools: `get_current_context`, `search_context` (`llm` flag supported),
`get_day_context`, `get_recent_files`, `recall_by_project`, `get_timeline_range`, `get_topics`,
`predict_context`.

**Cursor / Claude Code config** (`mcpServers`):

```json
{
  "trace": {
    "url": "http://localhost:6768/mcp"
  }
}
```

---

## Deployment (Docker)

Supermemory Local runs as a container on `localhost:6767`. The provided `Dockerfile` and
`docker-compose.yml` build and run it with a named volume (`supermemory-data/`) for persistent
storage.

```bash
docker compose up -d          # start
docker compose down           # stop
docker compose logs -f        # follow logs
```

On Windows, `start.vbs` manages the full lifecycle (elevate → kill stale processes →
`docker compose up -d` → launch Electron).

---

## Project layout

```
src/
  index.ts              entry point (config → supermemory → daemon → api → hud)
  config.ts             env loading and config types
  supermemory.ts        Supermemory Local v3 client + local JSONL fallback store
  types.ts              shared TypeScript interfaces
  watchdog.ts           crash-loop supervisor (max 5 restarts/min)
  daemon/
    index.ts            orchestrates all watchers
    tracker.ts          system tracker (PowerShell: foreground, browser URL, processes, idle, media)
    browser.ts          browser history backfill (Chrome / Edge / Brave via sql.js)
    editor.ts           git commit and branch-switch watcher (chokidar on .git/HEAD)
    filesystem.ts       file-change watcher (chokidar on WATCH_PATHS)
    terminal.ts         shell history watcher (PSReadLine + configurable path)
    clipboard.ts        Windows clipboard monitor with sensitive-content redaction
  api/
    index.ts            Express router + MCP handler
    context.ts          all /context/* and /admin/* endpoint logic
  hud/                  Express + WebSocket server for the web HUD (:6769)
  services/
    digest.ts           daily markdown digest scheduler
  utils/                logger, event helpers, time bucketing, search, updater
  shared/               text helpers shared between server and Electron UI
app/                    Electron overlay (main.cjs, renderer.js, preload.cjs, assets)
hud-ui/                 web HUD frontend (app.js, index.html, style.css)
site/                   public landing page
```

---

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run with `tsx watch` (hot reload) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run hud` | Start in HUD-only mode (`--hud-only`) |
| `npm run watchdog` | Run under the crash-loop supervisor |
| `npm run build:bin` | Build standalone binaries via `pkg` for win/linux/mac |
| `npm run app` | Launch the Electron overlay |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm test` | Run tests under `test/*.test.ts` |

> **Note on `build:bin`**: The project uses ESM + `import.meta.url`, which `pkg` 5.x does not
> virtualize. For now, run the server via `node dist/index.js` or `npm run watchdog`.

---

## Intelligence features

- **Semantic dedup** — near-duplicate events (same source + normalized content within 10 min) are
  dropped before they reach the store.
- **Search-engine extraction** — browser URLs from Google, Bing, DuckDuckGo, YouTube, and Amazon
  are parsed to extract the underlying search query and store it as structured metadata.
- **Media tracking** — Windows SMTC (System Media Transport Controls) is polled every 3 s to
  capture now-playing track/artist changes across all media apps.
- **Topic clustering** — `/context/topics` derives emergent topics from recent activity using
  frequent keywords, tags, and project names.
- **Predictive context** — `/context/predict` proactively surfaces memories and files relevant to
  a project or file path; wire it into an editor extension for live context injection.
- **Auto daily digest** — at `DIGEST_HOUR` (local time) a markdown summary is written to
  `~/.trace/digests/YYYY-MM-DD.md`.
- **Compaction** — rotated JSONL archives are gzipped on demand (`POST /admin/compact`); reads
  transparently decompress `.gz` files.

---

## Resilience

- **Crash-loop protection** — `npm run watchdog` runs a supervisor that restarts the server on
  unexpected exit, capped at 5 restarts per minute.
- **Degraded mode** — if Supermemory is unreachable on startup, trace continues with a full local
  scan fallback; Supermemory is re-probed on each query.
- **System tracker self-healing** — the PowerShell subprocess restarts automatically on exit or
  error, with the same 5-restarts-per-minute cap.
- **Auto-update** — when `AUTO_UPDATE_CHECK=true` and `UPDATE_URL` is set, trace polls that JSON
  endpoint and logs available updates. Set `AUTO_UPDATE_DOWNLOAD=true` to also fetch the release
  asset into `./release` (manual restart required to apply).
- **Prebuilt desktop installer** — the Electron overlay packages with `electron-builder`
  (`npm run dist:app`, produces `release/Trace Setup*.exe`).
