import { describe, expect, it } from 'vitest';
import type { CliRunnerManifest } from '../cli-job/cli-dialect';
import { buildClaudeArgs, claudeDialect } from './claude-command';

const base: CliRunnerManifest = {
  cli: 'claude',
  modelId: 'sonnet',
  reasoningEffort: 'medium',
  jobDir: '/jobs/abc',
  resultPath: '/jobs/abc/result.txt',
  modality: 'text',
  timeoutMs: 1000,
  browserMaxSteps: 10,
  params: {},
  prompt: 'hi',
};

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

describe('buildClaudeArgs', () => {
  it('locks a plain text job down: no tools, settings, MCP servers or session', () => {
    const args = buildClaudeArgs(base);
    expect(args.slice(0, 4)).toEqual(['-p', '--output-format', 'stream-json', '--verbose']);
    expect(flag(args, '--model')).toBe('sonnet');
    expect(flag(args, '--effort')).toBe('medium');
    expect(flag(args, '--tools')).toBe('');
    expect(flag(args, '--setting-sources')).toBe('');
    expect(flag(args, '--permission-mode')).toBe('dontAsk');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--no-session-persistence');
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--mcp-config');
  });

  it('lets a judge read files and run only ffmpeg and ffprobe', () => {
    const args = buildClaudeArgs({ ...base, params: { __inspectFiles: true } });
    expect(flag(args, '--tools')).toBe('Read,Glob,Bash');
    expect(flag(args, '--allowedTools')).toBe('Read,Glob,Bash(ffmpeg *),Bash(ffprobe *)');
  });

  it('lets a code job edit its files and run only the commands it names', () => {
    const args = buildClaudeArgs({
      ...base,
      modality: 'code',
      params: { __allowedCommands: ['node preview.mjs'] },
    });
    expect(flag(args, '--tools')).toBe('Read,Write,Edit,Glob,Grep,Bash');
    expect(flag(args, '--allowedTools')).toBe('Read,Write,Edit,Glob,Grep,Bash(node preview.mjs *)');
    expect(args).not.toContain('--mcp-config');
    const noCommands = buildClaudeArgs({ ...base, modality: 'code' });
    expect(flag(noCommands, '--tools')).toBe('Read,Write,Edit,Glob,Grep');
  });

  it('gives a text job that comes with a working folder the same file tools and commands', () => {
    const args = buildClaudeArgs({ ...base, params: { __allowedCommands: ['node check.mjs'] } });
    expect(flag(args, '--tools')).toBe('Read,Write,Edit,Glob,Grep,Bash');
    expect(flag(args, '--allowedTools')).toBe('Read,Write,Edit,Glob,Grep,Bash(node check.mjs *)');
    expect(args).not.toContain('--mcp-config');
    expect(flag(buildClaudeArgs(base), '--tools')).toBe('');
  });

  it('gives a browser job file tools and only the Neo server it was handed', () => {
    const mcpServers = { 'browseros-neo': { type: 'http', url: 'http://127.0.0.1:9010/mcp' } };
    const args = buildClaudeArgs({ ...base, modality: 'browser', mcpServers });
    expect(flag(args, '--allowedTools')).toContain('mcp__browseros-neo');
    expect(JSON.parse(flag(args, '--mcp-config')!)).toEqual({ mcpServers });
    expect(args).toContain('--strict-mcp-config');
  });

  it('sends the schema, keeps retained sessions and resumes a thread', () => {
    const schema = '{"type":"object"}';
    expect(flag(buildClaudeArgs(base, schema), '--json-schema')).toBe(schema);
    expect(buildClaudeArgs({ ...base, retained: true })).not.toContain('--no-session-persistence');
    const resumed = buildClaudeArgs({ ...base, threadId: '12345678-1234-1234-1234-123456789abc' });
    expect(flag(resumed, '--resume')).toBe('12345678-1234-1234-1234-123456789abc');
    expect(resumed).not.toContain('--no-session-persistence');
  });
});

describe('claudeDialect', () => {
  const result = claudeDialect.result!;

  it('reads the session id from the init event', () => {
    expect(claudeDialect.sessionId({ type: 'system', subtype: 'init', session_id: 'abc' })).toBe(
      'abc',
    );
    expect(claudeDialect.sessionId({ type: 'assistant', session_id: 'abc' })).toBeUndefined();
  });

  it('counts each Neo tool call in an assistant message', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'mcp__browseros-neo__run' },
          { type: 'tool_use', name: 'mcp__browseros-neo__snapshot' },
          { type: 'tool_use', name: 'Read' },
          { type: 'text', text: 'browseros-neo' },
        ],
      },
    };
    expect(claudeDialect.browserSteps('', event)).toBe(2);
    expect(claudeDialect.browserSteps('browseros-neo tool_call', undefined)).toBe(0);
  });

  it('stores structured output when a schema was sent, else the text', () => {
    const event = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '{"name":"Ada"}',
      structured_output: { name: 'Ada' },
    };
    expect(result(event, { ...base, outputSchemaPath: '/jobs/abc/schema.json' })).toEqual({
      text: '{"name":"Ada"}',
    });
    expect(result({ ...event, result: 'Hello' }, base)).toEqual({ text: 'Hello' });
    expect(result({ type: 'assistant' }, base)).toBeUndefined();
  });

  it('reports an error result', () => {
    expect(
      result({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' }, base),
    ).toEqual({ error: 'Not logged in' });
    expect(
      result({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: [] }, base),
    ).toEqual({ error: 'Claude stopped (error_max_turns)' });
  });

  it('falls back to stderr, then to the exit code', () => {
    expect(claudeDialect.failureReason('{bad', 'boom', 'Claude exited with 1')).toBe('boom');
    expect(claudeDialect.failureReason('', '', 'Claude exited with 1')).toBe(
      'Claude exited with 1',
    );
  });
});
