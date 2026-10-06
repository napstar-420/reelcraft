import { describe, expect, it } from 'vitest';
import { answersToText, applyModeNote, buildInstructions } from './instructions';
import { ASSISTANT_TOOLS } from './tools/registry';

const text = buildInstructions({
  blueprintName: 'My reel',
  appVersion: '0.5.0',
  date: '2026-10-06',
});

describe('assistant instructions', () => {
  it('bind the assistant to the blueprint, version and date', () => {
    expect(text).toContain('"My reel"');
    expect(text).toContain('Reelcraft 0.5.0');
    expect(text).toContain('2026-10-06');
  });

  it('only name tools that exist, and name every tool the flow depends on', () => {
    const mentioned = new Set(
      text.match(/\b(?:get|list|read|validate|propose|update|ask)_[a-z_]+\b/g),
    );
    const real = new Set(ASSISTANT_TOOLS.map((t) => t.name));
    expect([...mentioned].filter((name) => !real.has(name))).toEqual([]);
    for (const required of [
      'get_blueprint',
      'validate_draft',
      'propose_draft',
      'ask_user',
      'read_guide',
    ]) {
      expect(mentioned.has(required)).toBe(true);
    }
  });

  it('make quality the default, not something the user has to ask for', () => {
    for (const phrase of ['"quality" topic', 'system prompt', 'qc', 'iterat', 'dataOutput']) {
      expect(text).toContain(phrase);
    }
  });

  it('state the hard limits up front, not only in the guide', () => {
    for (const phrase of ['parallel', 'enabledWhen', 'publish', 'Characters']) {
      expect(text).toContain(phrase);
    }
  });

  it('tell the model to look things up and admit what Reelcraft cannot do', () => {
    expect(text).toContain('Never guess');
    expect(text).toContain('limits');
    expect(text).toContain('does not exist here'.replace('does not', "doesn't"));
  });
});

describe('applyModeNote', () => {
  it('says whether proposals are applied for the user', () => {
    expect(applyModeNote('auto')).toContain('applied to the canvas immediately');
    expect(applyModeNote('manual')).toContain('waits for the user');
  });
});

describe('answersToText', () => {
  it('turns answers (including free text and multi-select) into the next turn', () => {
    const out = answersToText(
      [
        { id: 'len', header: 'Length', question: 'How long?' },
        { id: 'style', header: 'Style', question: 'Which styles?' },
        { id: 'x', header: 'Extra', question: 'Anything else?' },
      ],
      { len: '30s', style: ['Bold', 'Clean'] },
    );
    expect(out).toContain('- Length (How long?): 30s');
    expect(out).toContain('- Style (Which styles?): Bold, Clean');
    expect(out).toContain('- Extra (Anything else?): (no answer)');
  });
});
