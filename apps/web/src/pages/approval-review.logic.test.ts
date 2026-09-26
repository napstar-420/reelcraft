import { describe, expect, it } from 'vitest';
import {
  approvalCandidateView,
  describeApiFailure,
  isApprovalStillOpen,
  rejectionPreviewSummary,
} from './approval-review.logic';

describe('approval review logic', () => {
  it('preserves text output verbatim', () => {
    expect(approvalCandidateView('text', 'first\nsecond')).toEqual({
      kind: 'text',
      text: 'first\nsecond',
    });
    expect(approvalCandidateView('text', { text: 'stored\ntext' })).toEqual({
      kind: 'text',
      text: 'stored\ntext',
    });
  });

  it('formats structured outputs as readable JSON', () => {
    expect(approvalCandidateView('data', { topic: 'Space' })).toEqual({
      kind: 'json',
      text: '{\n  "topic": "Space"\n}',
    });
    expect(approvalCandidateView('timeline', [{ type: 'clip' }])).toEqual({
      kind: 'json',
      text: '[\n  {\n    "type": "clip"\n  }\n]',
    });
  });

  it('selects native previews and fallback downloads for blob output', () => {
    expect(approvalCandidateView('media.image', null, '/preview/image')).toEqual({
      kind: 'image',
      url: '/preview/image',
    });
    expect(approvalCandidateView('media.video', null, '/preview/video')).toEqual({
      kind: 'video',
      url: '/preview/video',
    });
    expect(approvalCandidateView('media.audio', null, '/preview/audio')).toEqual({
      kind: 'audio',
      url: '/preview/audio',
    });
    expect(approvalCandidateView('file', null, '/download/file')).toEqual({
      kind: 'download',
      url: '/download/file',
    });
  });

  it('summarizes affected stages without double-counting them', () => {
    expect(
      rejectionPreviewSummary({
        affected: [
          { stageKey: 'draft', estimatedRerunUsd: 0.1 },
          { stageKey: 'render', estimatedRerunUsd: 0.2 },
          { stageKey: 'render', estimatedRerunUsd: 0.3 },
        ],
        estimatedRerunUsd: 0.6,
      }),
    ).toEqual({ stageKeys: ['draft', 'render'], estimatedRerunUsd: 0.6 });
  });

  it('recognizes when polling has concurrently resolved the approval', () => {
    expect(
      isApprovalStillOpen('stage-1', { state: 'PAUSED_APPROVAL', cursorStageKey: 'stage-1' }),
    ).toBe(true);
    expect(isApprovalStillOpen('stage-1', { state: 'RUNNING', cursorStageKey: 'stage-1' })).toBe(
      false,
    );
    expect(
      isApprovalStillOpen('stage-1', { state: 'PAUSED_APPROVAL', cursorStageKey: 'stage-2' }),
    ).toBe(false);
  });

  it('gives conflicts a useful message and preserves ordinary errors', () => {
    expect(describeApiFailure({ status: 409 })).toMatch(/already resolved/i);
    expect(describeApiFailure(new Error('network unavailable'))).toBe('network unavailable');
  });
});
