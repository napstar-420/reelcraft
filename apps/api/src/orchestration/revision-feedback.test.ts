import { describe, expect, it } from 'vitest';
import { feedbackForAttempt, revisionPrompt } from './revision-feedback';

describe('revision feedback', () => {
  it('uses only failed checks from the previous attempt', () => {
    const feedback = feedbackForAttempt({
      attemptNo: 2,
      outcome: 'check_failed',
      checkResults: [
        { name: 'length', pass: true },
        { name: 'hook', pass: false, message: 'Needs a stronger opening' },
      ],
    });
    expect(feedback).toContain('hook: Needs a stronger opening');
    expect(feedback).not.toContain('length');
    expect(revisionPrompt(feedback!, 'text', { kind: 'text' })).toContain(
      'Return a complete replacement output',
    );
  });

  it('includes QC dimensions and asks for one edited image', () => {
    const feedback = feedbackForAttempt({
      attemptNo: 3,
      outcome: 'qc_failed',
      qcVerdict: {
        score: 48,
        critique: 'Wrong background',
        dimensions: [{ key: 'style', score: 40, critique: 'Too dark' }],
      },
    });
    const prompt = revisionPrompt(feedback!, 'image', { kind: 'media.image' });
    expect(prompt).toContain('style: 40 — Too dark');
    expect(prompt).toContain('Produce one revised final image');
    expect(prompt).toContain('Preserve the existing subject identity');
  });
});
