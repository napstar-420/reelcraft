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
});
