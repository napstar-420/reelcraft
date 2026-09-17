import { Body, Controller, Get, Param, Post, Sse, UsePipes } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { CreateRunDto, RaiseBudgetDto } from '@reefcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InProcessRunEvents, type RunEvent } from '../orchestration/run-events';
import { RunService } from './run.service';

@Controller('runs')
export class RunController {
  constructor(
    private readonly runs: RunService,
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
