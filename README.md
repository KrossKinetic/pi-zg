# @krosskinetic/pi-zg

A [Pi](https://github.com/earendil-works/pi-mono) package that natively integrates
[zvec-grep](https://github.com/) (`zg`) semantic code search into Pi: it offers
to build a missing index interactively, and gives the agent four tools
(`zg_search`, `zg_rg`, `zg_index`, `zg_status`) plus three commands
(`/zg-settings`, `/zg-status`, `/zg-index`). It calls an existing local `zg` CLI;

## Prerequisites

Install `@zvec/zvec-grep` separately and ensure `zg` is on `PATH`.
This extension invokes that local CLI; it does not install, bundle, or
configure zvec-grep for you.

## Install into Pi

```bash
pi install npm:@krosskinetic/pi-zg
```

For local development, from a checkout of this repo:

```bash
pi -e .
```

## Quick start

1. Install and configure `zg`, then verify that `zg version` works from your
   project directory.
2. Install this package and start Pi in the project you want to search.
3. At session start, pi-zg checks whether `zg` is available and whether the
   project has an index. Each `zg_search` refreshes the index first, so
   results are never stale — no server daemon is used.
4. Ask Pi a natural-language code-search question. Its `zg_search` tool
   searches the index. If the project has not been indexed, pi-zg offers to
   build one interactively.

For example, ask: “Where is authentication token refresh implemented?” For an
exact identifier, literal, or regex search, Pi can use `zg_rg` instead.

## What it does

### Always-fresh direct searches

This extension runs every search in **direct mode and refreshes the index before
answering** (`zg query --mode direct --refresh wait`). It does **not** use or manage
zg's shared server daemon — there is no background process to keep alive, start,
or shut down, so nothing can linger as an orphan between sessions.

Because each semantic search rebuilds any stale parts of the index first, results
are never stale: after editing a file, the next `zg_search` reflects the change.
This also means no index auto-refresh daemon needs to run at all.

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
- **`zg_status`** — report zg version and the current project's index status.
  Reads pi's cached zg state, so no extra `zg` subprocess is spawned for it.

`zg_search` accepts a natural-language `query` and an optional `limit` of
1–100 results (zg defaults to 7). `zg_rg` accepts a regex `pattern`, optional
paths, `fixedString` for literal matching, and one `glob` filter. Its output
and the output of the other tools are capped at 2,000 lines or 50 KB.


#### Choosing a search tool

Use the right tool for the kind of query, and don't reach for grep when semantic
search is the better fit:

- **`zg_search`** — find code by **meaning**. Use when you don't know the exact
  identifiers or wording (“where is token refresh handled”, “how does the cache
  layer work”). Keyword grep would miss these.
- **`zg_rg`** — find code by **exact text**: a known identifier, string literal, or
  regex, honoring the project's ignore/glob rules.
- **Pi's built-in `grep`** — a quick literal scan when you don't need zg's
  ignore rules or rg features.

In short: concept → `zg_search`; exact token/regex → `zg_rg`; everything is
refreshed before answering, so you always search current code.
### Commands (human-invoked)

- **`/zg-settings`** — interactive configuration for zg's default embedding
  model, embedding device, and provider API key.
- **`/zg-status`** — zg version and index status/coverage.
- **`/zg-index [--rebuild|--drop]`** — build, rebuild, or drop the index
  directly, without going through the LLM. Confirms before `--drop`.

### Settings (`/zg-settings`)

`/zg-settings` exposes the configuration that most directly affects Pi search:

- **Default embedding model** — sets zg's persistent default for newly built
  indexes, for example `local/potion-code-16m-v2` or
  `qwen/text-embedding-v4`. Existing indexes keep their recorded embedding
  schema.
- **Embedding device** — configures `auto`, `cpu`, `metal`, `vulkan`, or
  `cuda` for a specified local model.
- **Provider API key** — saves credentials for a named embedding provider via
  `zg config provider set`. The value is passed directly to zg and is not
  shown in Pi notifications.

For advanced index-selection rules, remote endpoints, authentication, and
other less-common settings, use the underlying `zg` CLI directly.

### Status

The footer shows `index ✓/✗` (colored via the active theme), refreshed at
session start and at the start of every turn.

### Flags

- `--no-zg-onboard` — disable the interactive "build an index?" offer;
  `zg_search` fails with a manual-fix message instead (useful for
  non-interactive/scripted `pi -p` runs).

Pass these when launching Pi, for example:

```bash
pi --no-zg-onboard
```

## Non-goals

- Does not register zg's MCP server as an actual MCP tool source inside Pi
  — Pi extensions have no MCP-client API, so integration stays CLI-based
  (`pi.exec`), stateful rather than re-deriving status via subprocess spawns
  before every call.
- Does not override Pi's built-in `grep` tool. `zg_search`/`zg_rg` are
  purely additive.
