import { describe, expect, it } from 'vitest';
import type { BlueprintDto, CreateBlueprintVersionDto } from '@reelcraft/shared';
import { withWorkingDraft } from './canvas-draft.logic';

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
  runCount: 2,
  latestPosterBlobId: null,
};

describe('withWorkingDraft', () => {
  it('clears the cached unsaved copy and points at the new save after Save', () => {
    expect(withWorkingDraft(blueprint, null, 'v1')).toEqual({
      ...blueprint,
      workingDraft: null,
      currentVersionId: 'v1',
    });
  });

  it('keeps the current version when only the unsaved copy changes (autosave, discard)', () => {
    const next = withWorkingDraft(blueprint, { ...draft, budget: { runCapUsd: 8 } });
    expect(next?.workingDraft?.budget.runCapUsd).toBe(8);
    expect(next?.currentVersionId).toBe('v0');
  });

  it('does not touch the original object, and leaves an empty cache empty', () => {
    withWorkingDraft(blueprint, null, 'v1');
    expect(blueprint.workingDraft).toBe(draft);
    expect(withWorkingDraft(undefined, null)).toBeUndefined();
  });
});
