import { describe, expect, it } from 'vitest';
import { gitDiffNameOnly, gitShowFile, gitShowFirst } from '../src/git-at.js';
import { makeTmpGitRepo } from './helpers/tmp-git.js';

describe('git-at', () => {
  it('rejects unsafe relative paths', () => {
    const cwd = makeTmpGitRepo();
    expect(() => gitShowFile(cwd, 'HEAD', '')).toThrow(/must not be empty/);
    expect(() => gitShowFile(cwd, 'HEAD', '-secret')).toThrow(/must not start with -/);
    expect(() => gitShowFile(cwd, 'HEAD', '../etc/passwd')).toThrow(/relative path/);
    expect(() => gitShowFile(cwd, 'HEAD', '/abs')).toThrow(/relative path/);
    expect(() => gitShowFile(cwd, 'HEAD', 'foo\0bar')).toThrow(/null bytes/);
  });

  it('returns null for a missing blob', () => {
    const cwd = makeTmpGitRepo();
    expect(gitShowFile(cwd, 'HEAD', 'nope.txt')).toBeNull();
    expect(gitShowFirst(cwd, 'HEAD', ['a.xml', 'b.xml'])).toBeNull();
    expect(gitDiffNameOnly(cwd, 'HEAD')).toEqual([]);
  });
});
