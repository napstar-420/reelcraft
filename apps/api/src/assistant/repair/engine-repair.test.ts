import { describe, expect, it, vi } from 'vitest';
import type { RepairPayload } from '@reelcraft/shared';
import { runTool } from '../tools/registry';
import { newTurnContext, type ToolDeps } from '../tools/types';
import { wakeText } from './engine-repair.service';
import { buildClaudeArgs } from '../../provider/claude/claude-command';
import { REPAIR_COMMANDS } from './repair-prompt';

const payload: RepairPayload = {
  runId: '01JRUN0000000000000000ABCD',
  stageKey: 'compose',
  diagnosis: 'compose crashes on a null probe in timeline-compose.ts',
  agent: 'claude',
  model: 'opus',
  phase: 'preparing',
  branch: 'fix/repair-compose-abc',
  baseSha: 'deadbeef',
};
const input = { runId: payload.runId, stageKey: 'compose', diagnosis: payload.diagnosis };

function deps(refusal: string | null) {
  return {
    repairs: { refusal: vi.fn(async () => refusal), plan: vi.fn(async () => payload) },
  } as unknown as ToolDeps & {
    repairs: { refusal: ReturnType<typeof vi.fn>; plan: ReturnType<typeof vi.fn> };
  };
}

describe('repair_engine', () => {
  it('refuses with the reason and plans nothing', async () => {
    const d = deps('Engine repair is turned off.');
    const out = await runTool('repair_engine', input, newTurnContext(), d);
    expect(out).toEqual({ ok: false, error: 'Engine repair is turned off.' });
    expect(d.repairs.plan).not.toHaveBeenCalled();
  });

  it('asks first, then returns the repair item for the chat to start', async () => {
    const d = deps(null);
    const confirm = vi.fn(async () => ({ answer: 'yes' as const }));
    const out = await runTool('repair_engine', input, newTurnContext({ confirm }), d);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: 'repair_engine' }));
    expect(out).toMatchObject({ ok: true, item: { type: 'repair', payload } });
  });

  it('does nothing when the user says no', async () => {
    const d = deps(null);
    const confirm = vi.fn(async () => ({ answer: 'no' as const }));
    const out = await runTool('repair_engine', input, newTurnContext({ confirm }), d);
    expect(out.ok).toBe(false);
    expect(d.repairs.plan).not.toHaveBeenCalled();
  });

  it('is refused in Plan mode', async () => {
    const out = await runTool('repair_engine', input, newTurnContext({ mode: 'plan' }), deps(null));
    expect(out.ok).toBe(false);
  });
});

describe('repair wake text', () => {
  it('asks for a retry once applied, with the pull request', () => {
    const text = wakeText({
      state: 'applied',
      payload: { ...payload, summary: 'Guarded the probe.', prUrl: 'https://x/pr/1' },
    });
    expect(text).toContain('retry_stage');
    expect(text).toContain('https://x/pr/1');
    expect(text).toContain(payload.runId);
  });

  it('says not to retry unchanged when it failed', () => {
    const text = wakeText({ state: 'failed', payload: { ...payload, error: 'hook failed' } });
    expect(text).toContain('hook failed');
    expect(text).toContain('do not retry the stage unchanged');
  });
});

describe('repair agent tools', () => {
  it('Claude may edit files and run only the repair commands', () => {
    const args = buildClaudeArgs({
      cli: 'claude',
      modelId: 'opus',
      reasoningEffort: 'high',
      jobDir: '/j',
      cwd: '/w',
      resultPath: '/j/result.json',
      modality: 'code',
      timeoutMs: 1,
      browserMaxSteps: 0,
      params: { __allowedCommands: REPAIR_COMMANDS },
      prompt: '',
    });
    const allowed = args[args.indexOf('--allowedTools') + 1]!;
    expect(allowed).toContain('Edit');
    expect(allowed).toContain('Bash(pnpm *)');
    expect(allowed).toContain('Bash(git diff *)');
    expect(allowed).not.toMatch(/Bash\(git \*\)|git push|git commit/);
  });
});
