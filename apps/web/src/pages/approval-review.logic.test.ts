import { describe, expect, it } from 'vitest';
import {
  approvalCandidateView,
  approveAllLabel,
  describeApiFailure,
  heldReasonLabel,
  isApprovalStillOpen,
  rejectLabel,
  rejectedItems,
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

describe('approveAllLabel', () => {
  it('counts the items, and the held ones when there are any', () => {
    expect(approveAllLabel([{ held: false }, { held: false }])).toBe('Approve all (2)');
    expect(approveAllLabel([{ held: true }, { held: false }, { held: true }])).toBe(
      'Approve all (3, incl. 2 held)',
    );
  });
});

describe('heldReasonLabel', () => {
  it('names why an item is held, and nothing for a passed one', () => {
    expect(heldReasonLabel('qc_failed')).toBe('Held: QC did not pass it');
    expect(heldReasonLabel('qc_error')).toBe('Held: QC could not run');
    expect(heldReasonLabel(null)).toBeNull();
  });
});

describe('rejectedItems', () => {
  it('orders the ticked items and keeps a note only when one was written', () => {
    expect(rejectedItems({ 3: '  ', 0: ' make it brighter ', 2: '' })).toEqual([
      { itemIndex: 0, note: 'make it brighter' },
      { itemIndex: 2 },
      { itemIndex: 3 },
    ]);
    expect(rejectedItems({})).toEqual([]);
  });
});

describe('rejectLabel', () => {
  it('rejects the whole stage until items are ticked, then says how many', () => {
    expect(rejectLabel(0)).toBe('Reject stage');
    expect(rejectLabel(1)).toBe('Reject 1 item');
    expect(rejectLabel(4)).toBe('Reject 4 items');
  });
});
