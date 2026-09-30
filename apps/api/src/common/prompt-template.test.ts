import { describe, expect, it } from 'vitest';
import { parseTemplatePaths, renderPrompt, renderStagePrompt } from './prompt-template';

describe('renderPrompt', () => {
  it('renders a bare name', () => {
    expect(renderPrompt('Topic: {{ topic }}.', { topic: 'reefs' })).toBe('Topic: reefs.');
  });

  it('renders a dotted field path', () => {
    expect(renderPrompt('{{ outline.title }}', { outline: { title: 'Coral' } })).toBe('Coral');
  });

  it('renders a nested list index then a field', () => {
    const scope = { outline: { beats: [{ text: 'first beat' }] } };
    expect(renderPrompt('{{ outline.beats[0].text }}', scope)).toBe('first beat');
  });

  it('interpolates objects and arrays as pretty-printed JSON', () => {
    const scope = { outline: { title: 'Coral', beats: ['a', 'b'] } };
    expect(renderPrompt('{{ outline }}', scope)).toBe(JSON.stringify(scope.outline, null, 2));
  });

  it('renders numbers and booleans as their string form', () => {
    expect(renderPrompt('{{ n }} {{ b }}', { n: 3, b: true })).toBe('3 true');
  });

  it('renders an unresolved path as empty string', () => {
    expect(renderPrompt('[{{ missing.path }}]', {})).toBe('[]');
  });

  it('renders multiple placeholders in one template', () => {
    expect(renderPrompt('{{ a }}-{{ b }}', { a: '1', b: '2' })).toBe('1-2');
  });
});

describe('parseTemplatePaths', () => {
  it('returns each distinct path once, in first-seen order', () => {
    const template =
      'Title: {{ outline.title }}. Beat: {{ outline.beats[0] }}. Again: {{ outline.title }}.';
    expect(parseTemplatePaths(template)).toEqual(['outline.title', 'outline.beats[0]']);
  });

  it('returns an empty array for a template with no placeholders', () => {
    expect(parseTemplatePaths('no placeholders here')).toEqual([]);
  });
});

describe('renderStagePrompt', () => {
  it('leaves legacy prompts unchanged when output instructions are absent or render empty', () => {
    const task = 'Write about {{ topic }}.\nKeep this line.';
    const scope = { topic: 'reefs' };
    expect(renderStagePrompt(task, undefined, scope, 'text')).toBe(
      'Write about reefs.\nKeep this line.',
    );
    expect(renderStagePrompt(task, '  {{ missing }}  ', scope, 'text')).toBe(
      'Write about reefs.\nKeep this line.',
    );
  });

  it('renders task and text instructions independently with the same scope', () => {
    const result = renderStagePrompt(
      'Task: {{ topic }}',
      'Use {{ outline.beats[0] }}.\n{{ priorCritique }}',
      {
        topic: 'oceans',
        outline: { beats: ['a strong opening'] },
        priorCritique: 'Avoid jargon.',
      },
      'text',
    );

    expect(result).toBe(`Task: oceans

<output_contract>
Produce only the requested stage output.
Follow the stage-specific output instructions exactly.
Do not add commentary, labels, or formatting unless requested.

<stage_output_instructions>
Use a strong opening.
Avoid jargon.
</stage_output_instructions>
</output_contract>`);
  });

  it('adds the schema authority rule only for data output and preserves instruction lines', () => {
    const result = renderStagePrompt(undefined, 'Line one\n\nLine three', {}, 'data');
    expect(result).toBe(`<output_contract>
Produce only the requested stage output.
Follow the stage-specific output instructions exactly.
Do not add commentary, labels, or formatting unless requested.
For data output, the provider's JSON Schema is authoritative.

<stage_output_instructions>
Line one

Line three
</stage_output_instructions>
</output_contract>`);
  });

  it('uses exactly one blank line before the contract when the task ends in newlines', () => {
    const result = renderStagePrompt('Task line.\n\n', 'Be concise.', {}, 'text');
    expect(result).toContain('Task line.\n\n<output_contract>');
    expect(result).not.toContain('Task line.\n\n\n<output_contract>');
  });

  it('injects prior critique automatically between the task and the contract', () => {
    const result = renderStagePrompt(
      'Write about {{ topic }}.',
      'Be concise.',
      { topic: 'reefs', priorCritique: 'Attempt 1 was rejected by QC: too long.' },
      'text',
    );
    expect(result).toMatch(
      /^Write about reefs\.\n\n<previous_attempt_feedback>\n[^\n]+\n\nAttempt 1 was rejected by QC: too long\.\n<\/previous_attempt_feedback>\n\n<output_contract>/,
    );
  });

  it('injects prior critique even with no output instructions, and nothing on a first attempt', () => {
    expect(renderStagePrompt('Task.', undefined, { priorCritique: 'Fix X.' }, 'text')).toContain(
      '<previous_attempt_feedback>',
    );
    expect(renderStagePrompt('Task.', undefined, { priorCritique: '' }, 'text')).toBe('Task.');
  });

  it('does not inject a second copy when the author placed {{ priorCritique }} themselves', () => {
    const result = renderStagePrompt(
      'Task. Feedback: {{ priorCritique }}',
      undefined,
      { priorCritique: 'Fix X.' },
      'text',
    );
    expect(result).toBe('Task. Feedback: Fix X.');
  });

  it('lists attached files in order and adds the error contract only when asked', () => {
    const result = renderStagePrompt('Caption the shoe.', undefined, {}, 'text', {
      errorReply: true,
      attachments: [
        { name: 'shoe', kind: 'media.image' },
        { name: 'hero[1]', kind: 'media.image' },
      ],
    });
    expect(result).toContain(
      '<attached_files>\nThe following files are attached to this message, in order:\n1. shoe (media.image)\n2. hero[1] (media.image)\n</attached_files>',
    );
    expect(result).toContain('{"reelcraft_error":{"code":"<code>","message":"<message>"}}');
    expect(result!.startsWith('<error_reporting>')).toBe(true);
    expect(result!.indexOf('Caption the shoe.')).toBeLessThan(result!.indexOf('<attached_files>'));
    expect(renderStagePrompt('Task.', undefined, {}, 'text', { attachments: [] })).toBe('Task.');
  });

  it('uses the status envelope wording for data output', () => {
    const result = renderStagePrompt('Task.', undefined, {}, 'data', { errorReply: true });
    expect(result).toContain('set "status" to "ok"');
    expect(result).not.toContain('reelcraft_error');
  });
});
