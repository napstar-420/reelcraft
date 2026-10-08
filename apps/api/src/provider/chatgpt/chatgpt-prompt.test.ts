import { describe, expect, it } from 'vitest';
import { buildChatgptPrompt } from './chatgpt-prompt';

const schema = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
} as const;

describe('buildChatgptPrompt', () => {
  it('pastes the rendered prompt verbatim when there is no system prompt or schema', () => {
    const renderedPrompt = 'Write a hook.\n\n<output_contract>\nBe brief.\n</output_contract>';
    expect(buildChatgptPrompt({ renderedPrompt, output: { kind: 'text', instructions: '' } })).toBe(
      renderedPrompt,
    );
  });

  it('orders system prompt, request, then output schema', () => {
    const prompt = buildChatgptPrompt({
      system: 'You are a  <careful> editor.\n',
      renderedPrompt: 'Task\n<output_contract>json please</output_contract>',
      output: { kind: 'data', schema: schema as never, instructions: '' },
    });
    const system = prompt.indexOf(
      '<system_prompt>\nYou are a  <careful> editor.\n\n</system_prompt>',
    );
    const request = prompt.indexOf(
      '<request>\nTask\n<output_contract>json please</output_contract>\n</request>',
    );
    const output = prompt.indexOf('<required_output_structure>');
    expect(system).toBeGreaterThan(0);
    expect(request).toBeGreaterThan(system);
    expect(output).toBeGreaterThan(request);
    expect(prompt).toContain(JSON.stringify(schema, null, 2));
  });

  it('omits a blank system prompt and adds the timeline schema for timeline output', () => {
    const prompt = buildChatgptPrompt({
      system: '  ',
      renderedPrompt: 'Cut it',
      output: { kind: 'timeline' },
    });
    expect(prompt).not.toContain('<system_prompt>');
    expect(prompt.startsWith('<request>\nCut it\n</request>')).toBe(true);
    expect(prompt).toContain('"timingHandle"');
  });

  it('wraps the request with only a system prompt and no schema for text output', () => {
    const prompt = buildChatgptPrompt({ system: 'Be terse', renderedPrompt: 'Hi' });
    expect(prompt).toContain('<system_prompt>\nBe terse\n</system_prompt>');
    expect(prompt.endsWith('<request>\nHi\n</request>')).toBe(true);
  });
});
