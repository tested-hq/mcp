# triage

CI is red. Produce **one** answer: failing tests vs flake vs coverage holes.
Do not invent data. If a tool returns `found: false` / `available: false`, say so.

## Sequence

1. `doctor` — environment (Node, git, coverage file, token). Fix a broken env before reading reports.
2. `get_failed` — current JUnit failures (`name`, `file`, `message`, `durationMs`, `alreadyFlaky`).
3. `get_flakes` — same TestReport: intra-run flakes (`fail+pass` or `flaky=true`).
4. `get_uncovered_diff` — uncovered line/branch/function ranges in the patch.

## Verdict

- **Tests** — `get_failed` has rows with `alreadyFlaky: false`. Those are hard fails.
- **Flake** — `alreadyFlaky: true` on a failed test, or `get_flakes.flakes[]` without a hard fail. Intra-run only; cross-run history is the app, not this server.
- **Holes** — `get_uncovered_diff.files[]` is non-empty and failures do not explain the red check. Close holes with the close-patch skill.

Do not run flake/duration GitHub checks. Do not call `push` unless the user asked to upload.
