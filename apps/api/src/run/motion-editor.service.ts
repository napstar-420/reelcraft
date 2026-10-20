import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  StageDef,
  type MotionCheckResultDto,
  type MotionPreviewDto,
  type MotionSource,
} from '@reelcraft/shared';
import { TimelineResourceResolverService } from '../artifact/timeline-resource-resolver.service';
import { checkMotionCode } from '../capability/motion/motion-code-check';
import { motionRenderSpec } from '../capability/impls/motion-render.capability';
import { ulid } from '../common/ulid';
import { EngineConfig } from '../config/engine-config';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blueprintVersion, run } from '../db/schema/index';
import { ComputeJobService, type ComputeHandle } from '../storage/compute-job.service';

/** How long a preview render may take. */
const PREVIEW_MAX_WAIT_SEC = 300;
/** How many previews are kept at once; the oldest goes first. */
const MAX_PREVIEWS = 50;

type Preview = { runId: string; stageKey: string; handle: ComputeHandle };

/**
 * Checks and previews a motion graphic while a person edits its code. Saving goes through the manual
 * artifact edit, like any other edited output. Previews live in memory: they are a convenience, and
 * one lost to a restart reads as expired and is simply rendered again.
 */
@Injectable()
export class MotionEditorService {
  private readonly logger = new Logger(MotionEditorService.name);
  private readonly previews = new Map<string, Preview>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly compute: ComputeJobService,
    private readonly resources: TimelineResourceResolverService,
    private readonly config: EngineConfig,
  ) {}

  async check(runId: string, stageKey: string, code: string): Promise<MotionCheckResultDto> {
    await this.motionStage(runId, stageKey);
    return { issues: checkMotionCode(code) };
  }

  async startPreview(
    runId: string,
    stageKey: string,
    source: MotionSource,
  ): Promise<MotionPreviewDto> {
    await this.motionStage(runId, stageKey);
    const id = `motion-preview-${ulid().toLowerCase()}`;
    const issues = checkMotionCode(source.code);
    if (issues.length) return { id, state: 'invalid', issues };
    const handles = (source.assets ?? []).map((asset) => asset.handle);
    const resolved = handles.length ? await this.resources.resolveHandles(runId, handles) : {};
    const spec = motionRenderSpec({
      source,
      resources: resolved,
      maxWaitSec: PREVIEW_MAX_WAIT_SEC,
      browserExecutable: this.config.remotionBrowserExecutable,
      stills: true,
    });
    const handle = await this.compute.spawn(id, spec);
    this.previews.set(id, { runId, stageKey, handle });
    while (this.previews.size > MAX_PREVIEWS) {
      const [oldest] = this.previews.keys();
      if (oldest) await this.forget(oldest);
    }
    this.logger.log({ runId, stageKey, previewId: id }, 'motion preview started');
    return { id, state: 'rendering' };
  }

  async preview(runId: string, stageKey: string, id: string): Promise<MotionPreviewDto> {
    const preview = this.previews.get(id);
    if (!preview || preview.runId !== runId || preview.stageKey !== stageKey) {
      return { id, state: 'expired' };
    }
    const status = await this.compute.poll(preview.handle);
    if (!status.done) return { id, state: 'rendering' };
    if (status.outcome !== 'succeeded') {
      await this.forget(id);
      return {
        id,
        state: 'failed',
        error: status.reason ?? 'The preview could not be rendered.',
      };
    }
    const folder = await this.compute.collect(preview.handle);
    const files = (await readdir(folder))
      .filter((name) => /^frame-\d+\.png$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const stills = await Promise.all(
      files.map(
        async (name) =>
          `data:image/png;base64,${(await readFile(path.join(folder, name))).toString('base64')}`,
      ),
    );
    await this.forget(id);
    return { id, state: 'done', stills };
  }

  private async forget(id: string): Promise<void> {
    this.previews.delete(id);
    await this.compute.cleanup(id).catch(() => undefined);
  }

  /** The stage, which must be a Generate Motion Graphic stage of this run. */
  private async motionStage(runId: string, stageKey: string): Promise<StageDef> {
    const [row] = await this.db
      .select({ graph: blueprintVersion.graph })
      .from(run)
      .innerJoin(blueprintVersion, eq(run.blueprintVersionId, blueprintVersion.id))
      .where(eq(run.id, runId))
      .limit(1);
    if (!row) throw new NotFoundException(`Run ${runId} not found`);
    const stage = StageDef.array()
      .parse(row.graph)
      .find((candidate) => candidate.key === stageKey);
    if (!stage || stage.capability !== 'motion.generate') {
      throw new NotFoundException(`Stage ${stageKey} is not a motion graphic stage of this run`);
    }
    return stage;
  }
}
