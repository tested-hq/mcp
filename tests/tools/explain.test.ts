import { describe, expect, it, vi } from 'vitest';
import type { CliExplainOutput } from '../../src/schemas.js';

const MOCK_EXPLAIN: CliExplainOutput = {
  path: 'src/commands/diff.ts',
  line: 42,
  uncovered: true,
  reason: 'not executed',
  codeExcerpt: "42  if (opts.json) {",
};

vi.mock('../../src/cli.js', () => ({
  runCli: vi.fn().mockResolvedValue(MOCK_EXPLAIN),
  TESTED_BIN: '/fake/tested.js',
}));

const { explain } = await import('../../src/tools/explain.js');

describe('explain', () => {
  it('returns explain result with correct shape', async () => {
    const result = await explain({ cwd: '/repo', location: 'src/commands/diff.ts:42' });
    expect(result.path).toBe('src/commands/diff.ts');
    expect(result.line).toBe(42);
    expect(result.uncovered).toBe(true);
    expect(result.reason).toBe('not executed');
    expect(result.codeExcerpt).toBe("42  if (opts.json) {");
  });
});
