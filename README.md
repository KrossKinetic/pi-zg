# pi-zg

Minimal [Pi](https://github.com/earendil-works/pi-mono) extension that gives Pi a
`zg_search` semantic code-search tool. It calls an existing local `zg` CLI; it
does not install, bundle, index, or manage zvec-grep.

## Prerequisites

Install `@zvec/zvec-grep` separately and ensure `zg` is on `PATH`. In each
project you want to search, build the index yourself first:

```bash
zg index
```

## Install into Pi

From this checkout:

```bash
pi install /Users/krosskinetic/VSCode/pi-zg/pi-zg.ts
```

For a one-off test without installing it:

```bash
pi -e /Users/krosskinetic/VSCode/pi-zg/pi-zg.ts
```

## Usage

Ask Pi to use `zg_search`, for example:

> Use `zg_search` to find where authentication is validated. Limit the result to 5.

The tool runs this from Pi's current project directory, using argument-array
execution rather than a shell:

```bash
zg query --limit 5 "where authentication is validated"
```

It first verifies that `zg` runs and that `.zvec-grep/index.zvec` exists in the
current project. If the index is missing, it tells you to run `zg index`
manually. It never invokes `zg index` itself.

`/zg-status` reports whether `zg` is available, its version, and whether that
index path is present.
