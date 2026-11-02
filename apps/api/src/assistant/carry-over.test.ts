import { describe, expect, it } from 'vitest';
import {
  CARRY_OVER_INPUT_TOKENS,
  SUMMARY_CHARS,
  carryOverReason,
  fallbackSummary,
  withSummary,
} from './carry-over';

describe('carrying a chat over', () => {
  it('starts fresh after an update or a very long turn', () => {
    expect(carryOverReason({ stale: true, lastInputTokens: 10 })).toBe('updated');
    expect(carryOverReason({ stale: false, lastInputTokens: CARRY_OVER_INPUT_TOKENS + 1 })).toBe(
      'long',
    );
    expect(carryOverReason({ stale: false, lastInputTokens: 1000 })).toBeNull();
    expect(carryOverReason({ stale: false, lastInputTokens: null })).toBeNull();
  });

  it('falls back to the newest words of the conversation, within the limit', () => {
    const long = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      text: `message ${i} ${'x'.repeat(500)}`,
    }));
    const summary = fallbackSummary(long);
    expect(summary.length).toBeLessThan(SUMMARY_CHARS + 200);
    expect(summary).toContain('message 39');
    expect(summary).not.toContain('message 0 ');
    expect(summary.indexOf('message 38')).toBeLessThan(summary.indexOf('message 39'));
  });

  it('puts the hand-off before the message', () => {
    expect(withSummary('did things', 'next')).toBe(
      '<earlier_conversation_summary>\ndid things\n</earlier_conversation_summary>\n\nnext',
    );
  });
});
