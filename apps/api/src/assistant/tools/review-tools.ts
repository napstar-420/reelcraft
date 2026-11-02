import { z } from 'zod';
import { confirmChange } from './gate';
import { obj, str } from './json-schemas';
import {
  CAP,
  UNTRUSTED_TAIL,
  capped,
  clip,
  guard,
  shapeChecks,
  shapeQc,
  withNotice,
} from './run-tools';
import type { AssistantTool, ToolDeps, ToolOutcome, TurnContext } from './types';

const RUN_ID = str('A run id (from list_runs or the context).', { minLength: 1 });
const MAX_EVENTS = 40;

// ---- get_attempt -------------------------------------------------------------------------

const AttemptInput = z.object({
  runId: z.string().min(1),
  stageKey: z.string().min(1),
  attemptNo: z.number().int().min(1).optional(),
  itemIndex: z.number().int().min(0).optional(),
});

const getAttempt: AssistantTool<z.infer<typeof AttemptInput>> = {
  name: 'get_attempt',
  kind: 'read',
  description: `One try of a stage in full (the latest when attemptNo is omitted; itemIndex for an item of an iterating stage): the exact prompt that was sent, what it received (its resolved inputs), how it ended, every check and the QC verdict, the review note, cost, duration, and its event log (provider calls, retries, warnings). Use it when get_stage is not enough to say why a stage did what it did.${UNTRUSTED_TAIL}`,
  input: AttemptInput,
  jsonSchema: () =>
    obj(
      {
        runId: RUN_ID,
        stageKey: str('A stage key of that run.', { minLength: 1 }),
        attemptNo: { type: 'integer', minimum: 1, description: 'Which try; omit for the latest.' },
        itemIndex: {
          type: 'integer',
          minimum: 0,
          description: 'The item, for an iterating stage.',
        },
      },
      ['runId', 'stageKey'],
    ),
  async handler(_ctx, deps, input) {
    const all = (await deps.attempts.listStageAttempts(input.runId, input.stageKey)) as Array<{
      id: string;
      attemptNo: number;
      itemIndex: number | null;
    }>;
    const candidates = all.filter(
      (a) => input.itemIndex === undefined || a.itemIndex === input.itemIndex,
    );
    const chosen =
      input.attemptNo === undefined
        ? candidates.reduce<(typeof candidates)[number] | undefined>(
            (best, a) => (!best || a.attemptNo > best.attemptNo ? a : best),
            undefined,
          )
        : candidates.find((a) => a.attemptNo === input.attemptNo);
    if (!chosen) {
      return {
        ok: false,
        error: candidates.length
          ? `No attempt ${input.attemptNo}. Attempts: ${candidates.map((a) => a.attemptNo).join(', ')}.`
          : 'This stage has no attempts (yet).',
      };
    }
    const detail = await deps.attempts.stageAttemptDetail(input.runId, input.stageKey, chosen.id);
    const events = (await deps.attempts.listStageEvents(
      input.runId,
      input.stageKey,
      chosen.id,
    )) as Array<{
      level: string;
      type: string;
      message: string | null;
      data: unknown;
      createdAt: string;
    }>;
    return {
      ok: true,
      result: guard(
        withNotice({
          stageKey: input.stageKey,
          attemptNo: detail.attemptNo,
          ...(detail.itemIndex !== null && { itemIndex: detail.itemIndex }),
          outcome: detail.outcome,
          actor: detail.actor,
          costUsd: detail.costUsd,
          durationMs: detail.durationMs,
          at: detail.createdAt,
          prompt: clip(detail.renderedPrompt, CAP.fullOutput),
          received: capped(detail.resolvedInputs, CAP.data),
          note: clip(detail.reviewNote, CAP.note),
          checks: shapeChecks(detail.checkResults),
          qc: shapeQc(detail.qcVerdict),
          output: detail.artifact
            ? {
                kind: detail.artifact.kind,
                note: 'Read it with get_stage, or look with view_media.',
              }
            : null,
          events: events.slice(-MAX_EVENTS).map((e) => ({
            at: e.createdAt,
            level: e.level,
            type: e.type,
            message: clip(e.message, CAP.checkMessage),
            ...(e.data !== null &&
              e.data !== undefined && { data: capped(e.data, CAP.checkDetails) }),
          })),
          eventsOmitted: Math.max(0, events.length - MAX_EVENTS),
        }),
        CAP.fullResult,
      ),
    };
  },
};

// ---- get_run_memory ----------------------------------------------------------------------

const MemoryInput = z.object({ runId: z.string().min(1), key: z.string().min(1).optional() });

const getRunMemory: AssistantTool<z.infer<typeof MemoryInput>> = {
  name: 'get_run_memory',
  kind: 'read',
  description: `What a run's stages saved to memory for later stages (memory keys from \`writes\`): each key's current value (iterating stages write key#0, key#1…), which stage wrote it, and the keys still to come. key: only that key (and its items). Use it to see what a stage really passed on.${UNTRUSTED_TAIL}`,
  input: MemoryInput,
  jsonSchema: () =>
    obj({ runId: RUN_ID, key: str('Only this memory key (and its items).') }, ['runId']),
  async handler(_ctx, deps, input) {
    const memory = (await deps.memory.listMemory(input.runId)) as {
      current: Record<
        string,
        {
          memKey: string;
          writtenBy: string;
          writtenItem: number | null;
          kind: string;
          data: unknown;
          version: number;
        }
      >;
      expected: Array<{ memKey: string; writtenBy: string }>;
    };
    const matches = (memKey: string) =>
      !input.key || memKey === input.key || memKey.startsWith(`${input.key}#`);
    const entries = Object.values(memory.current).filter((row) => matches(row.memKey));
    return {
      ok: true,
      result: guard(
        withNotice({
          values: entries.slice(0, 60).map((row) => ({
            key: row.memKey,
            writtenBy: row.writtenBy,
            ...(row.writtenItem !== null && { item: row.writtenItem }),
            kind: row.kind,
            version: row.version,
            value: capped(row.data, CAP.data),
          })),
          valuesOmitted: Math.max(0, entries.length - 60),
          stillToCome: memory.expected.filter((e) => matches(e.memKey)),
        }),
        CAP.fullResult,
      ),
    };
  },
};

// ---- listening (the listen tool) ---------------------------------------------------------

/** Transcript, loudness and silences of a stored audio or video file. Asks before paying for
 * Deepgram in Manual mode; refuses in Plan mode. */
export async function listenTo(
  ctx: TurnContext,
  deps: ToolDeps,
  blobId: string,
  what: string,
): Promise<ToolOutcome> {
  const transcriber = await deps.review.transcriber();
  if (!transcriber.available) return { ok: false, error: transcriber.reason };
  if (transcriber.paid) {
    if (ctx.mode === 'plan') {
      return {
        ok: false,
        error:
          'Plan mode: transcribing costs a little (Deepgram, VoiceStudio is not running). Put it in your plan instead.',
      };
    }
    const refused = await confirmChange(ctx, {
      tool: 'listen',
      kind: 'action',
      title: `Transcribe ${what} with Deepgram`,
      details: ['VoiceStudio is not running, so Deepgram transcribes it (about $0.005 a minute)'],
    });
    if (refused) return refused;
  }
  const heard = await deps.review.listen(blobId, transcriber.by);
  if (!heard) return { ok: false, error: 'The file could not be read.' };
  return {
    ok: true,
    result: guard(
      withNotice({
        heard: what,
        transcribedBy: heard.by,
        costUsd: heard.costUsd,
        durationSec: heard.durationSec,
        loudness: { meanDb: heard.stats.meanVolumeDb, peakDb: heard.stats.maxVolumeDb },
        silences: heard.stats.silences.slice(0, 30),
        lines: heard.lines.slice(0, 300),
        ...(heard.transcript.trim() ? {} : { note: 'No speech was heard (music or silence).' }),
      }),
      CAP.fullResult,
    ),
  };
}

export const REVIEW_TOOLS: AssistantTool<never>[] = [
  getAttempt,
  getRunMemory,
] as unknown as AssistantTool<never>[];
