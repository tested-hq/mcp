import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliDiffOutput } from '../../src/schemas.js';

const MOCK_DIFF: CliDiffOutput = {
  schemaVersion: 1,
  base: 'origin/main',
  head: 'abc123',
  patch: { executable: 5, covered: 5, pct: 100 },
  project: { executable: 200, covered: 200, pct: 100 },
  files: [
    { path: 'src/foo.ts', patchCoverage: 100, projectCoverage: 100, uncoveredRanges: [] },
  ],
};

// vitest runner spawn — we stub it via the runner module
vi.mock('../../src/cli.js', () => ({
  runCli: vi.fn().mockResolvedValue(MOCK_DIFF),
  TESTED_BIN: '/fake/tested.js',
}));

vi.mock('../../src/tools/run-tests.js', () => ({
  runTestsWithCoverage: vi.fn(),
}));

const { writeAndVerify } = await import('../../src/tools/write_and_verify.js');
const { runTestsWithCoverage } = await import('../../src/tools/run-tests.js');
const runTestsMock = vi.mocked(runTestsWithCoverage);

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mcp-write-and-verify-'));
  // Give validateCwd a .git so it accepts the dir
  mkdirSync(join(tmpDir, '.git'));
  runTestsMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('writeAndVerify', () => {
  it('writes the file, runs tests, and returns diff on success', async () => {
    runTestsMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });
    mkdirSync(join(tmpDir, 'tests'));
    const result = await writeAndVerify({
      cwd: tmpDir,
      base: 'origin/main',
      path: 'tests/foo.test.ts',
      content: "import { describe } from 'vitest';",
    });
    expect(result.success).toBe(true);
    expect(result.bytesWritten).toBe("import { describe } from 'vitest';".length);
    expect(result.vitestStderr).toBeNull();
    expect(result.diff).toBeDefined();
    expect(result.diff?.files).toEqual([]);
    expect(readFileSync(join(tmpDir, 'tests/foo.test.ts'), 'utf8')).toBe(
      "import { describe } from 'vitest';",
    );
  });

  it('returns success:false with vitestStderr when tests fail', async () => {
    runTestsMock.mockResolvedValue({
      success: false,
      stdout: 'some stdout',
      stderr: 'AssertionError: expected 1 to equal 2',
    });
    mkdirSync(join(tmpDir, 'tests'));
    const result = await writeAndVerify({
      cwd: tmpDir,
      base: 'origin/main',
      path: 'tests/foo.test.ts',
      content: 'broken test',
    });
    expect(result.success).toBe(false);
    expect(result.bytesWritten).toBe('broken test'.length);
    expect(result.vitestStderr).toContain('AssertionError');
    expect(result.vitestStdout).toBe('some stdout');
    expect(result.diff).toBeUndefined();
  });

  it('rejects paths that escape cwd', async () => {
    runTestsMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });
    // Pre-create the file outside to ensure we'd be writing somewhere bad
    writeFileSync(join(tmpDir, '..', 'should-not-write.txt'), 'pre');
    await expect(
      writeAndVerify({
        cwd: tmpDir,
        base: 'origin/main',
        path: '../escape.ts',
        content: 'x',
      }),
    ).rejects.toThrow(/outside/);
  });

  it('rejects intermediate symlink that points outside the tree', async () => {
    runTestsMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });
    const { symlinkSync, mkdtempSync: mk } = await import('node:fs');
    const { tmpdir: td } = await import('node:os');
    const outside = mk(join(td(), 'mcp-wav-outside-'));
    try {
      symlinkSync(outside, join(tmpDir, 'tests'));
    } catch {
      return; // platform cannot create symlinks
    }
    await expect(
      writeAndVerify({
        cwd: tmpDir,
        base: 'origin/main',
        path: 'tests/evil.test.ts',
        content: 'x',
      }),
    ).rejects.toThrow(/symlink|escapes/i);
    expect(runTestsMock).not.toHaveBeenCalled();
  });

  it('rejects cwd that is not a git repo before writing', async () => {
    runTestsMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });
    const noGit = mkdtempSync(join(tmpdir(), 'mcp-no-git-'));
    await expect(
      writeAndVerify({
        cwd: noGit,
        base: 'origin/main',
        path: 'evil.test.ts',
        content: 'x',
      }),
    ).rejects.toThrow(/\.git/);
    expect(runTestsMock).not.toHaveBeenCalled();
  });

  it('rejects an unsafe git ref after cwd validation', async () => {
    await expect(
      writeAndVerify({
        cwd: tmpDir,
        base: '--output=/tmp/x',
        path: 'tests/foo.test.ts',
        content: 'x',
      }),
    ).rejects.toThrow(/must not start with/);
    expect(runTestsMock).not.toHaveBeenCalled();
  });

  it('writes content that is exactly at the byte limit', async () => {
    runTestsMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });
    const { MAX_WRITE_CONTENT_BYTES } = await import(
      '../../src/tools/write_and_verify.js'
    );
    const content = 'x'.repeat(MAX_WRITE_CONTENT_BYTES);
    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    const result = await writeAndVerify({
      cwd: tmpDir,
      base: 'HEAD',
      path: 'tests/exact.test.ts',
      content,
    });
    expect(result.success).toBe(true);
    expect(result.bytesWritten).toBe(MAX_WRITE_CONTENT_BYTES);
  });

  it('rejects oversized content (DoS guard)', async () => {
    runTestsMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });
    const { MAX_WRITE_CONTENT_BYTES } = await import(
      '../../src/tools/write_and_verify.js'
    );
    const big = 'x'.repeat(MAX_WRITE_CONTENT_BYTES + 1);
    await expect(
      writeAndVerify({
        cwd: tmpDir,
        base: 'origin/main',
        path: 'tests/big.test.ts',
        content: big,
      }),
    ).rejects.toThrow(/byte limit/);
    expect(runTestsMock).not.toHaveBeenCalled();
  });
});
