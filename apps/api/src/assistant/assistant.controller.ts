import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Sse } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import {
  CreateAssistantSessionDto,
  StartAssistantTurnDto,
  UpdateAssistantSessionDto,
  type AssistantStreamEvent,
} from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssistantService } from './assistant.service';

@Controller()
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('assistant/providers')
  providers() {
    return this.assistant.listProviders();
  }

  @Get('blueprints/:id/assistant/sessions')
  list(@Param('id') blueprintId: string) {
    return this.assistant.listSessions(blueprintId);
  }

  @Post('blueprints/:id/assistant/sessions')
  create(
    @Param('id') blueprintId: string,
    @Body(new ZodValidationPipe(CreateAssistantSessionDto)) dto: CreateAssistantSessionDto,
  ) {
    return this.assistant.createSession(blueprintId, dto);
  }

  @Get('assistant/sessions/:sid')
  get(@Param('sid') sessionId: string) {
    return this.assistant.getSession(sessionId);
  }

  @Patch('assistant/sessions/:sid')
  update(
    @Param('sid') sessionId: string,
    @Body(new ZodValidationPipe(UpdateAssistantSessionDto)) dto: UpdateAssistantSessionDto,
  ) {
    return this.assistant.updateSession(sessionId, dto);
  }

  @Delete('assistant/sessions/:sid')
  @HttpCode(204)
  async remove(@Param('sid') sessionId: string) {
    await this.assistant.deleteSession(sessionId);
  }

  @Post('assistant/sessions/:sid/turns')
  @HttpCode(202)
  startTurn(
    @Param('sid') sessionId: string,
    @Body(new ZodValidationPipe(StartAssistantTurnDto)) dto: StartAssistantTurnDto,
  ) {
    return this.assistant.startTurn(sessionId, dto);
  }

  @Post('assistant/sessions/:sid/interrupt')
  @HttpCode(202)
  async interrupt(@Param('sid') sessionId: string) {
    await this.assistant.interrupt(sessionId);
  }

  @Post('assistant/sessions/:sid/proposals/:itemId/apply')
  apply(@Param('sid') sessionId: string, @Param('itemId') itemId: string) {
    return this.assistant.applyProposal(sessionId, itemId);
  }

  @Sse('assistant/sessions/:sid/events')
  events(@Param('sid') sessionId: string): Observable<{ data: AssistantStreamEvent }> {
    return this.assistant.streamEvents(sessionId).pipe(map((data) => ({ data })));
  }
}
