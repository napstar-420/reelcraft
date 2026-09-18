import { describe, expect, it, vi } from 'vitest';
import { ArtifactEditService } from './artifact-edit.service';

describe('ArtifactEditService', () => {
  it('binds manual-edit previews to the replacement value and explicit source artifact', async () => {
    const service = Object.assign(Object.create(ArtifactEditService.prototype) as object, {
      loadContext: vi.fn().mockResolvedValue({
        run: { id: 'run-1', revision: 5 },
        stage: { key: 'draft', output: { kind: 'text' } },
        execution: { id: 'execution-1', outputArtifactId: 'artifact-1' },
        sourceArtifactId: 'artifact-1',
      }),
      validateValue: vi.fn().mockReturnValue({ text: 'new copy' }),
      invalidation: {
        preview: vi.fn().mockResolvedValue({
          closure: {
            affectedStageKeys: ['draft'],
            affectedExecutionIds: ['execution-1'],
            affectedArtifactIds: ['artifact-1'],
          },
          costs: [],
          totals: { spentUsd: 0, estimatedRerunUsd: 0 },
          fingerprint: 'fp',
        }),
      },
      tokens: { issue: vi.fn().mockReturnValue({ token: 'signed', expiresAt: 'soon' }) },
    }) as unknown as ArtifactEditService;

    await service.edit('run-1', 'draft', { value: 'new copy', sourceArtifactId: 'artifact-1' });

    expect(
      (service as never as { tokens: { issue: ReturnType<typeof vi.fn> } }).tokens.issue,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'edit_artifact',
        runRevision: 5,
        proposedPayload: { stageKey: 'draft', value: 'new copy', sourceArtifactId: 'artifact-1' },
      }),
    );
  });
});
