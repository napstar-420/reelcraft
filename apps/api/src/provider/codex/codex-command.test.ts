import { describe, expect, it } from 'vitest';
import { buildCodexArgs, buildCodexPrompt, toTomlValue } from './codex-command';

describe('Codex command construction', () => {
  it('pins model and effort while forwarding raw dotted config values', () => {
    const args = buildCodexArgs({
      modelId: 'gpt-example',
      reasoningEffort: 'high',
      jobDir: '/tmp/job',
      resultPath: '/tmp/job/result.txt',
      outputSchemaPath: '/tmp/job/schema.json',
      params: {
        reasoningEffort: 'high',
        personality: 'concise',
        'features.web_search': true,
        sandbox_mode: 'danger-full-access',
        model: 'must-not-win',
      },
    });

    expect(args).toContain('--model');
    expect(args).toContain('gpt-example');
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).toContain('personality="concise"');
    expect(args).toContain('features.web_search=true');
    expect(args).not.toContain('sandbox_mode="danger-full-access"');
    expect(args).not.toContain('model="must-not-win"');
    expect(args).toContain('--output-schema');
    expect(args).toContain('--skip-git-repo-check');
    expect(args.at(-1)).toBe('-');
  });

  it('serializes supported parameter values as TOML', () => {
    expect(toTomlValue('hello')).toBe('"hello"');
    expect(toTomlValue(true)).toBe('true');
    expect(toTomlValue(4)).toBe('4');
    expect(toTomlValue(['a', 2])).toBe('["a", 2]');
    expect(toTomlValue({ nested: 'value' })).toBe('{ nested = "value" }');
  });

  it('delimits system, user, and output requirements', () => {
    const prompt = buildCodexPrompt({
      system: 'Research carefully.',
      renderedPrompt: 'Find the answer.',
      output: { kind: 'data', schema: { type: 'object' }, schemaName: 'answer' },
    });

    expect(prompt).toContain('<system_instructions>\nResearch carefully.\n</system_instructions>');
    expect(prompt).toContain('<user_prompt>\nFind the answer.\n</user_prompt>');
    expect(prompt).toContain('Return only JSON matching the supplied output schema');
  });
});
