# trace

Local context cloud — an OS-level memory layer that continuously captures your computer activity, indexes it with Supermemory, and provides a chat-style AI overlay to query everything you've done.

---

## Architecture

trace is composed of four layers:

**Daemon** — A persistent set of watchers that capture activity from multiple sources:
- System tracker: foreground window changes, browser URLs (via UI Automation), process snapshots, idle detection — runs as a persistent PowerShell process on a 3-second loop
- Filesystem watcher: file create/edit events using chokidar
- Editor watcher: detects project directories opened in code editors
- Terminal watcher: reads PowerShell history for command tracking

**Storage** — Dual-layer architecture:
- Local: all events are written immediately to `~/.trace/events.jsonl` as JSONL
- Remote: events are fire-and-forget posted to Supermemory Local (localhost:6767) for indexing, embedding, and hybrid search. Falls back to local-only if Supermemory is unreachable

**API** — An Express server (port 6768) exposing:
- REST endpoints for context retrieval, search, daily summaries, and management
- MCP-compatible tool endpoints for AI agent integration (OpenCode, Claude Code, etc.)
- LLM-powered Q&A via any OpenAI-compatible endpoint (OpenRouter, OpenAI, Ollama, etc.)

**Overlay** — Two interfaces:
- Electron desktop overlay: a frameless, transparent, always-on-top window toggled with Alt+X. Features a chat-style search bar, activity feed, greeting, and summary panel with the trace logo in the tray, search bar, typing spinner, and favicon
- HUD web UI (port 6769): a browser-based dashboard showing live activity, session timeline, and search with keyboard navigation

---

## Features

- Real-time system activity tracking (foreground apps, window titles, browser URLs)
- File change monitoring across watched directories
- Editor project detection
- PowerShell command capture
- Automatic inactivity detection and session grouping
- Local event storage (JSONL) with full substring search across all history
- Remote indexing via [Supermemory](https://supermemory.ai) Local (localhost:6767) for vector/hybrid search
- LLM-powered Q&A on your recent activity (OpenAI-compatible endpoints)
- Session summaries with app, file, and browser statistics
- Daily context views with sessions grouped by project
- MCP tool integration for AI code assistants
- Electron desktop overlay with chat UI (Alt+X)
- Web-based HUD dashboard (port 6769)
- Single-instance lock prevents duplicate launches
- Graceful degradation when Supermemory is offline

---

## Prerequisites

- Node.js 20+
- [Supermemory Local](https://supermemory.ai/docs/self-hosting/overview) running on localhost:6767
- Windows (required for the PowerShell-based system tracker; other watchers are cross-platform)

---

## Setup

### 1. Start Supermemory Local

```bash
npx supermemory local
```

Or via the interactive installer:

```bash
curl -fsSL https://supermemory.ai/install | bash
supermemory-server
```

### 2. Install trace

```bash
npm install
npm run build
```

### 3. Configure

Copy `.env.example` to `.env` and edit:

```env
SUPERMEMORY_URL=http://localhost:6767
SUPERMEMORY_API_KEY=sm_...          # printed on first supermemory boot
CONTAINER_TAG=trace

WATCH_SOURCES=filesystem,editor,terminal,browser
WATCH_PATHS=C:\Projects

LLM_URL=https://openrouter.ai/api/v1
LLM_MODEL=tencent/hy3-preview
LLM_API_KEY=sk-or-v1-...
```

### 4. Start

```bash
start.bat
```

This launches the API server (port 6768) and Electron overlay. Press Alt+X to open the search overlay.

Or start components individually:

```bash
npm start               # API server only
npm run hud             # HUD web UI only
npm run app             # Electron overlay only
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/context/current` | Current activity — active project, recent events, session |
| GET | `/context/query?q=...` | Search memories (add `&llm=true` for Q&A) |
| GET | `/context/summary` | LLM summary of last 2 hours |
| GET | `/context/day?date=YYYY-MM-DD` | Full day with sessions and events |
| GET | `/health` | Service health check |
| GET | `/admin/status` | Daemon and Supermemory status |
| POST | `/admin/daemon/pause` | Pause activity ingestion |
| POST | `/admin/daemon/resume` | Resume activity ingestion |
| DELETE | `/admin/memories` | Clear all stored memories |

### MCP Tools

| Tool | Description |
|------|-------------|
| `get_current_context` | What the user is doing right now |
| `search_context` | Search memories with optional LLM Q&A |
| `get_day_context` | Full day summary by date |

```
POST /mcp
Content-Type: application/json

{ "tool": "search_context", "args": { "q": "what was I working on?", "llm": true } }
```

---

## Project Structure

```
trace/
├── app/                    # Electron overlay
│   ├── main.cjs            # Main process, tray, IPC, single-instance lock
│   ├── preload.cjs         # Context bridge
│   ├── renderer.js         # Chat UI, event feed, polling
│   ├── index.html          # Overlay layout
│   └── assets/logo.png     # Application logo
├── hud-ui/                 # Browser-based HUD dashboard
│   ├── index.html          # Dashboard layout
│   ├── app.js              # Live updates and search
│   ├── style.css           # Dark-themed styling
│   └── assets/logo.png     # Dashboard logo
├── src/
│   ├── index.ts            # Server entry point
│   ├── config.ts           # Environment configuration
│   ├── supermemory.ts      # Supermemory client (local + remote)
│   ├── types.ts            # TypeScript types
│   ├── api/
│   │   ├── index.ts        # Express routes and MCP tools
│   │   └── context.ts      # Context service, LLM Q&A, summaries
│   ├── daemon/
│   │   ├── index.ts        # Daemon orchestrator
│   │   ├── tracker.ts      # PowerShell system tracker
│   │   ├── filesystem.ts   # Chokidar file watcher
│   │   ├── editor.ts       # Editor project detector
│   │   └── terminal.ts     # PowerShell history reader
│   ├── hud/
│   │   └── index.ts        # HUD WebSocket server
│   └── utils/
│       ├── store.ts        # Local JSONL storage
│       ├── events.ts       # Event creation utilities
│       └── logger.ts       # Logging
├── start.bat               # One-click launcher
├── .env.example            # Environment template
└── package.json
```

---

## Supermemory Integration

Trace uses [Supermemory Local](https://supermemory.ai) as its remote memory backend. The self-hosted Supermemory server runs as a systemd service inside WSL (port 6767) and provides:

![Supermemory](https://supermemory.ai/favicon.ico) [Supermemory](https://supermemory.ai) — Memory and context engine for AI

- Document ingestion with chunking, embedding, and indexing
- Hybrid vector + keyword search (`/v3/search`)
- Memory agent workflow for automatic fact extraction
- Persistent index across server restarts

Configure Supermemory with your LLM provider. Example using OpenRouter:

```env
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-v1-...
OPENAI_MODEL=tencent/hy3-preview
```

The server's retry-param state files are stored under `~/.supermemory/retry-params/` and should be cleaned periodically if the memory agent encounters failures.

---

## Data

Local events are stored at `~/.trace/events.jsonl` (JSONL format). Each line is a JSON object with source, type, content, metadata, and timestamp.

Search queries the full history via substring matching. When Supermemory is connected, remote search uses its vector index for semantic relevance.

Delete all memories:

```
curl -X DELETE http://localhost:6768/admin/memories
```

---

## License

MIT
