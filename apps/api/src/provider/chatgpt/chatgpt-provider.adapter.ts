import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JobHandle, JobStatus, Modality } from '@reelcraft/shared';
import type {
  CancelResult,
  ModelInfo,
  ProviderAdapter,
  ProviderAttachment,
  ProviderRequest,
  ProviderResult,
} from '../provider-adapter.interface';
import { STORAGE_ADAPTER, type StorageAdapter } from '../../storage/storage.adapter';
import { loadReferenceFiles, type ReferenceFile } from '../reference-files';
import { buildChatgptPrompt } from './chatgpt-prompt';
import {
  EFFORT_STOPS,
  archiveChatScript,
  attachFilesScript,
  chatUrl,
  closePageScript,
  copyLastReplyScript,
  openChatScript,
  pageStateScript,
  parkImageScript,
  readParkedImageScript,
  RUN_RESULT_BUDGET,
  sendPromptScript,
  setEffortScript,
  signInStateScript,
  stageUploadChunkScript,
  stopGeneratingScript,
  UPLOAD_CHUNK,
  stripCitations,
  enableWebSearchScript,
  type ArchiveResult,
  type ChatgptEffort,
  type PageState,
  type SignInState,
} from './chatgpt-page';
import { NeoClient } from './neo-client';

export const CHATGPT_SIGN_IN_MESSAGE =
  "You're not signed in to ChatGPT. Open chatgpt.com in BrowserOS Neo, sign in, then re-run this stage.";
const NEO_UNAVAILABLE_MESSAGE =
  'BrowserOS Neo is unavailable; start BrowserOS Neo and check its cockpit';

export const CHATGPT_MODEL_ID = 'chatgpt';
const EFFORTS = Object.keys(EFFORT_STOPS) as ChatgptEffort[];
const MAX_REFERENCES = 5;
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
/** High effort + web search took ~2.5 min in the spike, and a long structured
 * answer with sources ~9 min; leave generous room. A job still generating at
 * this point is cancelled and retried, so it only has to be longer than any
 * real reply. */
const JOB_DEADLINE_MS = 45 * 60_000;
/** A tab showing no Stop button, no reply and no error for this long has
 * stalled (it was closed, never sent, or ChatGPT fell over). */
const IDLE_STALL_MS = 4 * 60_000;
/** A finished image reply with no image yet may still be rendering it. */
const IMAGE_GRACE_MS = 30_000;
const READINESS_TTL_MS = 60_000;

type ChatgptModality = 'text' | 'image';

export type ChatgptJobPayload = {
  pageId: number;
  conversationUrl: string;
  modality: ChatgptModality;
  outputKind?: string | undefined;
  submittedAt: number;
  pastedPrompt: string;
  /** Image stages: how many images were asked for (above 1 for an image list). */
  imageCount?: number | undefined;
};

type Readiness = {
  modalities: Modality[];
  unavailable?: Partial<Record<Modality, string>>;
};

class ChatgptPageError extends Error {}

/**
 * Drives the user's own signed-in chatgpt.com in BrowserOS Neo — lets a
 * ChatGPT subscription serve text and image stages. The lifecycle maps onto
 * short Neo `run` calls: submit types and sends, poll inspects the tab, fetch
 * copies the reply / downloads images and closes the tab. The job lives in a
 * Neo tab, which outlives an API restart, so the handle is just its page id.
 */
@Injectable()
export class ChatgptProviderAdapter implements ProviderAdapter {
  readonly id = 'chatgpt';
  readonly modalities: readonly Modality[] = ['text', 'image'];
  private readonly logger = new Logger(ChatgptProviderAdapter.name);
  private readiness?: { expiresAt: number; value: Promise<Readiness> } | undefined;
  /** externalId → when an image reply first looked finished without an image. */
  private readonly imagelessSince = new Map<string, number>();
  /** externalId → when the tab first looked idle (nothing generating, no reply). */
  private readonly idleSince = new Map<string, number>();
  /**
   * externalId → in-flight/completed fetch(). `fetch()` closes the Neo tab
   * as a side effect, so a second call for the same handle (an Inngest step
   * retry after fetchAndFinalize's post-fetch DB/storage writes throw) must
   * not re-touch the now-closed page — it replays the first call's result.
   */
  private readonly fetchResults = new Map<string, Promise<ProviderResult>>();

  constructor(
    private readonly neo: NeoClient,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    const { modalities, unavailable } = await this.inspectReadiness();
    return [
      {
        modelId: CHATGPT_MODEL_ID,
        label: 'ChatGPT',
        modalities,
        ...(unavailable && { unavailableModalities: unavailable }),
        supportedReasoningEfforts: EFFORTS,
        defaultReasoningEffort: 'medium',
        capabilities: {
          supportsSeed: false,
          supportsIdempotency: false,
          inputKinds: ['media.image'],
          maxRefs: MAX_REFERENCES,
          image: { formats: ['png'], maxReferences: MAX_REFERENCES },
        },
      },
    ];
  }

  async estimate(_req: ProviderRequest) {
    return { expectedUsd: 0, ceilingUsd: 0, basis: 'configured_ceiling' as const };
  }

  async submit(req: ProviderRequest, idempotencyKey: string): Promise<JobHandle> {
    const modality = req.modality ?? 'text';
    if (modality !== 'text' && modality !== 'image') {
      throw new Error(`ChatGPT does not support modality "${modality}"`);
    }
    const effort = req.params.reasoningEffort;
    if (typeof effort !== 'string' || !EFFORTS.includes(effort as ChatgptEffort)) {
      throw new Error(
        `Unsupported ChatGPT effort "${String(effort)}"; use one of ${EFFORTS.join(', ')}`,
      );
    }
    // Loaded for both modalities: an image-generation stage attaches source
    // images to steer the result, and a text-modality QC judge attaches the
    // artifact under review so a vision-capable judge can actually see it
    // (§10.3 — "Image: the image, to a vision model").
    const references = await loadReferenceFiles(this.storage, req.params.slots, {
      max: MAX_REFERENCES,
      maxBytes: MAX_REFERENCE_BYTES,
      label: 'ChatGPT',
    });
    const imageCount =
      modality === 'image' && typeof req.params.count === 'number' && req.params.count > 1
        ? req.params.count
        : undefined;
    const pastedPrompt = buildChatgptPrompt({
      system: req.system,
      renderedPrompt: req.renderedPrompt,
      output: req.output,
      imageCount,
    });
    if (!pastedPrompt.trim()) throw new Error('ChatGPT stage rendered an empty prompt');

    const webSearch = req.params.webSearch === true;
    const pageId = await this.neo.run<number>(
      openChatScript(chatUrl({ temporary: modality === 'text' })),
    );
    try {
      const signIn = await this.neo.run<SignInState>(signInStateScript(pageId));
      if (!signIn.signedIn) {
        // Not thrown: a throw is retried (and opens a tab each time). The
        // first poll reports it as a no-retry `user_action` failure instead.
        this.forgetReadiness();
        await this.close(pageId);
        return { providerId: this.id, externalId: idempotencyKey, payload: { signedOut: true } };
      }
      if (!signIn.composer) throw new ChatgptPageError('ChatGPT composer not found');

      const sent = await this.exclusive(async () => {
        const set = this.pageResult(
          await this.neo.run<{ value?: number; error?: string }>(
            setEffortScript(pageId, effort as ChatgptEffort),
          ),
        );
        if (set.value !== EFFORT_STOPS[effort as ChatgptEffort]) {
          throw new ChatgptPageError(`Could not set ChatGPT effort to "${effort}"`);
        }
        if (webSearch && !(await this.neo.run<boolean>(enableWebSearchScript(pageId)))) {
          throw new ChatgptPageError('Could not turn on ChatGPT web search');
        }
        if (references.length > 0) await this.uploadReferences(pageId, references);
        return this.pageResult(
          await this.neo.run<{ url?: string; error?: string }>(
            sendPromptScript(pageId, pastedPrompt, webSearch),
          ),
        );
      });
      const payload: ChatgptJobPayload = {
        pageId,
        conversationUrl: sent.url ?? '',
        modality,
        outputKind: req.output?.kind,
        submittedAt: Date.now(),
        pastedPrompt,
        ...(imageCount && { imageCount }),
      };
      this.logger.log(
        { providerId: this.id, pageId, modality, effort, webSearch },
        'chatgpt prompt sent',
      );
      return { providerId: this.id, externalId: idempotencyKey, payload };
    } catch (error) {
      await this.closeJob(pageId, modality);
      if (error instanceof ChatgptPageError) {
        throw new Error(`${error.message} — the ChatGPT UI may have changed`);
      }
      throw error;
    }
  }

  async poll(handle: JobHandle): Promise<JobStatus> {
    const job = this.job(handle);
    if (!job) return signedOutFailure();
    let state: PageState;
    try {
      state = await this.neo.run<PageState>(pageStateScript(job.pageId));
    } catch (error) {
      this.logger.warn({ err: error, pageId: job.pageId }, 'chatgpt tab unreadable');
      return {
        done: true,
        outcome: 'failed',
        reason: `The ChatGPT tab could not be read (it may have been closed): ${(error as Error).message}`,
        retryable: true,
        failureClass: 'infrastructure',
      };
    }
    const status = decidePoll(state, job, this.imagelessSince.get(handle.externalId), Date.now());
    if (status === 'imageless') {
      this.imagelessSince.set(handle.externalId, Date.now());
      return running(job);
    }
    if (!status.done) {
      if (!isIdle(state)) {
        this.idleSince.delete(handle.externalId);
        return status;
      }
      const since = this.idleSince.get(handle.externalId) ?? Date.now();
      this.idleSince.set(handle.externalId, since);
      if (Date.now() - since < IDLE_STALL_MS) return status;
      this.idleSince.delete(handle.externalId);
      this.logger.warn({ pageId: job.pageId, tail: state.tail.slice(-200) }, 'chatgpt tab stalled');
      await this.closeJob(job.pageId, job.modality);
      return {
        done: true,
        outcome: 'failed',
        reason: 'ChatGPT stopped without replying',
        retryable: true,
        failureClass: 'infrastructure',
      };
    }
    this.imagelessSince.delete(handle.externalId);
    this.idleSince.delete(handle.externalId);
    if (status.outcome === 'succeeded') return status;
    if (status.failureClass === 'user_action') this.forgetReadiness();
    // Surface what ChatGPT said (e.g. an image refusal) instead of a generic reason.
    const reply =
      state.replyDone && status.failureClass !== 'user_action'
        ? await this.copyReply(job.pageId).catch(() => undefined)
        : undefined;
    await this.closeJob(job.pageId, job.modality);
    return reply ? { ...status, reason: `${status.reason}: ${reply.slice(0, 500)}` } : status;
  }

  async fetch(handle: JobHandle): Promise<ProviderResult> {
    const cached = this.fetchResults.get(handle.externalId);
    if (cached) return cached;
    const promise = this.doFetch(handle);
    this.fetchResults.set(handle.externalId, promise);
    promise.catch(() => this.fetchResults.delete(handle.externalId));
    return promise;
  }

  private async doFetch(handle: JobHandle): Promise<ProviderResult> {
    const job = this.job(handle);
    if (!job) throw new Error(CHATGPT_SIGN_IN_MESSAGE);
    try {
      const rawResponse = { conversationUrl: job.conversationUrl, pastedPrompt: job.pastedPrompt };
      const repro = { level: 'none' as const, providerVersion: 'chatgpt-web' };
      if (job.modality === 'image') {
        const downloaded = await this.downloadImages(job.pageId);
        if (job.imageCount) {
          // An image list: every image in the reply, up to the number asked for.
          if (downloaded.length === 0)
            throw new Error('ChatGPT reply contained no generated image');
          return {
            output: {
              images: downloaded.slice(0, job.imageCount).map((image, index) => ({
                kind: 'media.image',
                base64: image.base64,
                mime: image.mime,
                filename: `chatgpt-image-${index + 1}${imageExtension(image.mime)}`,
              })),
            },
            costUsd: 0,
            repro,
            rawResponse,
          };
        }
        const [first, ...rest] = downloaded;
        if (!first) throw new Error('ChatGPT reply contained no generated image');
        const attachments: ProviderAttachment[] = rest.map((image, index) => ({
          role: 'download',
          base64: image.base64,
          mime: image.mime,
          filename: `chatgpt-image-${index + 2}${imageExtension(image.mime)}`,
        }));
        return {
          output: {
            kind: 'media.image',
            base64: first.base64,
            mime: first.mime,
            filename: `chatgpt-image-1${imageExtension(first.mime)}`,
          },
          ...(attachments.length > 0 && { attachments }),
          costUsd: 0,
          repro,
          rawResponse,
        };
      }
      const reply = await this.copyReply(job.pageId);
      if (reply === undefined) throw new Error('Could not copy the ChatGPT reply');
      const output =
        job.outputKind === 'data' || job.outputKind === 'timeline' ? parseJsonReply(reply) : reply;
      return { output, costUsd: 0, repro, rawResponse };
    } finally {
      await this.closeJob(job.pageId, job.modality);
    }
  }

  async cancel(handle: JobHandle): Promise<CancelResult> {
    const job = this.job(handle);
    if (!job) return { confirmed: true, billed: false };
    try {
      await this.neo.run(stopGeneratingScript(job.pageId));
    } catch (error) {
      this.logger.warn({ err: error, pageId: job.pageId }, 'chatgpt stop failed');
    }
    await this.closeJob(job.pageId, job.modality);
    return { confirmed: true, billed: false };
  }

  private async copyReply(pageId: number): Promise<string | undefined> {
    const copied = await this.neo.run<string | null>(copyLastReplyScript(pageId));
    return copied === null ? undefined : stripCitations(copied);
  }

  /** Files go to the page in `UPLOAD_CHUNK` slices (Neo caps a request at
   * 4 MB), then are attached together from there. */
  private async uploadReferences(pageId: number, references: ReferenceFile[]): Promise<void> {
    for (const [index, file] of references.entries()) {
      for (let from = 0; from === 0 || from < file.base64.length; from += UPLOAD_CHUNK) {
        const chunk = file.base64.slice(from, from + UPLOAD_CHUNK);
        this.pageResult(
          await this.neo.run<{ error?: string }>(
            stageUploadChunkScript(pageId, index, from, chunk),
          ),
        );
      }
    }
    this.pageResult(
      await this.neo.run<{ error?: string }>(
        attachFilesScript(
          pageId,
          references.map(({ name, mime, base64 }) => ({ name, mime, length: base64.length })),
        ),
      ),
    );
  }

  private async downloadImages(pageId: number): Promise<Array<{ mime: string; base64: string }>> {
    const images: Array<{ mime: string; base64: string }> = [];
    for (let index = 0; ; index++) {
      const parked = await this.neo.run<{ mime: string; length: number } | null>(
        parkImageScript(pageId, index),
      );
      if (!parked) return images;
      let base64 = '';
      for (let from = 0; from < parked.length; from += RUN_RESULT_BUDGET) {
        const to = Math.min(from + RUN_RESULT_BUDGET, parked.length);
        base64 += await this.neo.run<string>(readParkedImageScript(pageId, from, to));
      }
      if (base64.length !== parked.length) throw new Error('ChatGPT image download was incomplete');
      images.push({ mime: parked.mime, base64 });
    }
  }

  private inspectReadiness(): Promise<Readiness> {
    if (this.readiness && this.readiness.expiresAt > Date.now()) return this.readiness.value;
    const value = this.probeReadiness();
    this.readiness = { expiresAt: Date.now() + READINESS_TTL_MS, value };
    return value;
  }

  /** Forgets the cached readiness, e.g. after the Neo address changed. */
  forgetReadiness(): void {
    this.readiness = undefined;
  }

  private async probeReadiness(): Promise<Readiness> {
    let pageId: number;
    try {
      pageId = await this.neo.run<number>(openChatScript(chatUrl({ temporary: true })));
    } catch (error) {
      this.logger.warn({ err: error }, 'chatgpt readiness: neo unreachable');
      return unavailable(NEO_UNAVAILABLE_MESSAGE);
    }
    try {
      const { signedIn } = await this.neo.run<SignInState>(signInStateScript(pageId));
      return signedIn ? { modalities: ['text', 'image'] } : unavailable(CHATGPT_SIGN_IN_MESSAGE);
    } catch (error) {
      // Unknown is not "signed out": don't block stages on a flaky probe.
      this.logger.warn({ err: error }, 'chatgpt readiness probe failed');
      return { modalities: ['text', 'image'] };
    } finally {
      await this.close(pageId);
    }
  }

  private pageResult<T extends { error?: string | undefined }>(result: T): T {
    if (result?.error) throw new ChatgptPageError(result.error);
    return result;
  }

  private job(handle: JobHandle): ChatgptJobPayload | undefined {
    const payload = handle.payload as
      (Partial<ChatgptJobPayload> & { signedOut?: boolean }) | undefined;
    if (payload?.signedOut) return undefined;
    if (typeof payload?.pageId !== 'number') throw new Error('Invalid ChatGPT job handle');
    return payload as ChatgptJobPayload;
  }

  /**
   * Image chats can't be temporary, so they would pile up in the user's
   * history: archive one before its tab closes. Best-effort, like `close`.
   */
  private async closeJob(pageId: number, modality: ChatgptModality): Promise<void> {
    if (modality === 'image') {
      try {
        const result = await this.neo.run<ArchiveResult>(archiveChatScript(pageId));
        if (!result.archived && result.reason !== 'no conversation') {
          this.logger.warn({ pageId, reason: result.reason }, 'chatgpt chat archive failed');
        }
      } catch (error) {
        this.logger.warn({ err: error, pageId }, 'chatgpt chat archive failed');
      }
    }
    await this.close(pageId);
  }

  /** The effort slider is account-wide and is read when a prompt is sent, so
   * tabs of items that run side by side take turns from "set effort" to
   * "sent"; everything else about a job stays in its own tab.
   * ponytail: per-process queue; a second API process would need its own lock. */
  private sendTurn: Promise<unknown> = Promise.resolve();
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const turn = this.sendTurn.then(work);
    this.sendTurn = turn.catch(() => undefined);
    return turn;
  }

  private async close(pageId: number): Promise<void> {
    try {
      await this.neo.run(closePageScript(pageId));
    } catch (error) {
      this.logger.warn({ err: error, pageId }, 'chatgpt tab close failed');
    }
  }
}

function unavailable(reason: string): Readiness {
  return { modalities: [], unavailable: { text: reason, image: reason } };
}

function running(job: Pick<ChatgptJobPayload, 'submittedAt'>): JobStatus {
  return { done: false, phase: 'running', deadlineMs: job.submittedAt + JOB_DEADLINE_MS };
}

function signedOutFailure(): JobStatus {
  return {
    done: true,
    outcome: 'failed',
    reason: CHATGPT_SIGN_IN_MESSAGE,
    retryable: false,
    failureClass: 'user_action',
  };
}

/** Nothing is generating and nothing has come of it: no reply, image or error. */
export function isIdle(state: PageState): boolean {
  return (
    !state.generating &&
    !state.replyDone &&
    !state.errorShown &&
    !state.imagesLoading &&
    state.images === 0
  );
}

/**
 * Pure read of one tab snapshot. Returns `'imageless'` when an image reply
 * looks finished but has no image yet — the caller starts a grace timer,
 * since the Stop button disappears before the image finishes rendering.
 */
export function decidePoll(
  state: PageState,
  job: Pick<ChatgptJobPayload, 'modality' | 'submittedAt'>,
  imagelessSince: number | undefined,
  now: number,
): JobStatus | 'imageless' {
  if (!state.signedIn) return signedOutFailure();
  // An error banner wins over everything: a failed message can leave a stale
  // Stop button or an earlier Copy button behind, and would otherwise wait out
  // the whole deadline.
  if (state.errorShown) {
    return {
      done: true,
      outcome: 'failed',
      reason: `ChatGPT reported an error${state.errorSignal ? ` (${state.errorSignal})` : ''}: ${state.tail.trim().slice(-300)}`,
      retryable: true,
      failureClass: 'provider',
    };
  }
  if (state.generating) return running(job);
  if (job.modality === 'image') {
    if (state.images > 0) return { done: true, outcome: 'succeeded' };
    if (state.imagesLoading) return running(job);
  } else if (state.replyDone) {
    return { done: true, outcome: 'succeeded' };
  }
  if (job.modality === 'image' && state.replyDone) {
    if (imagelessSince === undefined) return 'imageless';
    if (now - imagelessSince >= IMAGE_GRACE_MS) {
      return {
        done: true,
        outcome: 'failed',
        reason: 'ChatGPT did not produce an image',
        retryable: false,
        failureClass: 'provider',
      };
    }
  }
  return running(job);
}

export function parseJsonReply(reply: string): unknown {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(reply.trim());
  try {
    return JSON.parse(fenced?.[1] ?? reply);
  } catch {
    throw new Error(`ChatGPT reply was not valid JSON: ${reply.slice(0, 200)}`);
  }
}

function imageExtension(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  return '.png';
}
