import type { RepairPayload } from '@reelcraft/shared';
import type { StageInsight } from '../../run/run-insight.service';

/** The commands the coding agent may run (Claude: `Bash(<command> *)`; Codex: its sandbox). It
 * reads git but never commits, pushes or switches branches: Reelcraft does that. */
export const REPAIR_COMMANDS = ['pnpm', 'git diff', 'git status', 'git log', 'git show', 'ls'];

/** The agent's answer. Strict (every field required, nothing else) so Codex can enforce it. */
export const REPAIR_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['engineBug', 'summary', 'commitMessage', 'testFiles'],
  properties: {
    engineBug: {
      type: 'boolean',
      description: 'false when the failure is not a bug in Reelcraft code; then change nothing.',
    },
    summary: {
      type: 'string',
      description:
        'For the user: what was wrong and what you changed (or why it is not an engine bug).',
    },
    commitMessage: {
      type: 'string',
      description:
        'A conventional commit: a subject such as "fix(api): ..." under 72 characters, a blank line, a short body.',
    },
    testFiles: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface RepairResult {
  engineBug: boolean;
  summary: string;
  commitMessage: string;
  testFiles: string[];
}

const STAGE_CHARS = 12_000;

/** What the coding agent is asked to do. */
export function repairPrompt(input: { repair: RepairPayload; stage: StageInsight | null }): string {
  const { repair, stage } = input;
  const stageJson = stage ? JSON.stringify(stage, null, 2) : '(the stage could not be read)';
  return `You are fixing a bug in Reelcraft's own code (its engine). The current folder is a git worktree of the Reelcraft repository, on branch ${repair.branch}. Dependencies are installed and packages/shared is built.

A video run failed at a stage, and Reelcraft's assistant, which watches runs, believes the failure is the engine's fault: not the blueprint's settings, a prompt, a model's output, a provider outage or the user's setup.

## The failure

Run ${repair.runId}, stage "${repair.stageKey}".

The assistant's diagnosis:
${repair.diagnosis}

The stage as it failed (settings, attempts, errors, outputs):
${stageJson.length > STAGE_CHARS ? `${stageJson.slice(0, STAGE_CHARS)}\n… (cut)` : stageJson}

## What to do

1. Read CLAUDE.md, and the docs it points to for the area you touch: they are the project's rules. Then find the root cause in the code. Fix it once where every caller routes through, not only on this stage's path. Keep the change as small as the fix needs; don't refactor around it.
2. If you find it is not an engine bug after all, change nothing and answer engineBug=false, saying what the real cause is so the assistant can fix it.
3. Add a regression test beside the code (*.test.ts) that fails without your fix.
4. Run the tests you touched (pnpm --filter @reelcraft/api test -- <file>, or @reelcraft/shared) and pnpm typecheck; for apps/web or apps/render-worker also pnpm --filter <that package> typecheck. Run pnpm exec prettier --write and pnpm exec eslint --fix on the files you changed.
5. Do not commit, push or switch branches: Reelcraft commits your change itself (the pre-commit hook runs lint, the typechecks and the unit suites, and the commit fails if they do) and opens the pull request. Do not touch the database, Docker, .env files or anything outside this folder, and do not add dependencies.
6. Answer with the JSON the output schema asks for: engineBug, summary, commitMessage, testFiles.`;
}

/** The pull request's description. */
export function repairReport(repair: RepairPayload, commitBody: string): string {
  return [
    commitBody,
    '## Engine repair',
    `Made by Reelcraft's engine repair (${repair.agent}, ${repair.model}) for stage \`${repair.stageKey}\` of run \`${repair.runId}\`.`,
    `**What the assistant found:** ${repair.diagnosis}`,
    repair.summary ? `**What the coding agent changed:** ${repair.summary}` : '',
    repair.testFiles?.length
      ? `**Regression tests:** ${repair.testFiles.map((f) => `\`${f}\``).join(', ')}`
      : '',
    'The pre-commit checks passed. Reelcraft applies the fix to the checkout that found the bug when it applies cleanly there.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
