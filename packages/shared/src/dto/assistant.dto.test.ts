import { describe, expect, it } from 'vitest';
import { StartAssistantTurnDto } from './assistant.dto';

describe('assistant message length', () => {
  const turn = { draft: null, model: 'test-model' };

  it.each([32_000, 64_000])('accepts a %i-character prompt', (length) => {
    expect(StartAssistantTurnDto.safeParse({ ...turn, text: 'x'.repeat(length) }).success).toBe(
      true,
    );
  });

  it('rejects prompts above 64,000 characters', () => {
    expect(StartAssistantTurnDto.safeParse({ ...turn, text: 'x'.repeat(64_001) }).success).toBe(
      false,
    );
  });
});
