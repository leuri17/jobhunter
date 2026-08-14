import { describe, expect, it } from 'vitest';

import {
  FailingProfileEditorPrompts,
  ScriptedProfileEditorPrompts,
  createFailingEditorPrompts,
} from '../../../src/profile/editing/prompts.js';

describe('FailingProfileEditorPrompts', () => {
  it('every method rejects with the configured reason', async () => {
    const prompts = new FailingProfileEditorPrompts('boom');
    await expect(prompts.selectSection(null)).rejects.toThrow('boom');
    await expect(
      prompts.editScalar({
        section: 'basics',
        field: 'headline',
        currentValue: null,
        nullable: true,
      }),
    ).rejects.toThrow('boom');
    await expect(
      prompts.editCollection({
        section: 'experience',
        entries: [],
        supportsReorder: true,
      }),
    ).rejects.toThrow('boom');
    await expect(
      prompts.resolveConflict({
        conflict: {
          id: 1,
          profileVersionId: 1,
          conflictType: 'work_experience.start_date',
          affectedField: 'startDate',
          valueSourceA: 'a',
          valueSourceB: 'b',
          sourceReferences: [],
          provisionalValue: null,
          explanation: null,
          resolutionStatus: 'unresolved',
          resolvedAt: null,
          resolvedValue: null,
        },
        entityId: 'x',
        provisionalValue: null,
      }),
    ).rejects.toThrow('boom');
    await expect(
      prompts.manageOverrides({
        field: 'likelySeniority',
        generatedValue: 'senior',
        currentEffective: 'senior',
        overrideActive: false,
      }),
    ).rejects.toThrow('boom');
    await expect(
      prompts.showReview({
        state: {
          profile: {} as never,
          pendingRevisions: [],
          pendingOverrides: [],
          sectionHistory: [],
        },
        rendered: '',
      }),
    ).rejects.toThrow('boom');
    await expect(
      prompts.confirmSave({
        state: {
          profile: {} as never,
          pendingRevisions: [],
          pendingOverrides: [],
          sectionHistory: [],
        },
        remainingWarnings: 0,
      }),
    ).rejects.toThrow('boom');
    await expect(
      prompts.confirmDiscard({
        state: {
          profile: {} as never,
          pendingRevisions: [],
          pendingOverrides: [],
          sectionHistory: [],
        },
      }),
    ).rejects.toThrow('boom');
  });

  it('createFailingEditorPrompts is a factory that returns a new instance each call', () => {
    const a = createFailingEditorPrompts('a');
    const b = createFailingEditorPrompts('b');
    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(FailingProfileEditorPrompts);
  });
});

describe('ScriptedProfileEditorPrompts', () => {
  it('replays scripted responses in order per method', async () => {
    const scripted = new ScriptedProfileEditorPrompts({
      selectSection: ['basics', 'skills'],
      editScalar: [{ kind: 'set', value: 'Staff Engineer' }, { kind: 'keep' }],
      confirmSave: [{ kind: 'save' }],
    });
    expect(await scripted.selectSection(null)).toBe('basics');
    expect(await scripted.selectSection(null)).toBe('skills');
    const r1 = await scripted.editScalar({
      section: 'basics',
      field: 'headline',
      currentValue: null,
      nullable: true,
    });
    expect(r1).toEqual({ kind: 'set', value: 'Staff Engineer' });
    const r2 = await scripted.editScalar({
      section: 'basics',
      field: 'headline',
      currentValue: null,
      nullable: true,
    });
    expect(r2).toEqual({ kind: 'keep' });
    const save = await scripted.confirmSave({
      state: {
        profile: {} as never,
        pendingRevisions: [],
        pendingOverrides: [],
        sectionHistory: [],
      },
      remainingWarnings: 0,
    });
    expect(save).toEqual({ kind: 'save' });
  });

  it('records every call argument in calls[]', async () => {
    const scripted = new ScriptedProfileEditorPrompts({
      selectSection: ['basics', 'skills'],
    });
    await scripted.selectSection(null);
    await scripted.selectSection('basics');
    expect(scripted.calls.selectSection).toEqual([null, 'basics']);
  });

  it('rejects when a method is called without a scripted response', async () => {
    const scripted = new ScriptedProfileEditorPrompts({});
    await expect(scripted.selectSection(null)).rejects.toThrow(/selectSection/);
  });

  it('default constructor (no script) rejects on first call', async () => {
    const scripted = new ScriptedProfileEditorPrompts();
    await expect(prompts_showReview(scripted)).rejects.toThrow(/showReview/);
  });
});

async function prompts_showReview(scripted: ScriptedProfileEditorPrompts): Promise<unknown> {
  return scripted.showReview({
    state: {
      profile: {} as never,
      pendingRevisions: [],
      pendingOverrides: [],
      sectionHistory: [],
    },
    rendered: '',
  });
}
