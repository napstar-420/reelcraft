import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreateAssistantSessionDto,
  DecideApprovalDto,
  DecidePlanDto,
  StartAssistantTurnDto,
  UpdateAssistantSessionDto,
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

  @Get('assistant/sessions')
  list() {
    return this.assistant.listSessions();
  }

  @Post('assistant/sessions')
  create(@Body(new ZodValidationPipe(CreateAssistantSessionDto)) dto: CreateAssistantSessionDto) {
    return this.assistant.createSession(dto);
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

  @Post('assistant/sessions/:sid/approvals/:itemId')
  decideApproval(
    @Param('sid') sessionId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(DecideApprovalDto)) dto: DecideApprovalDto,
  ) {
    return this.assistant.decideApproval(sessionId, itemId, dto);
  }

  @Post('assistant/sessions/:sid/plans/:itemId')
  @HttpCode(202)
  decidePlan(
    @Param('sid') sessionId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(DecidePlanDto)) dto: DecidePlanDto,
  ) {
    return this.assistant.decidePlan(sessionId, itemId, dto);
  }

  @Post('assistant/sessions/:sid/changes/:itemId/undo')
  undo(@Param('sid') sessionId: string, @Param('itemId') itemId: string) {
    return this.assistant.undoChange(sessionId, itemId);
  }
}
