# @tested/mcp

MCP server for [tested.dev](https://tested.dev). Gives Claude Code, Cursor, or any MCP client the patch coverage, flake, and suite-duration data behind your PR checks, over stdio.

`@tested/mcp` 0.1.3 on npm. Node 24+.

## Install

Add the server to `.cursor/mcp.json` (Cursor) or `.mcp.json` (Claude Code):

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

Restart the client. `@tested/mcp` depends on `@tested/cli` and resolves the `tested` binary from it, so this is the whole install.

To pin both as project dependencies instead:

```bash
npm i -D @tested/cli @tested/mcp
```

Then set `"command": "tested-mcp"` and drop `args`.

## Generate coverage

Tools read `coverage/coverage-final.json` in the target repo. Produce it once:

```bash
npx tested run
```

Or with vitest directly: `npx vitest run --coverage --coverage.reporter=json`.

Flake and duration tools read a JUnit XML report. It is auto-detected at `junit.xml`, `test-results/junit.xml`, `coverage/junit.xml`, or `reports/junit.xml`. Point elsewhere with `TESTED_JUNIT` or the `junit` argument. Without a report, those tools return `found: false` and empty lists.

## Start here

Every tool takes `cwd`, the absolute path to a git repository root. `base` is optional and resolves to `.tested.yaml` `base` when that ref exists, then `origin/main`, `HEAD~1`, `HEAD`.

Three reads give the scorecard for the current diff:

| Tool | Answers |
|---|---|
| `get_uncovered_diff` | Which lines, branches, and functions in the diff have no coverage |
| `get_flakes` | Which tests failed and passed in the same run, or carry `flaky="true"` |
| `get_performance` | Suite duration and the slowest tests |

Coverage is the only PR gate. Flakes and duration are visibility.

To close the gaps, run the `close-patch` skill. It maps each uncovered file to its existing test file, writes the test, re-runs coverage, and loops on `check` until thresholds pass.

## Push to tested.dev

Same account and token as the CLI. Read tools work with no account. `push` uploads coverage and the JUnit report to tested.dev, which posts the coverage check on the PR and shows flakes and durations in the repo's Tests and Performance tabs.

Get an ingest token from your repo at [app.tested.dev/repos](https://app.tested.dev/repos), or run `tested token` to print that link for the current git remote. Set it in the server environment:

```json
{
  "mcpServers": {
    "tested": {
      "command": "npx",
      "args": ["-y", "@tested/mcp"],
      "env": { "TESTED_TOKEN": "..." }
    }
  }
}
```

The token reaches only the `tested push` child. The test runner and every other CLI call get a sanitized environment with `*_TOKEN`, `*_SECRET`, and `*_PASSWORD` variables removed.

## Tools

### Coverage

| Tool | Input | Returns |
|---|---|---|
| `get_uncovered_diff` | `cwd`, `base?` | `files[]` with uncovered `ranges[]` (`start`, `end`, `kind: line \| branch \| function`) |
| `uncovered_branches` | `cwd`, `base?` | Uncovered branch ranges only. From the CLI when it emits them, otherwise parsed from Istanbul `branchMap` |
| `coverage_for` | `cwd`, `paths[]`, `base?` | Patch and project coverage plus uncovered ranges for just those files |
| `get_coverage_summary` | `cwd`, `base?` | Patch and project totals plus per-file line counts |
| `explain_line` | `cwd`, `location` (`src/cli.ts:42`) | Covered or not, why, and a code excerpt |
| `who_covers` | `cwd`, `file`, `line` | Test names that execute the line. `available: false` with a `reason` when the coverage file has no per-test hit map |
| `check` | `cwd`, `base?` | `tested check --json`: patch and project against `.tested.yaml` thresholds, `overall: pass \| fail` |

### Tests

All read the same JUnit report. A missing report returns `found: false`.

| Tool | Input | Returns |
|---|---|---|
| `get_failed` | `cwd`, `junit?` | Failed tests with `name`, `file`, `message`, `durationMs`, `alreadyFlaky` |
| `get_flakes` | `cwd`, `junit?` | Counts plus `flakes[]` (with `attempts`) and `failures[]` |
| `get_performance` | `cwd`, `junit?` | `durationMs` and `slowest[]` |
| `duration_delta` | `cwd`, `base?`, `junit?` | Suite and per-test duration against the JUnit report committed at `base` |
| `new_since_main` | `cwd`, `base?`, `junit?` | Files that lost coverage, and tests newly failing, flaky, or slowest, against `base` |

Flake detection is per report. Cross-run history lives in the app.

`duration_delta` and `new_since_main` read the base coverage and JUnit files with `git show <base>:<path>`. When those files are not committed at `base`, that section returns `found: false` with a `reason`.

### Write

| Tool | Input | Returns |
|---|---|---|
| `map_uncovered_to_test` | `cwd`, `paths[]?`, `base?` | The colocated `*.test.*` or `__tests__` file each source file belongs in, with `existing: true \| false` |
| `write_and_verify` | `cwd`, `path`, `content`, `base?` | Writes the test file, re-runs the suite with coverage, returns `success` and the fresh uncovered diff. On failure, `vitestStderr` and `vitestStdout` |

`write_and_verify` honors `testRunner` in `.tested.yaml` (`vitest`, `jest`, `pytest`). Default is `npx vitest run --coverage`. It advertises `destructiveHint: true`, so clients that confirm destructive tools will prompt.

### Account

| Tool | Input | Returns |
|---|---|---|
| `push` | `cwd`, `pr` or `mainline`, `token?`, `base?`, `owner?`, `name?`, `junit?` | `tested push --json`: `shareUrl` and `expiresAt` |
| `doctor` | `cwd` | `tested doctor --json`: Node, git, config, coverage file, origin, token presence. Never prints the token |

## Skills

Two sequenced workflows, exposed as MCP prompts and as `tested://skills/*` resources. Markdown lives in `skills/<name>/SKILL.md`.

| Skill | Sequence |
|---|---|
| `close-patch` | `get_uncovered_diff` → `map_uncovered_to_test` → `write_and_verify` → `check`, until `overall: pass` |
| `triage` | `doctor` → `get_failed` → `get_flakes` → `get_uncovered_diff` → one verdict: failing tests, flake, or coverage holes |

## Security

Tools spawn the target repo's test runner, and `write_and_verify` writes files. An untrusted `cwd` is arbitrary code execution. Only pass repository paths you trust.

For always-on or shared hosts, pin the allowlist:

```bash
export TESTED_ALLOWED_CWDS="/abs/path/to/repo1:/abs/path/to/repo2"
```

Every tool then rejects a `cwd` outside that list. `cwd` must also be absolute, a directory, not a symlink, and contain `.git/`.

Other guards:

- `junit`, `path`, and `paths[]` must resolve inside `cwd`. Symlink escapes are refused.
- Responses with `files[]` are capped at 200 entries / 64 KiB and set `truncated: true` when cut.
- Child processes never inherit `TESTED_TOKEN`, `TESTED_TOKEN_FILE`, `TESTED_INGEST_TOKEN`, or other `*_TOKEN` / `*_SECRET` / `*_PASSWORD` variables. `push` re-adds only the resolved ingest token to its own `tested push` child.

## Environment

| Variable | Purpose |
|---|---|
| `TESTED_TOKEN` | Ingest token for `push`. Stripped from every other child process |
| `TESTED_ALLOWED_CWDS` | Colon-separated allowlist of absolute repo paths |
| `TESTED_JUNIT` | JUnit XML path when the report is not at a default location |
| `TESTED_BIN` | Absolute path to `tested.js`. Override only; normal installs resolve the binary from `@tested/cli` |
| `TESTED_BIN_ALLOW_PREFIX` | Colon-separated realpath prefixes `TESTED_BIN` must live under. Also requires basename `tested` or `tested.js` |

## Development

```bash
pnpm install
pnpm run build       # dist/
pnpm test            # unit + integration
pnpm run typecheck
```

The integration test spawns `dist/tested-mcp.js` over stdio. It runs only when a built sibling checkout of `@tested/cli` exists at `../cli`.

## Release

Published to npm from a GitHub Release by `.github/workflows/release.yml` with [trusted publishing](https://docs.npmjs.com/trusted-publishers/). No `NPM_TOKEN`.

1. Bump `version` in `package.json` on `main` and merge.
2. From that commit: `gh release create vX.Y.Z --generate-notes`. The tag must match `package.json` (`v0.1.3` → `0.1.3`).

One-time npmjs.com setup (package settings → Trusted Publisher → GitHub Actions): organization `tested-hq`, repository `mcp`, workflow `release.yml`, no environment, allowed action `npm publish`.
