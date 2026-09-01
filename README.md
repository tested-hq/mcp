# @tested/mcp

MCP server that wraps the `@tested/cli` binary and exposes coverage plus JUnit test-analytics tools over stdio for use with Claude Code, Cursor, or any MCP-compatible client.

## Security (read first)

> **Only pass trusted repository paths as `cwd`.** Tools spawn the project’s
> test runner and can write test files via `write_and_verify`. An untrusted
> repo is arbitrary code execution.

**Strongly recommended for always-on / multi-tenant MCP hosts:**

```bash
export TESTED_ALLOWED_CWDS="/abs/path/to/project1:/abs/path/to/project2"
```

When set, every tool rejects a `cwd` that is not exactly one of those paths.

Also recommended:

| Variable | Purpose |
|----------|---------|
| `TESTED_BIN` | Optional override: absolute path to `tested.js` (admin-controlled) |
| `TESTED_BIN_ALLOW_PREFIX` | Colon-separated realpath prefixes; when set, `TESTED_BIN` realpath must stay under one, and basename must be `tested` or `tested.js` |

Writes refuse intermediate symlink escapes (realpath + lstat walk). Read tools hard-truncate large `files[]` payloads (`truncated: true`, max ~200 files / 64 KiB). CLI and test-runner children do not inherit `TESTED_TOKEN` / `TESTED_TOKEN_FILE` / `TESTED_INGEST_TOKEN` or other `*_TOKEN` / `*_SECRET` host credentials, except `push`, which re-adds only the resolved ingest token to the `tested push` child.

## Requirements

- Node.js >= 24
- `@tested/cli` (a dependency of this package; `npx -y @tested/mcp` installs it)
- A `coverage/coverage-final.json` file in the target repository (from `tested run`, or `npx vitest run --coverage --coverage.reporter=json` when `testRunner` is vitest)

## Install

One-off, no project install:

```bash
npx -y @tested/mcp
```

That is enough. `@tested/mcp` depends on `@tested/cli` and resolves the `tested` binary from that package. You do not need `TESTED_BIN`.

To add both as project deps:

```bash
npm i -D @tested/cli @tested/mcp
```

If the binary still cannot be found, the server starts anyway and tools return that same install line.

## Cursor / Claude Code

Same stdio config in Cursor (`.cursor/mcp.json`) and Claude Code (`.mcp.json` or `~/.claude.json`):

```json
{
  "mcpServers": {
    "tested": {
      "command": "npx",
      "args": ["-y", "@tested/mcp"]
    }
  }
}
```

If `@tested/mcp` is already a project dep, use `"command": "tested-mcp"` and drop `args`.

Optional env for always-on hosts: `TESTED_ALLOWED_CWDS`, and `TESTED_TOKEN` if you want the `push` tool to work without passing a token argument. `TESTED_BIN` is an override, not the setup path.

## Tools

All tools require `cwd` — the **absolute** path to a **git repository root** (a directory containing `.git/`). Relative paths are rejected; the error says so.

`base` is optional. If omitted, the server uses `.tested.yaml` `base` when that ref exists, then `origin/main`, `HEAD~1`, or `HEAD`. A missing `origin/main` is not a raw git fatal.

### `get_uncovered_diff`

Returns uncovered line/branch/function ranges for every file touched in the current diff.

**Input**

| Field  | Type     | Default | Description                              |
|--------|----------|---------|------------------------------------------|
| `cwd`  | `string` | required | Absolute path to the git repository root |
| `base` | `string` | resolved locally | Git ref to diff against                  |

**Output**

```json
{
  "files": [
    {
      "path": "src/commands/diff.ts",
      "ranges": [
        { "start": 19, "end": 26, "kind": "line" },
        { "start": 28, "end": 35, "kind": "line" }
      ]
    }
  ]
}
```

Only files with at least one uncovered range are included.

---

### `explain_line`

Returns whether a specific line is covered and why, plus a code excerpt.

**Input**

| Field      | Type     | Default  | Description                                   |
|------------|----------|----------|-----------------------------------------------|
| `cwd`      | `string` | required | Absolute path to the git repository root      |
| `location` | `string` | required | File and line, e.g. `"src/cli.ts:42"`         |

**Output**

```json
{
  "path": "src/cli.ts",
  "line": 1,
  "uncovered": false,
  "reason": "hit 1 time",
  "codeExcerpt": "1  import { Command } from 'commander';\n..."
}
```

---

### `get_coverage_summary`

Returns a per-file line-count summary plus rolled-up patch and project statistics.

**Input**

| Field  | Type     | Default | Description                              |
|--------|----------|---------|------------------------------------------|
| `cwd`  | `string` | required | Absolute path to the git repository root |
| `base` | `string` | resolved locally | Git ref to diff against                  |

**Output**

```json
{
  "patch":   { "executable": 10, "covered": 7, "pct": 70 },
  "project": { "executable": 512, "covered": 411, "pct": 80.3 },
  "files": [
    {
      "path": "src/cli.ts",
      "lines": { "total": 0, "covered": 0, "pct": 100 }
    }
  ]
}
```

> **Note on line counts:** The CLI reports per-file coverage as a percentage. `total` and `covered` are back-calculated from the uncovered ranges and that percentage; they are approximations, not exact source line counts.

---

### `get_flakes`

Returns flake and failure analytics from a local JUnit report — the same `TestReport` schema as the tested.dev **Tests** tab. Intra-run only (fail+pass in one XML, or `flaky=true`). Read-only; does not fail the PR.

**Input**

| Field   | Type     | Default | Description |
|---------|----------|---------|-------------|
| `cwd`   | `string` | required | Absolute path to the git repository root |
| `junit` | `string` | auto-detect | JUnit XML path (relative to cwd, or absolute under cwd). If omitted: `TESTED_JUNIT`, then `junit.xml`, `test-results/junit.xml`, `coverage/junit.xml`, `reports/junit.xml` |

**Output**

```json
{
  "found": true,
  "tests": 5,
  "failed": 1,
  "errors": 0,
  "skipped": 1,
  "flaky": 1,
  "flakes": [
    { "name": "retry me", "classname": "auth", "durationMs": 130, "attempts": 2 }
  ],
  "failures": [
    { "name": "login fail", "classname": "auth", "durationMs": 200, "message": "expected 200" }
  ]
}
```

When no JUnit file is present, returns `found: false` and empty lists (quiet miss — not an error).

---

### `get_performance`

Returns suite duration and the slowest tests from the same JUnit `TestReport` — the tested.dev **Performance** tab. Read-only; does not fail the PR.

**Input**

Same as `get_flakes` (`cwd` required, `junit` optional / auto-detect).

**Output**

```json
{
  "found": true,
  "durationMs": 1630,
  "slowest": [
    { "name": "big", "classname": "slow", "durationMs": 1200 }
  ]
}
```

When no JUnit file is present, returns `found: false`, `durationMs: 0`, and `slowest: []`.

---

### `get_failed`

Failed tests from the **same** JUnit `TestReport` as `get_flakes`: `name`, `file`, `message`, `durationMs`, `alreadyFlaky` (true if that test is also in `flakes[]` this run). Cross-run flake history is the app, not this server.

**Input** — same as `get_flakes`.

**Output**

```json
{
  "found": true,
  "failed": [
    { "name": "login fail", "durationMs": 200, "message": "expected 200", "alreadyFlaky": false },
    { "name": "retry me", "durationMs": 130, "alreadyFlaky": true }
  ]
}
```

---

### `coverage_for`

Patch coverage for the files the agent touched. Filter of `tested diff --json` `files[]` (the same `CliFileSchema` as `get_uncovered_diff` / `get_coverage_summary`). Only requested paths are returned.

**Input** — `cwd`, optional `base`, required `paths[]`.

---

### `new_since_main`

Informational delta vs git base (default `origin/main` via the same resolver as other tools): files that lost coverage, tests newly failing/flaky, tests newly in `slowest[]`. Local git + coverage + junit vs base when those blobs exist. If base junit or coverage is missing, that section is a structured miss (`found: false`, `reason`) — never invented.

---

### `who_covers`

Which tests execute `file`:`line`. Reads V8/Istanbul `coverage-final.json`. If the file has no per-test hit map (`testMap` / `tests`), returns `available: false` and a reason. Does not invent test names from `fnMap`.

---

### `duration_delta`

Suite duration and per-test delta vs base/main JUnit. Maps the suite change to the tests that caused it. Same miss rule as `new_since_main` if base junit is not in git.

---

### `uncovered_branches`

Uncovered **branches** in the patch, not only lines. Exposes `kind: branch` ranges from `tested diff --json` when the CLI emits them; otherwise parses Istanbul `branchMap` / `b` for the same files.

---

### `map_uncovered_to_test`

Given uncovered source files (or `get_uncovered_diff` when `paths` is omitted), return the existing colocated `*.test.*` / `__tests__` file they should land in. Used by the close-patch skill.

---

### Skills

Advertised as MCP prompts (`prompts/list`) and `tested://skills/*` resources. Markdown lives in `skills/<name>/SKILL.md`.

| Skill | Sequence |
|-------|----------|
| `triage` | `doctor` → `get_failed` → `get_flakes` → `get_uncovered_diff` → one answer: tests vs flake vs holes |
| `close-patch` | `get_uncovered_diff` → `map_uncovered_to_test` → `write_and_verify` → `check` until green |

---

### `write_and_verify`

Writes a test file then re-runs the suite with coverage and returns the fresh uncovered-range snapshot, all in one call. This is the preferred tool when an agent is iterating on a test — it cuts the write→re-check roundtrip in half versus a separate write + `get_uncovered_diff` sequence.

On runner failure, returns `success: false` with the captured `vitestStderr` so the agent can self-correct in the next turn without an additional tool call.

Honors `testRunner` from `.tested.yaml` (`vitest`, `jest`, or `pytest`). If unset, runs `npx vitest` with coverage.

**Input**

| Field     | Type     | Default | Description                                              |
|-----------|----------|---------|----------------------------------------------------------|
| `cwd`     | `string` | required | Absolute path to the git repository root                 |
| `base`    | `string` | resolved locally | Git ref to diff against (for the post-write diff)        |
| `path`    | `string` | required | Test file path, relative to `cwd`                        |
| `content` | `string` | required | Complete contents of the test file (overwrites existing) |

**Output (success)**

```json
{
  "bytesWritten": 1234,
  "success": true,
  "vitestStderr": null,
  "diff": { "files": [] }
}
```

**Output (failure)**

```json
{
  "bytesWritten": 1234,
  "success": false,
  "vitestStderr": "AssertionError: expected 1 to equal 2\n…",
  "vitestStdout": "FAIL tests/foo.test.ts > foo()\n…"
}
```

> **Annotations:** `write_and_verify` advertises `destructiveHint: true` and `readOnlyHint: false`. Clients that surface a confirmation UX for destructive tools will prompt before invoking.

---

### `check`

Thin wrapper for `tested check --json`. Reports whether patch and project coverage meet `.tested.yaml` thresholds.

### `push`

Thin wrapper for `tested push --json`. Requires a `token` argument or `TESTED_TOKEN` in the MCP server environment. The token is injected only into the `tested push` child after `sanitizeChildEnv`; it is never forwarded to the test runner. Optional `junit` is forwarded as `--junit` so agents can upload the same report `get_flakes` / `get_performance` read.

### `doctor`

Thin wrapper for `tested doctor --json`. Diagnoses Node, git, config, coverage file, origin, and token presence. Never prints secret values.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TESTED_BIN` | auto-resolved from `@tested/cli` or `which tested` | Optional absolute path to the tested CLI binary |
| `TESTED_BIN_ALLOW_PREFIX` | unset | Colon-separated realpath prefixes; when set, enforce basename `tested`/`tested.js` and prefix membership |
| `TESTED_ALLOWED_CWDS` | unset | Colon-separated absolute cwd allowlist (recommended for always-on hosts) |
| `TESTED_TOKEN` | (host only) | Ingest token for the `push` tool. Stripped from CLI/test-runner children except the `push` spawn |

## Development

```bash
pnpm run build       # compile to dist/
pnpm test            # all tests (unit + integration)
pnpm run typecheck   # TypeScript strict check
```

The integration test spawns the built binary over stdio and calls tools against the CLI repo's own coverage data when that sibling checkout exists.

## Release

Ship `@tested/mcp` from a GitHub Release. `.github/workflows/release.yml` publishes to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). No `NPM_TOKEN`.

1. Bump `version` in `package.json` on `main` and merge.
2. From that commit: `gh release create vX.Y.Z --generate-notes` (tag must match `package.json`, e.g. `v0.1.2` → `0.1.2`).

One-time npmjs.com setup (package settings → Trusted Publisher → GitHub Actions):

- Organization: `tested-hq`
- Repository: `mcp`
- Workflow filename: `release.yml`
- Environment: (none)
- Allowed action: `npm publish`

