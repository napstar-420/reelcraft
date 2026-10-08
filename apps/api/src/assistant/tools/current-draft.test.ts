import { describe, expect, it, vi } from 'vitest';
import { exampleScenesToImages, exampleScript } from '../guide';
import { currentDraft, EMPTY_DRAFT } from './current-draft';
import { newTurnContext, type ToolDeps } from './types';

const working = exampleScript();
const saved = exampleScenesToImages();

function depsWith(blueprint: {
  workingDraftBaseVersionId: string | null;
  currentVersionId: string | null;
}) {
  return {
    blueprints: {
      getBlueprint: vi.fn(async () => ({ ...blueprint, workingDraft: working })),
      listVersions: vi.fn(async () => [{ id: 'v2', ...saved }]),
    },
  } as unknown as ToolDeps;
}

describe('currentDraft', () => {
  const ctx = () => newTurnContext('bp1', null);

  it('uses the working draft while it is based on the current saved version', async () => {
    const deps = depsWith({ workingDraftBaseVersionId: 'v2', currentVersionId: 'v2' });
    expect(await currentDraft(ctx(), deps)).toMatchObject({
      draft: working,
      source: 'working draft',
    });
  });

  it('ignores a working draft based on an older version, and one with no base once a version is saved', async () => {
    for (const base of ['v1', null]) {
      const deps = depsWith({ workingDraftBaseVersionId: base, currentVersionId: 'v2' });
      expect((await currentDraft(ctx(), deps)).source).toBe('latest saved version');
    }
  });

  it('takes a null base as current while nothing is saved', async () => {
    const deps = depsWith({ workingDraftBaseVersionId: null, currentVersionId: null });
    expect((await currentDraft(ctx(), deps)).source).toBe('working draft');
    (deps.blueprints.getBlueprint as ReturnType<typeof vi.fn>).mockResolvedValue({
      workingDraft: null,
      workingDraftBaseVersionId: null,
      currentVersionId: null,
    });
    (deps.blueprints.listVersions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    expect(await currentDraft(ctx(), deps)).toMatchObject({ draft: EMPTY_DRAFT, source: 'empty' });
  });
});
