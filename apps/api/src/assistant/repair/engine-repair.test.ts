import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RepairPayload } from '@reelcraft/shared';
import { runTool } from '../tools/registry';
import { newTurnContext, type ToolDeps } from '../tools/types';
import { EngineRepairService, hookEnv, wakeText } from './engine-repair.service';
import { buildClaudeArgs } from '../../provider/claude/claude-command';
import { checkReport, REPAIR_COMMANDS, repairPrompt } from './repair-prompt';
import { AssistantWatchService } from '../watch/assistant-watch.service';

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

describe('repair wake delivery', () => {
  it('wakes the chat only when the claim returns a message, after boot recovery', async () => {
    const watches = new AssistantWatchService({} as never, {} as never, {} as never);
    const woken = vi.fn(async () => undefined);
    watches.setWakeHandler(woken);
    const claim = vi.fn(async () => 'repair applied');
    watches.wakeSession('chat', async () => null); // reported already
    watches.wakeSession('chat', claim);
    await Promise.resolve();
    expect(claim).not.toHaveBeenCalled(); // waits for the boot recovery
    watches.start();
    await watches.idle();
    await watches.idle();
    expect(woken).toHaveBeenCalledTimes(1);
    expect(woken).toHaveBeenCalledWith('chat', 'repair applied');
  });
});

describe('repair check report', () => {
  const hook = [
    '\u001b[31m FAIL \u001b[39m src/provider/codex/codex-device-page.test.ts > enters the code',
    'x'.repeat(5_000),
    '\u001b[2m Test Files \u001b[22m 4 failed | 187 passed (191)',
    ' ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @reelcraft/api test',
    'husky - pre-commit script failed (code 1)',
  ].join('\n');

  it('drops colour codes and puts what failed first, then the end of the output', () => {
    const report = checkReport(hook, 1_000);
    expect(report).not.toContain('\u001b[');
    expect(report.split('\n').slice(0, 3)).toEqual([
      'FAIL  src/provider/codex/codex-device-page.test.ts > enters the code',
      'Test Files  4 failed | 187 passed (191)',
      'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @reelcraft/api test',
    ]);
    expect(report.trimEnd().endsWith('husky - pre-commit script failed (code 1)')).toBe(true);
    expect(report.length).toBeLessThan(1_100);
  });

  it('hands a retry the report and tells the agent to run the whole suites', () => {
    const first = repairPrompt({ repair: payload, stage: null });
    expect(first).toContain('pnpm test (not only the tests you touched');
    expect(first).not.toContain('<check_output>');
    const retry = repairPrompt({ repair: payload, stage: null, checkFailure: 'FAIL  a.test.ts' });
    expect(retry).toContain('<check_output>\nFAIL  a.test.ts\n</check_output>');
    expect(retry).toContain('git diff HEAD');
  });
});

describe('repair check retries', () => {
  /** A service whose phases are stubbed: the checks fail with each of `failures` in turn. */
  async function drive(failures: string[]) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'repair-'));
    const service = new EngineRepairService(
      ...([{}, {}, {}, {}, {}, { workspaceRoot }] as unknown as ConstructorParameters<
        typeof EngineRepairService
      >),
    );
    type Stub = { payload: RepairPayload; state: string };
    let repair: Stub = { payload: { ...payload, phase: 'fixing' }, state: 'working' };
    const prompts: (number | undefined)[] = [];
    Object.assign(service, {
      load: async () => ({ id: 'r1', sessionId: 's', ...repair }),
      earlierRepair: async () => null,
      update: async (r: Stub, patch: Partial<RepairPayload>, state?: string) => {
        repair = { payload: { ...r.payload, ...patch }, state: state ?? r.state };
        return { id: 'r1', sessionId: 's', ...repair };
      },
      fixPhase: async (r: Stub) => {
        prompts.push(r.payload.checkRetries);
        return { ...r, payload: { ...r.payload, phase: 'verifying' } };
      },
      commit: async (r: Stub) => ({ repair: r, failure: failures.shift() }),
      publish: async () => ({ prUrl: 'https://github.com/o/r/pull/1' }),
      applyLive: async () => false,
      removeWorktree: async () => undefined,
      report: async () => undefined,
    });
    await (service as unknown as { drive(id: string): Promise<void> }).drive('r1');
    return { repair, prompts, workspaceRoot };
  }

  it('hands the failed checks back to the agent once, then carries on', async () => {
    const { repair, prompts, workspaceRoot } = await drive([
      '\u001b[31m FAIL \u001b[39m a.test.ts',
    ]);
    expect(prompts).toEqual([undefined, 1]);
    expect(repair.state).toBe('pr_only');
    const report = await readFile(
      join(workspaceRoot, 'repairs/r1/job/retry-1/check-failure.txt'),
      'utf8',
    );
    expect(report.startsWith('FAIL  a.test.ts')).toBe(true);
  });

  it('fails with the report when the retry fails the checks too', async () => {
    const { repair, prompts } = await drive(['FAIL  a.test.ts', 'FAIL  b.test.ts']);
    expect(prompts).toEqual([undefined, 1]);
    expect(repair.state).toBe('failed');
    expect(repair.payload.error).toMatch(/after 1 retry[\s\S]*FAIL {2}b\.test\.ts/);
  });
});

describe('repair hook environment', () => {
  it('is the environment the API started with, without git repository variables', () => {
    process.env.PREVIEW_TOKEN_TTL_SEC_PROBE = '600'; // as ConfigModule writes defaults later
    try {
      const env = hookEnv();
      expect(env).not.toHaveProperty('PREVIEW_TOKEN_TTL_SEC_PROBE');
      expect(env.PATH).toBe(process.env.PATH);
      expect(hookEnv({ GIT_DIR: '/x', HOME: '/h' })).toEqual({ HOME: '/h' });
    } finally {
      delete process.env.PREVIEW_TOKEN_TTL_SEC_PROBE;
    }
  });
});
