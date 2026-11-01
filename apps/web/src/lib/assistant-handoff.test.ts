import { describe, expect, it } from 'vitest';
import {
  aboutRunPrompt,
  askInBlueprint,
  handoffMessage,
  blueprintNameFromPrompt,
  fixFailedStagePrompt,
} from './assistant-handoff';

describe('askInBlueprint', () => {
  it('keeps the message out of the URL, in navigation state', () => {
    expect(askInBlueprint('b1', 'add captions')).toEqual({
      to: '/blueprints/b1/build',
      state: { ask: 'add captions' },
    });
  });
});

describe('handoffMessage', () => {
  it('reads the message an in-app hand-off carries', () => {
    expect(handoffMessage({ ask: 'add captions' })).toBe('add captions');
  });

  it('ignores anything else', () => {
    for (const state of [null, undefined, 'ask', {}, { ask: 3 }, { ask: '  ' }])
      expect(handoffMessage(state)).toBeNull();
  });
});

describe('blueprintNameFromPrompt', () => {
  it('keeps the first six words, capitalised, without punctuation', () => {
    expect(blueprintNameFromPrompt('a 45-second history short: script, voice-over, images')).toBe(
      'A 45-second history short script voice-over',
    );
  });

  it('falls back when there are no words', () => {
    expect(blueprintNameFromPrompt('  !!  ')).toBe('New blueprint');
  });

  it('caps very long words at 60 characters', () => {
    expect(blueprintNameFromPrompt('x'.repeat(80)).length).toBeLessThanOrEqual(60);
  });
});

describe('prompts', () => {
  it('names the run, the stage and the error', () => {
    expect(
      fixFailedStagePrompt({ runHandle: '#abc', stageLabel: 'Scene images', reason: 'timed out' }),
    ).toContain('“Scene images”. The error was: timed out');
  });

  it('leaves the error out when none was recorded', () => {
    expect(
      fixFailedStagePrompt({ runHandle: '#abc', stageLabel: 'Script', reason: null }),
    ).not.toContain('error');
  });

  it('frames a question about a run', () => {
    expect(aboutRunPrompt({ runHandle: '#abc', question: 'why so slow?' })).toBe(
      'About run #abc of this blueprint: why so slow?',
    );
  });
});
