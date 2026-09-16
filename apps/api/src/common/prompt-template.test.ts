import { describe, expect, it } from 'vitest';
import { parseTemplatePaths, renderPrompt } from './prompt-template';

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
