import { describe, expect, it } from 'vitest';
import { ApprovalCandidateDto, StageAttemptDto } from './run.dto';

const attempt = {
  id: 'attempt-1',
  attemptNo: 1,
  outcome: 'awaiting_approval',
  phase: 'awaiting_approval',
  actor: 'engine',
  renderedPrompt: 'prompt',
  artifactId: 'artifact-1',
  reviewNote: null,
  critiqueTargetStageKey: null,
  checkResults: [],
  qcVerdict: null,
  costUsd: 0,
  createdAt: '2026-09-26T00:00:00.000Z',
};

describe('approval candidate DTO', () => {
  it('parses the complete attempt audit and safe review artifact', () => {
    expect(StageAttemptDto.parse(attempt)).toEqual(attempt);
    expect(
      ApprovalCandidateDto.parse({
        stageKey: 'draft',
        itemIndex: null,
        attempt,
        artifact: {
          id: 'artifact-1',
          kind: 'text',
          data: { text: 'hello' },
          previewUrl: null,
          attachments: [],
        },
      }).attempt,
    ).toEqual({
      id: 'attempt-1',
      attemptNo: 1,
      checkResults: [],
      qcVerdict: null,
      costUsd: 0,
      createdAt: '2026-09-26T00:00:00.000Z',
    });
  });
});
