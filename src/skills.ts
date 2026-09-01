/**
 * skills.ts — Sequenced agent workflows advertised as MCP prompts
 * (the primitive this SDK supports) plus `tested://skills/*` resources.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const TRIAGE_SKILL = `# triage

CI is red. Produce **one** answer: failing tests vs flake vs coverage holes.
Do not invent data. If a tool returns \`found: false\` / \`available: false\`, say so.

## Sequence

1. \`doctor\` — environment (Node, git, coverage file, token). Fix a broken env before reading reports.
2. \`get_failed\` — current JUnit failures (\`name\`, \`file\`, \`message\`, \`durationMs\`, \`alreadyFlaky\`).
3. \`get_flakes\` — same TestReport: intra-run flakes (\`fail+pass\` or \`flaky=true\`).
4. \`get_uncovered_diff\` — uncovered line/branch/function ranges in the patch.

## Verdict

- **Tests** — \`get_failed\` has rows with \`alreadyFlaky: false\`. Those are hard fails.
- **Flake** — \`alreadyFlaky: true\` on a failed test, or \`get_flakes.flakes[]\` without a hard fail. Intra-run only; cross-run history is the app, not this server.
- **Holes** — \`get_uncovered_diff.files[]\` is non-empty and failures do not explain the red check. Close holes with the close-patch skill.

Do not run flake/duration GitHub checks. Do not call \`push\` unless the user asked to upload.
`;

export const CLOSE_PATCH_SKILL = `# close-patch

Close uncovered patch lines by writing tests next to the existing suite.
Do not guess the test file. Do not stub coverage. Loop until \`check\` is green.

## Sequence

1. \`get_uncovered_diff\` — once, at the start. Note every file + range.
2. \`map_uncovered_to_test\` — the colocate / \`*.test.*\` / \`__tests__\` file each range belongs in (\`existing: true\` means write there).
3. \`write_and_verify\` — write the **complete** test file (keep existing cases) and re-run coverage. Prefer this over a separate write + diff.
4. \`check\` — patch / project thresholds from \`.tested.yaml\`. If it fails, read \`write_and_verify\` stderr / remaining ranges and repeat from step 3 (at most a handful of times). Call \`get_uncovered_diff\` at most once more to confirm closure.

Stop when \`check.overall\` is \`pass\` or the remaining ranges are outside the files you were asked to cover.
`;

function skillPath(name: 'triage' | 'close-patch'): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'skills', name, 'SKILL.md'),
    join(here, 'skills', name, 'SKILL.md'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadSkillText(name: 'triage' | 'close-patch'): string {
  const fallback = name === 'triage' ? TRIAGE_SKILL : CLOSE_PATCH_SKILL;
  const p = skillPath(name);
  if (!p) return fallback;
  return readFileSync(p, 'utf8');
}

const cwdArg = z
  .string()
  .optional()
  .describe('Absolute git repository root to run the skill against.');

export function registerSkills(server: McpServer): void {
  server.registerPrompt(
    'triage',
    {
      title: 'Triage a red CI run',
      description:
        'CI red → doctor / get_failed / get_flakes / get_uncovered_diff → one answer: tests vs flake vs holes.',
      argsSchema: { cwd: cwdArg },
    },
    ({ cwd }) => ({
      description:
        'CI red → doctor / get_failed / get_flakes / get_uncovered_diff → tests vs flake vs holes.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: loadSkillText('triage') + (cwd ? `\n\ncwd: ${cwd}\n` : ''),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'close-patch',
    {
      title: 'Close uncovered patch lines',
      description:
        'get_uncovered_diff → map_uncovered_to_test → write_and_verify → check until green.',
      argsSchema: { cwd: cwdArg },
    },
    ({ cwd }) => ({
      description:
        'get_uncovered_diff → map_uncovered_to_test → write_and_verify → check until green.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: loadSkillText('close-patch') + (cwd ? `\n\ncwd: ${cwd}\n` : ''),
          },
        },
      ],
    }),
  );

  server.registerResource(
    'skill-triage',
    'tested://skills/triage',
    {
      title: 'Triage skill',
      description: 'Sequenced CI-red workflow (doctor, get_failed, get_flakes, get_uncovered_diff).',
      mimeType: 'text/markdown',
    },
    () => ({
      contents: [
        {
          uri: 'tested://skills/triage',
          mimeType: 'text/markdown',
          text: loadSkillText('triage'),
        },
      ],
    }),
  );

  server.registerResource(
    'skill-close-patch',
    'tested://skills/close-patch',
    {
      title: 'Close-patch skill',
      description:
        'Sequenced coverage-close workflow (get_uncovered_diff, map_uncovered_to_test, write_and_verify, check).',
      mimeType: 'text/markdown',
    },
    () => ({
      contents: [
        {
          uri: 'tested://skills/close-patch',
          mimeType: 'text/markdown',
          text: loadSkillText('close-patch'),
        },
      ],
    }),
  );
}
