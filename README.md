**WORK IN PROGRESS / ALPHA**

# pi-zg

A [Pi](https://github.com/earendil-works/pi-mono) package that natively integrates
[zvec-grep](https://github.com/) (`zg`) semantic code search into Pi: it manages
`zg`'s shared server, offers to build a missing index interactively, and gives
the agent three tools (`zg_search`, `zg_rg`, `zg_index`) plus three commands
(`/zg-status`, `/zg-index`, `/zg-server`). It calls an existing local `zg` CLI;
it does not install or bundle zvec-grep itself.

## Prerequisites

Install `@zvec/zvec-grep` separately and ensure `zg` is on `PATH`.

## Install into Pi

```bash
pi install npm:pi-zg
```

For local development, from a checkout of this repo:

```bash
pi -e .
```

## What it does

### Shared server (`zg server`)

`zg` runs a shared, loopback daemon that other tools (Claude, Cursor, etc.,
configured via `zg install`) may also use. This extension:

- **Auto-starts** it at session start if it isn't already running
  (`--no-zg-autostart` disables this). `zg server on` is idempotent, so this
  is safe to run every session.
- **Never auto-stops it** — since it's shared, stopping it could break other
  tools relying on it. Use `/zg-server off` to stop it explicitly.

With the server running, `zg query` refreshes the index in the background
automatically after file changes, so `zg_index` is rarely needed once a
project has an initial index.

### Tools (LLM-callable)

- **`zg_search`** — semantic search over the project's zvec-grep index
  (`zg query`). If no index exists and the UI supports it, offers to build
  one interactively (including picking a default embedding model if none is
  configured) instead of failing outright.
- **`zg_rg`** — exhaustive exact-match search via zvec-grep's managed
  ripgrep (`zg query --rg`), respecting the project's configured
  ignore/glob rules. Complements `zg_search` and Pi's built-in `grep` tool;
  does not require an index.
- **`zg_index`** — build, rebuild, or drop the persistent index. Gated by
  prompt guidelines so the agent only uses it when the user explicitly asks.

### Commands (human-invoked)

- **`/zg-status`** — zg version, server state, and index status/coverage.
- **`/zg-index [--rebuild|--drop]`** — build, rebuild, or drop the index
  directly, without going through the LLM. Confirms before `--drop`.
- **`/zg-server <on|off|status>`** — explicit manual control of the shared
  daemon. Confirms before `off`, since other tools may depend on it.

### Status

The footer shows `server ●/○` and `index ✓/✗` (colored via the active
theme), refreshed at session start and at the start of every turn.

### Flags

- `--no-zg-autostart` — disable automatically starting the shared server.
- `--no-zg-onboard` — disable the interactive "build an index?" offer;
  `zg_search` fails with a manual-fix message instead (useful for
  non-interactive/scripted `pi -p` runs).

## Non-goals

- Does not register zg's MCP server as an actual MCP tool source inside Pi
  — Pi extensions have no MCP-client API, so integration stays CLI-based
  (`pi.exec`), just daemon-aware and stateful rather than re-deriving status
  via subprocess spawns before every call.
- Does not override Pi's built-in `grep` tool. `zg_search`/`zg_rg` are
  purely additive.
- Does not auto-stop the shared `zg` server.
