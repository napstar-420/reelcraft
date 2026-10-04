import { describe, expect, it } from 'vitest';
import { quotaPauseMessage } from './quota-pause';

describe('quotaPauseMessage', () => {
  it('says when the run resumes by itself', () => {
    expect(quotaPauseMessage('2026-10-05T00:01:00.000Z', (d) => d.toISOString())).toBe(
      'Paused: every Flow account is out of credits. It resumes by itself around 2026-10-05T00:01:00.000Z, or resume it now to try again.',
    );
  });
  it('has a plain message without a usable time', () => {
    for (const resumeAt of [null, undefined, '', 'soon']) {
      expect(quotaPauseMessage(resumeAt, () => 'never')).toBe(
        'Paused: every Flow account is out of credits. Resume it to try again.',
      );
    }
  });
});
