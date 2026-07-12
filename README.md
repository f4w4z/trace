# trace — Local Context Cloud

`trace` gives your AI assistants and coding tools a persistent memory of what you do on your
computer. It continuously captures activity (files, editor projects, terminal commands, browser
tabs, and idle state), indexes it locally with [Supermemory Local](https://supermemory.ai), and
exposes it through a chat overlay, a web dashboard, and a REST/MCP API. Nothing leaves your
machine unless you point it at an external LLM.

> Renamed from `smt` → `trace`.

## Why

Every time you ask an AI about your work, it starts blank — it has no idea what files you edited,
what commands you ran, which tabs you had open, or what project you were focused on. `trace`
bridges that gap: it records activity as structured events, indexes them into a searchable memory
store, and lets you query everything with natural language. Your context persists forever, locally.

## How it works

- **Capture** — A persistent tracker monitors foreground window changes, browser URLs (via UI
  Automation), running processes, and idle state. Separate watchers track file edits (chokidar),
  editor projects, and terminal history. Every event is timestamped and tagged with source, app,
  and project.
- **Store** — Each event is written immediately to `~/.trace/events.jsonl` (the source of truth)
  and asynchronously posted to Supermemory Local on port `6767` for chunking, embedding, and
  hybrid vector+keyword search. If Supermemory is down, queries fall back to a full local scan.
- **Query** — An Express server on port `6768` exposes REST endpoints for context retrieval,
  search, daily summaries, and MCP-compatible tools for AI agents. An optional LLM-powered Q&A
  mode sends your query plus relevant memories to any OpenAI-compatible endpoint and returns a
  cited natural-language answer.
- **Access**
  - **Electron overlay** — Press <kbd>Alt+X</kbd> for a frameless chat window (greeting, live
    activity, AI Q&A, conversation history, onboarding wizard).
  - **Web HUD** — Open `http://localhost:6769` for a live activity feed, session timeline, and
    search with keyboard navigation.
  - **API / MCP** — Use directly, or integrate into OpenCode, Claude Code, Cursor, and other
    agents.

## Quick start

```bash
# 1. Configure
cp .env.example .env        # edit SUPERMEMORY_API_KEY etc.

# 2. Run Supermemory Local (Docker, recommended on Windows/WSL2)
docker compose up -d

# 3. Start trace
npm install
npm run dev                 # or: npm run build && npm start
```

Launch the desktop overlay:

```bash
npm run app                 # electron app/main.cjs
```

On Windows, `start.vbs` elevates and launches the Electron app + WSL Supermemory lifecycle;
`stop.vbs` tears everything down.

## Configuration

Copy `.env.example` to `.env`. Variables read at startup:

| Variable | Default | Description |
| --- | --- | --- |
| `SUPERMEMORY_URL` | `http://localhost:6767` | Supermemory Local endpoint |
| `SUPERMEMORY_API_KEY` | _(empty)_ | Printed on first Supermemory boot |
| `CONTAINER_TAG` | `trace` | Namespace for your memories |
| `WATCH_SOURCES` | `filesystem,editor,terminal` | Comma-separated capture sources |
| `WATCH_PATHS` | _(empty)_ | Semicolon-separated directories to monitor |
| `CHROME_HISTORY` / `EDGE_HISTORY` / `BRAVE_HISTORY` | OS default | Browser history paths |
| `SHELL_HISTORY` | PowerShell `PSReadLine` history | Terminal history path |
| `API_PORT` | `6768` | Context API port |
| `HUD_PORT` | `6769` | Web HUD port |
| `LLM_URL` / `LLM_MODEL` / `LLM_API_KEY` | _(empty)_ | OpenAI-compatible endpoint for AI Q&A |

## API

All endpoints return JSON. The server runs on port `6768`.

| Endpoint | Method | Description |
| --- | --- | --- |
| `/context/current` | GET | Active project, recent events, current session |
| `/context/query?q=...&llm=true` | GET / POST | Search memories (optionally an AI answer) |
| `/context/chat?q=...` | GET / POST | Free-form AI chat (no activity context) |
| `/context/summary?since=...` | GET | LLM summary of recent activity |
| `/context/day?date=YYYY-MM-DD` | GET | Full day with sessions grouped by project |
| `/admin/status` | GET | Daemon + Supermemory status |
| `/admin/daemon/pause` · `/admin/daemon/resume` | POST | Pause / resume ingestion |
| `/admin/memories` | DELETE | Clear all stored memories |
| `/mcp` | POST | MCP tool integration (`get_current_context`, `search_context`, `get_day_context`) |
| `/mcp/tools` | GET | List available MCP tools |
| `/health` | GET | Service health + Supermemory status |

## MCP integration

Point your agent at `POST /mcp` with a tool name and args:

```json
{ "tool": "search_context", "args": { "q": "what was I working on yesterday", "llm": true } }
```

Tools: `get_current_context`, `search_context` (supports `llm`), `get_day_context`.

## Deployment (Docker / WSL2)

Supermemory Local runs as a single binary/container on `localhost:6767`. The provided
`Dockerfile` and `docker-compose.yml` run it with a named volume (`supermemory-data/`) for fast,
persistent storage. On Windows, `setup_wsl2.sh` / `move-to-wsl2.ps1` help relocate the project
into WSL2's Linux filesystem so Docker accesses files without crossing the Windows ↔ WSL boundary.

## Project layout

```
src/
  index.ts            entry point (config → supermemory → daemon → api → hud)
  config.ts           env loading
  supermemory.ts      Supermemory Local v3 client + local JSONL fallback store
  daemon/             filesystem, editor, terminal, system (tracker) watchers
  api/                Express REST + MCP (context.ts, index.ts)
  hud/                Express + WebSocket HUD server
  utils/              logger, store, time, search helpers
  shared/             text helpers shared by the server and the Electron UI
app/                  Electron overlay (main.cjs, renderer.js, preload.cjs, assets)
hud-ui/               web HUD served on :6769 (app.js, index.html, style.css)
site/                 public landing page
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run with `tsx watch` (hot reload) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run hud` | Start in HUD-only mode |
| `npm run app` | Launch the Electron overlay |
| `npm run lint` | Type-check with `tsc --noEmit` |
