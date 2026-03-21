# Taurus Agents

Self-hosted multi-agent platform. Each agent runs in an isolated Docker container with a persistent shell, an LLM-powered control loop, and a configurable tool set. Ships with a web UI for managing agents, browsing files, and interacting via terminal — all in the browser.

## Features

- **Isolated execution** — each agent gets its own Docker container with a persistent shell session
- **Agent hierarchies** — parent/child agent trees with Delegate and Supervisor tools for orchestrating teams of agents
- **Shared volumes** — child agents automatically mount the parent's `/shared` volume for inter-agent file sharing
- **Web UI** — real-time streaming of LLM thinking/text/tool output, file editor (Monaco) with data table and markdown views, interactive terminal (xterm.js), agent configuration
- **Mobile-friendly PWA** — installable Taurus dashboard with responsive drawers, safer mobile viewport handling, and browser/PWA notifications
- **16 built-in tools** — file ops (Read, Write, Edit, Glob, Grep), shell (Bash), web (WebFetch, WebSearch, Browser), control (Pause, Notify, Subrun, Wait, Delegate, Supervisor)
- **Multi-provider** — Anthropic (default), OpenAI, OpenRouter (access to DeepSeek, Llama, etc.)
- **Scheduling** — cron-based with overlap modes (skip, queue, kill)
- **Composable prompts** — `{{include:path}}` directive to include reusable prompt fragments from `resources/prompts/`
- **Blocking API** — `POST /api/ask` sends a message and waits for the response, making it easy to script
- **SSE streaming** — real-time events for building custom frontends
- **SQLite storage** — agents, runs, messages, logs all persisted locally

## Quick start

Prerequisites: Node.js 18+, Docker

```bash
git clone https://github.com/sergevar/taurus-agents.git
cd taurus-agents
npm install

# Set up API keys
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY

# Build the custom Docker image (includes Node.js, Python, ripgrep, Playwright)
docker build -t taurus-base docker/

# Start (builds web UI + starts daemon on :7777)
./taurus dev
```

Open `http://localhost:7777` in your browser.

## Architecture

```
┌─────────────┐     HTTP / SSE       ┌──────────────┐
│   Web UI    │◄────────────────────►│   Server     │
│  (React)    │                      │  (routes)    │
└─────────────┘                      └──────┬───────┘
                                            │
                                     ┌──────▼───────┐
                                     │   Daemon     │
                                     │  (parent)    │
                                     └──┬───┬───┬───┘
                                   IPC  │   │   │  IPC
                                  ┌─────▼┐ ┌▼┐ ┌▼─────┐
                                  │Worker│ │…│ │Worker│
                                  │(fork)│ │ │ │(fork)│
                                  └──┬───┘ └─┘ └──┬───┘
                                     │             │
                                  ┌──▼───┐      ┌──▼───┐
                                  │Docker│      │Docker│
                                  └──────┘      └──────┘
```

- **Daemon** — parent process managing agent lifecycle, IPC coordination, SSE broadcasting
- **Workers** — one forked child process per running agent, owns the TAOR loop (Think-Act-Observe-Repeat), persists messages to SQLite
- **Docker containers** — one per agent, persistent shell session across commands, tools execute inside
- **SQLite** — stores agents, runs, messages, logs, folders at `data/taurus.sqlite`

## Multi-provider models

Specify the provider as a prefix on the model ID:

```
anthropic/claude-sonnet-4-20250514   # Anthropic
openai/gpt-4o                        # OpenAI
openrouter/deepseek/deepseek-r1      # OpenRouter
```

Set the corresponding API key in `.env` for each provider you use.

## Tools

| Tool | Group | Description |
|------|-------|-------------|
| Read | file | Read file contents (binary detection, image support) |
| Write | file | Create or overwrite files |
| Edit | file | String replacement edits with freshness enforcement |
| Glob | search | Find files by glob pattern |
| Grep | search | Search file contents with regex (ripgrep) |
| Bash | exec | Run shell commands in the persistent container shell |
| Pause | control | Pause execution, wait for human input |
| Notify | control | Send a notification to Taurus web/PWA clients |
| Subrun | control | Run subtasks in the same container with a separate conversation |
| Wait | control | Wait for background runs to complete, or sleep for a duration |
| Delegate | control | Delegate a task to a child agent (sync or background) |
| MessageParent | control | Send a message back to the parent run |
| Supervisor | control | Manage child agents: create, update, delete, inspect, inject messages, stop runs |
| WebSearch | web | Search via Brave Search API |
| WebFetch | web | Fetch and extract web page content |
| Browser | web | Control a headless Chromium browser (Playwright) |

## API

Full reference: [doc/api.md](doc/api.md)

```bash
# List agents
curl localhost:7777/api/agents

# Create an agent
curl -X POST localhost:7777/api/agents \
  -H 'Content-Type: application/json' \
  -d '{"name": "my-agent", "system_prompt": "You are helpful."}'

# Start a run (non-blocking)
curl -X POST localhost:7777/api/agents/<id>/run \
  -H 'Content-Type: application/json' \
  -d '{"input": "Hello"}'

# Blocking ask (waits for completion)
curl -s localhost:7777/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"agent": "my-agent", "message": "What files are in /workspace?"}'
```

## Agent hierarchies

Agents can form parent/child trees. A supervisor agent manages its team using the Delegate and Supervisor tools:

```
agency                          (supervisor)
├── researcher                  (child agent)
├── writer                      (child agent)
└── editor                      (child agent)
```

- **Delegate** — send a task to a child agent (blocks by default, or set `background: true` for async dispatch)
- **Supervisor** — create, update, delete, inspect, and control child agents
- **Wait** — wait for background runs to complete, with optional timeout
- **Shared volumes** — all agents in a tree share a `/shared` volume for passing files between agents
- **Scoped access** — agents can only manage their direct children, not siblings or ancestors

Children can themselves be supervisors with their own children — hierarchies nest to arbitrary depth.

## Scheduling

Agents can have a cron schedule. Set `schedule` to a cron expression and `schedule_overlap` to control behavior when a trigger fires while the agent is already running:

- `skip` — drop the trigger (default)
- `queue` — queue it, run after current finishes
- `kill` — stop current run, start new

Set `schedule_mode` to control whether each trigger starts fresh or continues the previous conversation:

- `new` — start a new run each time (default)
- `continue` — continue the last run, preserving conversation history

## System prompt templates

Agent system prompts support placeholders and includes:

| Placeholder | Value |
|-------------|-------|
| `{{datetime}}` | ISO timestamp |
| `{{date}}` | YYYY-MM-DD |
| `{{time}}` | HH:MM:SS |
| `{{year}}` | Current year |
| `{{timezone}}` | System timezone |
| `{{agent.name}}` | Agent name |
| `{{agent.schedule}}` | Cron expression (if set) |
| `{{include:path}}` | Contents of `resources/prompts/<path>` (recursive, up to 5 levels) |

Place reusable prompt fragments in the `resources/prompts/` directory and reference them with `{{include:filename.md}}`.

To let an agent notify you about important milestones or blockers, enable the `Notify` tool and include `{{include:skills/notify-user.md}}` in its system prompt.

## HottestLang

> "The hottest new programming language is English" — [Andrej Karpathy](https://x.com/karpathy/status/1617979122625712128)

Natural-language programs for agents. Write a `.hottest.md` file describing your team, workflows, and triggers — the LLM interprets it directly. No compilation, no DSL — just English.

```markdown
# Program: acme-content-production.hottest.md

## Team
- researcher: research topics using web search, save findings
- writer: write articles from research briefs
- editor: polish drafts for publication

## On new content order
1. Add to /workspace/orders.json with status "pending"
2. Delegate to researcher with the topic
3. Delegate to writer with the research summary
4. Delegate to editor with the draft
5. Update order status to "complete"

## On wake (scheduled)
- Check orders.json for pending work
- Check team status — restart stuck agents
- Process next pending order
```

Pair with a runtime prompt (via `{{include:...}}`) that teaches the agent how to interpret the program, manage state, and coordinate its team. See `resources/prompts/hottest/` for examples.

## Project structure

```
src/
  index.ts              # Entry point
  core/                 # Types, ChatML builder, defaults
  daemon/               # Parent process, workers, Docker, scheduler, SSE
  agents/               # Core TAOR loop
  inference/            # LLM abstraction + providers (Anthropic, OpenAI, OpenRouter)
  tools/                # Tool implementations (file, search, exec, web, control)
  server/               # HTTP server, routes, WebSocket terminal
  db/                   # Sequelize + SQLite models and migrations
  web/                  # React frontend (Vite, Monaco, xterm.js)
resources/
  prompts/              # Reusable prompt fragments for {{include:...}}
docker/
  Dockerfile            # Custom agent container image
data/
  taurus.sqlite          # SQLite database (auto-created)
doc/
  api.md                # API reference
```

## CLI

```bash
./taurus              # Start daemon
./taurus dev          # Build web UI + start daemon
./taurus build        # Build web UI only
./taurus watch        # Build web UI in watch mode
./taurus status       # Check if daemon is running
```

## Configuration

Copy `.env.example` to `.env` and set your keys:

```bash
ANTHROPIC_API_KEY=     # Required for default Anthropic models
OPENAI_API_KEY=        # Required for openai/ models
OPENROUTER_API_KEY=    # Required for openrouter/ models
BRAVE_SEARCH_API_KEY=  # Required for WebSearch tool
JINA_API_KEY=          # Optional — higher rate limits for WebFetch
TAURUS_PORT=7777       # Server port
```

## Authentication

Taurus now uses per-user authentication with username + password login. Auth is always enabled for API routes, and the web app will show a login screen when you are not signed in.

On first boot, Taurus ensures there is at least one admin user:

- If there are no users yet, it creates `taurus` as the default admin.
- The default password is `AUTH_PASSWORD` if you set it in `.env`.
- Otherwise, Taurus derives a deterministic local password from the instance secret and prints it in the startup banner in non-production mode, until that password is changed.

You can create additional users from the CLI:

```bash
./taurus adduser --username <name> --password <password> --email <email> [--role admin|user]
```

Relevant auth env vars:

```bash
AUTH_PASSWORD=my-secret       # Optional initial password for the default `taurus` admin
AUTH_API_KEY=my-api-key       # Optional — static key for programmatic API access
# AUTH_SECRET=                # Optional — HMAC signing key (auto-generated if not set)
TAURUS_HTTPS=1                # Set when behind a reverse proxy with TLS
```

### How it works

- **Web UI**: username + password login sets an `HttpOnly; SameSite=Strict` session cookie (7-day TTL). Mutation requests (POST/PUT/PATCH/DELETE) require an `X-CSRF-Token` header.
- **API access**: use `Authorization: Bearer <AUTH_API_KEY>` for programmatic access. No CSRF needed for Bearer auth.
- **WebSocket terminal**: authenticated via session cookie, or `?token=<key>` query param for external clients.
- **Rate limiting**: max 5 failed login attempts per IP per minute, then 429.
- **Instance secret**: HMAC keys are derived (via HKDF) from a per-instance secret stored at `data/.auth_secret`. Set `AUTH_SECRET` explicitly in multi-node deployments.

### API examples with auth

```bash
# Login (returns session cookie + CSRF token)
curl -c cookies.txt localhost:7777/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "taurus", "password": "my-secret"}'

# Authenticated request with cookie + CSRF
curl -b cookies.txt localhost:7777/api/agents \
  -H 'X-CSRF-Token: <token-from-login>'

# Or use API key (simpler for scripts)
curl localhost:7777/api/agents \
  -H 'Authorization: Bearer my-api-key'
```

## License

MIT
