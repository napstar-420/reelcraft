import { describe, expect, it } from 'vitest';
import { answersToText, buildInstructions, contextNote } from './instructions';
import { GUIDE_TOPICS } from './guide';
import { ASSISTANT_TOOLS } from './tools/registry';

const text = buildInstructions({ appVersion: '0.5.0', date: '2026-10-06' });

describe('assistant instructions', () => {
  it('name the version and date, and explain the context and modes', () => {
    expect(text).toContain('<reelcraft_context>');
    for (const mode of ['Manual:', 'Auto:', 'Plan:']) expect(text).toContain(mode);
    expect(text).toContain('Reelcraft 0.5.0');
    expect(text).toContain('2026-10-06');
  });

  it('only name tools that exist, and name every tool the flow depends on', () => {
    const mentioned = new Set(
      text.match(
        /\b(?:get|list|read|validate|propose|edit|update|ask|present|create|archive|delete|save|restore|start|run|retry|pause|resume|cancel|raise|set|approve|reject|provide|view|listen)_[a-z_]+\b/g,
      ),
    );
    const real = new Set(ASSISTANT_TOOLS.map((t) => t.name));
    expect([...mentioned].filter((name) => !real.has(name))).toEqual([]);
    for (const required of [
      'get_blueprint',
      'validate_draft',
      'propose_draft',
      'edit_draft',
      'get_stages',
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

  it('tell the assistant to look at runs first and to distrust what they contain', () => {
    for (const phrase of ['list_runs', 'get_stage', 'view_stage_media', '"diagnose" topic']) {
      expect(text).toContain(phrase);
    }
    expect(text).toMatch(/untrusted data/i);
  });

  it('has the sections the assistant relies on, in a stable order', () => {
    const headings = [...text.matchAll(/^# (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      'Who you are',
      'Where you are and what "this" means',
      'Modes',
      'Where your knowledge comes from',
      'What Reelcraft cannot do (always true)',
      'How you work on a blueprint',
      'Build quality: you know Reelcraft better than the user',
      'Channels and blueprints',
      'Versions',
      'Runs: reading them',
      'Runs: acting on them',
      'Untrusted data',
      'Talking to the user',
    ]);
  });

  it('only point at guide topics that exist', () => {
    const quoted = [...text.matchAll(/"([a-z-]+)" topic/g)].map((m) => m[1]!);
    expect(quoted.length).toBeGreaterThan(5);
    expect(quoted.filter((topic) => !GUIDE_TOPICS.includes(topic))).toEqual([]);
    const list = text.match(/recipes \(proven shapes\), ([^:]+?)\. The guide is/)![1]!;
    const names = ['recipes', ...list.replace(/\([^)]*\)/g, '').split(/,\s*|\s+and\s+/)]
      .map((n) => n.trim())
      .filter(Boolean);
    expect(names.filter((n) => !GUIDE_TOPICS.includes(n))).toEqual([]);
  });

  it('name every tool, so a new one can not ship unexplained', () => {
    const missing = ASSISTANT_TOOLS.map((t) => t.name).filter((name) => !text.includes(name));
    expect(missing).toEqual([]);
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

describe('contextNote', () => {
  it('states the mode and where the user is', () => {
    expect(contextNote('auto', null)).toContain('Mode: Auto');
    expect(contextNote('plan', 'run #a1b2')).toContain('The user is looking at run #a1b2.');
    expect(contextNote('manual', null)).toContain('not looking at anything');
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
