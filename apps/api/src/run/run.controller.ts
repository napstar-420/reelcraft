import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Sse,
  UsePipes,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import {
  CreateRunDto,
  RaiseBudgetDto,
  RequestInputUploadDto,
  ConfirmRunActionDto,
  ApprovalActionDto,
  HumanInputSubmissionDto,
  PatchRunOverridesDto,
  ManualArtifactEditDto,
  PutRunInputDto,
  SaveTimelineDraftDto,
  SubmitTimelineDraftDto,
} from '@reefcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InProcessRunEvents, type RunEvent } from '../orchestration/run-events';
import { RunService } from './run.service';
import { RunInputService } from './run-input.service';
import { RunActionService } from './run-action.service';
import { InvalidationService } from './invalidation.service';
import { HumanActionService } from './human-action.service';
import { RunCancellationService } from './run-cancellation.service';
import { ArtifactEditService } from './artifact-edit.service';
import { TimelineEditorService } from './timeline-editor.service';

@Controller('runs')
export class RunController {
  constructor(
    private readonly runs: RunService,
    private readonly runInputs: RunInputService,
    private readonly events: InProcessRunEvents,
    private readonly actions: RunActionService,
    private readonly invalidation: InvalidationService,
    private readonly humanActions: HumanActionService,
    private readonly cancellation: RunCancellationService,
    private readonly artifactEdits: ArtifactEditService,
    private readonly timelineEditor: TimelineEditorService,
  ) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateRunDto))
  create(@Body() dto: CreateRunDto) {
    return this.runs.create(dto);
  }

  @Get()
  list(@Query('includeDryRuns') includeDryRuns?: string) {
    return this.runs.list(includeDryRuns === 'true');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.runs.get(id);
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.runs.start(id);
  }

  @Post(':id/inputs/:key/upload')
  requestInputUpload(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(RequestInputUploadDto)) dto: RequestInputUploadDto,
  ) {
    return this.runInputs.requestMediaUpload(id, key, dto.ext);
  }

  @Put(':id/inputs/:key')
  attachInput(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(PutRunInputDto)) dto: PutRunInputDto,
  ) {
    return this.runInputs.putInput(id, key, dto);
  }

  @Post(':id/budget')
  @UsePipes(new ZodValidationPipe(RaiseBudgetDto))
  raiseBudget(@Param('id') id: string, @Body() dto: RaiseBudgetDto) {
    return this.runs.raiseBudget(id, dto.capUsd);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.runs.resume(id);
  }

  @Get(':id/memory')
  memory(@Param('id') id: string) {
    return this.invalidation.listMemory(id);
  }

  @Get(':id/invalidation-preview')
  invalidationPreview(
    @Param('id') id: string,
    @Query('stageKey') stageKey: string,
    @Query('itemIndex') itemIndex?: string,
  ) {
    if (!stageKey) throw new BadRequestException('stageKey is required');
    return this.actions.previewInvalidation(id, stageKey, this.parseItemIndexQuery(itemIndex));
  }

  @Post(':id/stages/:key/retry')
  retryPreview(
    @Param('id') id: string,
    @Param('key') key: string,
    @Query('itemIndex') itemIndex?: string,
  ) {
    return this.actions.previewStageRetry(id, key, this.parseItemIndexQuery(itemIndex));
  }

  @Get(':id/stages/:key/attempts')
  stageAttempts(@Param('id') id: string, @Param('key') key: string) {
    return this.runs.listStageAttempts(id, key);
  }

  @Post(':id/stages/:key/retry/confirm')
  retryConfirm(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(ConfirmRunActionDto)) dto: ConfirmRunActionDto,
  ) {
    return this.actions.confirmStageRetry(id, key, dto.previewToken, dto.itemIndex);
  }

  /** Shared by `invalidationPreview`/`retryPreview` — both accept an
   * optional `?itemIndex=` query param scoping the preview/retry to one
   * item of an iterating stage (phase 7 MEDIUM finding #3, PR #17 review).
   * Server-side resolution against the DB (in `RunActionService`) is what
   * actually validates the index; this only validates the query string's
   * shape. */
  private parseItemIndexQuery(itemIndex?: string): number | undefined {
    if (itemIndex === undefined) return undefined;
    if (!Number.isInteger(Number(itemIndex)) || Number(itemIndex) < 0) {
      throw new BadRequestException('itemIndex must be a non-negative integer');
    }
    return Number(itemIndex);
  }

  @Post(':id/stages/:key/approve')
  approval(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(ApprovalActionDto)) dto: ApprovalActionDto,
  ) {
    return dto.action === 'approve'
      ? this.humanActions.approve(id, key, dto.itemIndex)
      : this.humanActions.reject(id, key, dto.note, dto.previewToken, dto.itemIndex);
  }

  @Post(':id/stages/:key/input')
  submitHumanInput(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(HumanInputSubmissionDto)) dto: HumanInputSubmissionDto,
  ) {
    return this.humanActions.submitInput(id, key, dto.value);
  }

  @Get(':id/stages/:key/timeline-editor')
  timelineEditorSession(@Param('id') id: string, @Param('key') key: string) {
    return this.timelineEditor.session(id, key);
  }

  @Put(':id/stages/:key/timeline-editor/draft')
  saveTimelineDraft(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(SaveTimelineDraftDto)) dto: SaveTimelineDraftDto,
  ) {
    return this.timelineEditor.save(id, key, dto);
  }

  @Post(':id/stages/:key/timeline-editor/submit')
  submitTimelineDraft(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(SubmitTimelineDraftDto)) dto: SubmitTimelineDraftDto,
  ) {
    return this.timelineEditor.submit(id, key, dto.draftRevision);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.cancellation.cancel(id);
  }

  @Patch(':id/overrides')
  patchOverrides(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchRunOverridesDto)) dto: PatchRunOverridesDto,
  ) {
    return this.actions.patchOverrides(id, dto.overrides, dto.previewToken);
  }

  @Post(':id/stages/:key/artifact')
  editArtifact(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(ManualArtifactEditDto)) dto: ManualArtifactEditDto,
  ) {
    return this.artifactEdits.edit(id, key, {
      value: dto.value,
      ...(dto.sourceArtifactId !== undefined && { sourceArtifactId: dto.sourceArtifactId }),
      ...(dto.previewToken !== undefined && { previewToken: dto.previewToken }),
    });
  }

  /** REQ-2.8.4 — the UI is a view over Run state, not the driver of it. */
  @Sse(':id/events')
  stream(@Param('id') id: string): Observable<{ data: RunEvent }> {
    return this.events.stream(id).pipe(map((event) => ({ data: event })));
  }
}
