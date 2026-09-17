import { Body, Controller, Get, Param, Post, Put, Sse, UsePipes } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import {
  AttachInputDto,
  CreateRunDto,
  RaiseBudgetDto,
  RequestInputUploadDto,
} from '@reefcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InProcessRunEvents, type RunEvent } from '../orchestration/run-events';
import { RunService } from './run.service';
import { RunInputService } from './run-input.service';

@Controller('runs')
export class RunController {
  constructor(
    private readonly runs: RunService,
    private readonly runInputs: RunInputService,
    private readonly events: InProcessRunEvents,
  ) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateRunDto))
  create(@Body() dto: CreateRunDto) {
    return this.runs.create(dto);
  }

  @Get()
  list() {
    return this.runs.list();
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
    @Body(new ZodValidationPipe(AttachInputDto)) dto: AttachInputDto,
  ) {
    return this.runInputs.attachMediaInput(id, key, dto.blobs);
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

  /** REQ-2.8.4 — the UI is a view over Run state, not the driver of it. */
  @Sse(':id/events')
  stream(@Param('id') id: string): Observable<{ data: RunEvent }> {
    return this.events.stream(id).pipe(map((event) => ({ data: event })));
  }
}
