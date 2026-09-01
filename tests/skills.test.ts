import { describe, expect, it } from 'vitest';
import { CLOSE_PATCH_SKILL, TRIAGE_SKILL, loadSkillText } from '../src/skills.js';

describe('skills', () => {
  it('loads in-repo SKILL.md and never says mock', () => {
    const triage = loadSkillText('triage');
    const close = loadSkillText('close-patch');
    expect(triage).toMatch(/get_failed/);
    expect(close).toMatch(/map_uncovered_to_test/);
    expect(triage.length).toBeGreaterThan(TRIAGE_SKILL.length / 2);
    expect(close.length).toBeGreaterThan(CLOSE_PATCH_SKILL.length / 2);
    expect(`${triage}${close}`.toLowerCase()).not.toMatch(/mock/);
  });
});
