import { describe, expect, it, vi } from 'vitest';
import { runTool } from './registry';
import { newTurnContext, type ApprovalRequest, type ToolDeps } from './types';

function deps(over: Record<string, unknown> = {}): ToolDeps {
  return {
    attempts: {
      listStageAttempts: vi.fn(async () => [
        { id: 'a1', attemptNo: 1, itemIndex: null },
        { id: 'a2', attemptNo: 2, itemIndex: null },
      ]),
      stageAttemptDetail: vi.fn(async () => ({
        attemptNo: 2,
        itemIndex: null,
        outcome: 'check_failed',
        actor: 'model',
        costUsd: 0.01,
        durationMs: 900,
        createdAt: 'now',
        renderedPrompt: 'Write about otters',
        resolvedInputs: { topic: 'otters', apiKey: 'sk-secret' },
        reviewNote: null,
        checkResults: [{ name: 'word_count', pass: false, message: 'too long', fault: 'artifact' }],
        qcVerdict: null,
        artifact: { kind: 'text' },
      })),
      listStageEvents: vi.fn(async () => [
        {
          level: 'info',
          type: 'provider.call',
          message: 'called fake',
          data: null,
          createdAt: 'now',
        },
      ]),
    },
    memory: {
      listMemory: vi.fn(async () => ({
        current: {
          'scenes#0': {
            memKey: 'scenes#0',
            writtenBy: 'plan',
            writtenItem: 0,
            kind: 'data',
            data: { a: 1 },
            version: 1,
          },
          title: {
            memKey: 'title',
            writtenBy: 'script',
            writtenItem: null,
            kind: 'text',
            data: 'Otters',
            version: 2,
          },
        },
        expected: [{ memKey: 'scenes_done', writtenBy: 'images' }],
      })),
    },
    runs: {
      media: vi.fn(async () => ({
        found: true,
        stageKey: 'voice',
        targets: [
          {
            itemIndex: null,
            artifactId: 'art',
            kind: 'media.audio',
            blobId: 'b-voice',
            probe: null,
            clips: [],
          },
        ],
      })),
    },
    runControl: { get: vi.fn(async () => ({ finalVideo: { blobId: 'b-final' } })) },
    review: {
      transcriber: vi.fn(async () => ({ available: true, by: 'voicestudio', paid: false })),
      listen: vi.fn(async () => ({
        by: 'voicestudio',
        costUsd: 0,
        durationSec: 12,
        transcript: 'Otters hold hands.',
        lines: [{ atSec: 0.2, text: 'Otters hold hands.' }],
        stats: { meanVolumeDb: -20, maxVolumeDb: -1, silences: [{ startSec: 8, endSec: 12 }] },
      })),
      contactSheet: vi.fn(async () => ({
        mime: 'image/jpeg',
        base64: 'S',
        times: [1, 2],
        columns: 2,
        durationSec: 3,
      })),
    },
    assets: { get: vi.fn(async () => ({ kind: 'media.image', blobId: 'b-logo', name: 'Logo' })) },
    characters: { get: vi.fn(async () => ({ name: 'Host', referenceSet: [{ blobId: 'b-ref' }] })) },
    media: {
      imageFromBlob: vi.fn(async (_b: string, label: string) => ({
        mime: 'image/jpeg',
        base64: 'I',
        label,
      })),
    },
    ...over,
  } as unknown as ToolDeps;
}

describe('get_attempt', () => {
  it('reads the latest try in full, with the prompt, inputs (redacted), checks and events', async () => {
    const d = deps();
    const out = await runTool(
      'get_attempt',
      { runId: 'r1', stageKey: 'script' },
      newTurnContext(),
      d,
    );
    expect(d.attempts.stageAttemptDetail).toHaveBeenCalledWith('r1', 'script', 'a2');
    expect(out).toMatchObject({
      ok: true,
      result: {
        attemptNo: 2,
        prompt: 'Write about otters',
        checks: { failed: [{ name: 'word_count', fault: 'artifact' }] },
        events: [{ type: 'provider.call' }],
      },
    });
    expect(JSON.stringify(out)).not.toContain('sk-secret');
    expect(
      await runTool(
        'get_attempt',
        { runId: 'r1', stageKey: 'script', attemptNo: 9 },
        newTurnContext(),
        d,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('1, 2') });
  });
});

describe('get_run_memory', () => {
  it('lists values by key with their items, and what is still to come', async () => {
    const out = await runTool(
      'get_run_memory',
      { runId: 'r1', key: 'scenes' },
      newTurnContext(),
      deps(),
    );
    expect(out).toMatchObject({
      ok: true,
      result: { values: [{ key: 'scenes#0', writtenBy: 'plan', item: 0 }], stillToCome: [] },
    });
  });
});

describe('listen', () => {
  it('transcribes a stage for free with VoiceStudio, without asking', async () => {
    const confirm = vi.fn();
    const d = deps();
    const out = await runTool(
      'listen',
      { source: { runId: 'r1', stageKey: 'voice' } },
      newTurnContext({ mode: 'manual', confirm }),
      d,
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(d.review.listen).toHaveBeenCalledWith('b-voice', 'voicestudio');
    expect(out).toMatchObject({
      ok: true,
      result: {
        transcribedBy: 'voicestudio',
        loudness: { meanDb: -20 },
        silences: [{ startSec: 8 }],
      },
    });
  });

  it('asks before a paid Deepgram transcription, refuses it in Plan mode, and listens to the final video', async () => {
    const paid = deps();
    (paid.review.transcriber as ReturnType<typeof vi.fn>).mockResolvedValue({
      available: true,
      by: 'deepgram',
      paid: true,
    });
    const asked: ApprovalRequest[] = [];
    await runTool(
      'listen',
      { source: { runId: 'r1' } },
      newTurnContext({ mode: 'manual', confirm: async (r) => (asked.push(r), { answer: 'yes' }) }),
      paid,
    );
    expect(asked[0]).toMatchObject({ kind: 'action', title: expect.stringContaining('Deepgram') });
    expect(paid.review.listen).toHaveBeenCalledWith('b-final', 'deepgram');
    expect(
      await runTool('listen', { source: { runId: 'r1' } }, newTurnContext({ mode: 'plan' }), paid),
    ).toMatchObject({ ok: false, error: expect.stringContaining('Plan mode') });
  });

  it('says why when nothing can transcribe', async () => {
    const d = deps();
    (d.review.transcriber as ReturnType<typeof vi.fn>).mockResolvedValue({
      available: false,
      reason: 'Start VoiceStudio.',
    });
    expect(await runTool('listen', { source: { runId: 'r1' } }, newTurnContext(), d)).toMatchObject(
      {
        ok: false,
        error: 'Start VoiceStudio.',
      },
    );
  });
});

describe('view_media (library sources)', () => {
  it('shows a library image and a Character reference, and refuses a blob that is not one', async () => {
    const d = deps();
    const c = newTurnContext();
    expect(await runTool('view_media', { source: { assetId: 'a1' } }, c, d)).toMatchObject({
      ok: true,
      images: [{ base64: 'I' }],
    });
    expect(d.media.imageFromBlob).toHaveBeenCalledWith('b-logo', 'the asset "Logo"');
    expect(
      await runTool('view_media', { source: { characterId: 'c1', blobId: 'b-ref' } }, c, d),
    ).toMatchObject({ ok: true });
    expect(
      await runTool('view_media', { source: { characterId: 'c1', blobId: 'b-other' } }, c, d),
    ).toMatchObject({ ok: false });
    expect(c.imagesShown).toBe(2);
  });
});
