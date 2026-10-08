import { describe, expect, it } from 'vitest';
import type { BlueprintDto, CreateBlueprintVersionDto } from '@reelcraft/shared';
import {
  blueprintChanged,
  newerSaved,
  outdatedEditor,
  pickInitialDraft,
  withWorkingDraft,
} from './canvas-draft.logic';

const draft: CreateBlueprintVersionDto = {
  graph: [],
  inputs: [],
  roles: [],
  defaults: {},
  budget: { runCapUsd: 3 },
};
const blueprint: BlueprintDto = {
  id: 'b1',
  channelId: 'c1',
  name: 'Short story',
  description: null,
  tags: [],
  currentVersionId: 'v0',
  archived: false,
  workingDraft: draft,
  workingDraftBaseVersionId: 'v0',
  runCount: 2,
  latestPosterBlobId: null,
};

describe('withWorkingDraft', () => {
  it('clears the cached unsaved copy and points at the new save after Save', () => {
    expect(withWorkingDraft(blueprint, null, null, 'v1')).toEqual({
      ...blueprint,
      workingDraft: null,
      workingDraftBaseVersionId: null,
      currentVersionId: 'v1',
    });
  });

  it('keeps the current version when only the unsaved copy changes (autosave, discard)', () => {
    const next = withWorkingDraft(blueprint, { ...draft, budget: { runCapUsd: 8 } }, 'v0');
    expect(next?.workingDraft?.budget.runCapUsd).toBe(8);
    expect(next?.workingDraftBaseVersionId).toBe('v0');
    expect(next?.currentVersionId).toBe('v0');
  });

  it('records the version a written draft is based on, e.g. after "Keep my edits"', () => {
    const next = withWorkingDraft(blueprint, draft, 'v1', 'v1');
    expect(next).toMatchObject({ workingDraftBaseVersionId: 'v1', currentVersionId: 'v1' });
  });

  it('does not touch the original object, and leaves an empty cache empty', () => {
    withWorkingDraft(blueprint, null, null, 'v1');
    expect(blueprint.workingDraft).toBe(draft);
    expect(withWorkingDraft(undefined, null, null)).toBeUndefined();
  });
});

describe('pickInitialDraft', () => {
  it('loads the unsaved copy when it was made from the latest save', () => {
    expect(pickInitialDraft({ latestSavedId: 'v2', working: draft, workingBaseId: 'v2' })).toEqual({
      draft: 'working',
    });
  });

  it('loads the latest save and offers an unsaved copy made from an older one', () => {
    expect(pickInitialDraft({ latestSavedId: 'v2', working: draft, workingBaseId: 'v1' })).toEqual({
      draft: 'saved',
      orphan: draft,
    });
  });

  it('offers a legacy copy that recorded no base once a version is saved, and loads it before the first save', () => {
    expect(pickInitialDraft({ latestSavedId: 'v2', working: draft, workingBaseId: null })).toEqual({
      draft: 'saved',
      orphan: draft,
    });
    expect(pickInitialDraft({ latestSavedId: null, working: draft, workingBaseId: null })).toEqual({
      draft: 'working',
    });
  });

  it('offers a copy made when nothing was saved once a version exists', () => {
    expect(
      pickInitialDraft({ latestSavedId: 'v1', working: draft, workingBaseId: null }).orphan,
    ).toBe(draft);
  });

  it('loads the latest save when there is no unsaved copy', () => {
    expect(pickInitialDraft({ latestSavedId: 'v2', working: null, workingBaseId: null })).toEqual({
      draft: 'saved',
    });
  });
});

describe('newerSaved', () => {
  const v13 = { id: 'a', major: 1, minor: 3 };
  const v12 = { id: 'b', major: 1, minor: 2 };
  const v20 = { id: 'c', major: 2, minor: 0 };

  it('finds a save the canvas is not based on', () => {
    expect(newerSaved({ major: 1, minor: 2 }, [v13, v12])).toBe(v13);
    expect(newerSaved({ major: 1, minor: 9 }, [v20])).toBe(v20);
    expect(newerSaved(null, [v12])).toBe(v12);
  });

  it('does not count the canvas’s own save, nor the stale list from just before it', () => {
    expect(newerSaved({ major: 1, minor: 3 }, [v13, v12])).toBeNull();
    expect(newerSaved({ major: 1, minor: 3 }, [v12])).toBeNull();
    expect(newerSaved(null, [])).toBeNull();
    expect(newerSaved({ major: 1, minor: 3 }, undefined)).toBeNull();
  });
});

describe('blueprintChanged', () => {
  const conflict = (body: unknown, status = 409) => ({ status, issues: body });

  it('reads the current version from the API’s conflict', () => {
    expect(
      blueprintChanged(conflict({ code: 'blueprint_changed', currentVersionId: 'v3' })),
    ).toEqual({ currentVersionId: 'v3' });
  });

  it('ignores other errors, including other 409s', () => {
    expect(blueprintChanged(conflict({ code: 'blueprint_name_taken' }))).toBeNull();
    expect(blueprintChanged(conflict({ code: 'blueprint_changed' }, 400))).toBeNull();
    expect(blueprintChanged(new Error('boom'))).toBeNull();
    expect(blueprintChanged(undefined)).toBeNull();
  });
});

describe('outdatedEditor', () => {
  it('recognises the 400 for a draft write missing its base version', () => {
    const issues = [{ code: 'invalid_type', path: ['baseVersionId'], message: 'Required' }];
    expect(outdatedEditor({ status: 400, issues })).toBe(true);
  });

  it('does not mistake an invalid draft, or another status, for it', () => {
    const invalid = [
      { code: 'invalid_type', path: ['workingDraft', 'budget'], message: 'Required' },
    ];
    expect(outdatedEditor({ status: 400, issues: invalid })).toBe(false);
    expect(outdatedEditor({ status: 409, issues: { code: 'blueprint_changed' } })).toBe(false);
    expect(outdatedEditor({ status: 400 })).toBe(false);
    expect(outdatedEditor(null)).toBe(false);
  });
});
