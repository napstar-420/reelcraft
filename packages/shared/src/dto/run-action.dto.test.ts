import { describe, expect, it } from 'vitest';
import {
  ApprovalActionDto,
  ConfirmRunActionDto,
  HumanInputSubmissionDto,
  ManualArtifactEditDto,
  PatchRunOverridesDto,
} from './run-action.dto';

describe('run action DTOs', () => {
  it('distinguishes approval from rejection and carries the rejection preview token', () => {
    expect(ApprovalActionDto.parse({ action: 'approve' })).toEqual({ action: 'approve' });
    expect(
      ApprovalActionDto.parse({
        action: 'reject',
        note: 'The pacing is too slow',
        previewToken: 'signed-token',
      }),
    ).toEqual({
      action: 'reject',
      note: 'The pacing is too slow',
      previewToken: 'signed-token',
    });
  });

  it('requires a non-empty preview token for confirmations', () => {
    expect(() => ConfirmRunActionDto.parse({ previewToken: '' })).toThrow();
    expect(ConfirmRunActionDto.parse({ previewToken: 'token' })).toEqual({
      previewToken: 'token',
    });
  });

  it('accepts an optional itemIndex on the retry-confirmation DTO, mirroring ApprovalActionDto', () => {
    expect(ConfirmRunActionDto.parse({ previewToken: 'token' })).toEqual({
      previewToken: 'token',
    });
    expect(ConfirmRunActionDto.parse({ previewToken: 'token', itemIndex: 2 })).toEqual({
      previewToken: 'token',
      itemIndex: 2,
    });
    expect(() => ConfirmRunActionDto.parse({ previewToken: 'token', itemIndex: -1 })).toThrow();
    expect(() => ConfirmRunActionDto.parse({ previewToken: 'token', itemIndex: 1.5 })).toThrow();
  });

  it('validates sparse per-stage overrides', () => {
    expect(
      PatchRunOverridesDto.parse({
        overrides: {
          script: { retryLimit: 3, model: { params: { temperature: 0.4 } } },
        },
      }),
    ).toEqual({
      overrides: {
        script: { retryLimit: 3, model: { params: { temperature: 0.4 } } },
      },
    });
  });

  it('accepts arbitrary user-authored values for edit and human input validation downstream', () => {
    expect(ManualArtifactEditDto.parse({ value: { title: 'Edited' } })).toEqual({
      value: { title: 'Edited' },
    });
    expect(HumanInputSubmissionDto.parse({ value: 'Use the documentary theme' })).toEqual({
      value: 'Use the documentary theme',
    });
  });
});
