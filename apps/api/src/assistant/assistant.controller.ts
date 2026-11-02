import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  CreateAssistantAttachmentDto,
  CreateAssistantSessionDto,
  DecideApprovalDto,
  DecidePlanDto,
  RequestAssistantAttachmentUploadDto,
  StartAssistantTurnDto,
  UpdateAssistantSessionDto,
  UpdateAssistantSettingsDto,
} from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssistantService } from './assistant.service';
import { AttachmentService } from './attachments/attachment.service';
import { Owner } from '../common/owner.decorator';

@Controller()
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly attachments: AttachmentService,
  ) {}

  @Post('assistant/attachments/upload')
  requestAttachmentUpload(
    @Owner() ownerId: string,
    @Body(new ZodValidationPipe(RequestAssistantAttachmentUploadDto))
    dto: RequestAssistantAttachmentUploadDto,
  ) {
    return this.attachments.requestUpload(ownerId, dto.ext);
  }

  @Post('assistant/attachments')
  createAttachment(
    @Owner() ownerId: string,
    @Body(new ZodValidationPipe(CreateAssistantAttachmentDto)) dto: CreateAssistantAttachmentDto,
  ) {
    return this.attachments.create(ownerId, dto);
  }

  @Get('assistant/attachments/:id')
  attachment(@Param('id') id: string) {
    return this.attachments.get(id);
  }

  @Delete('assistant/attachments/:id')
  @HttpCode(204)
  async deleteAttachment(@Owner() ownerId: string, @Param('id') id: string) {
    await this.attachments.deleteUnsent(ownerId, id);
  }

  @Get('assistant/providers')
  providers() {
    return this.assistant.listProviders();
  }

  @Get('assistant/settings')
  settings() {
    return this.assistant.getSettings();
  }

  @Put('assistant/settings')
  updateSettings(
    @Body(new ZodValidationPipe(UpdateAssistantSettingsDto)) dto: UpdateAssistantSettingsDto,
  ) {
    return this.assistant.updateSettings(dto);
  }

  @Delete('assistant/sessions/:sid/watches/:runId')
  unwatch(@Param('sid') sessionId: string, @Param('runId') runId: string) {
    return this.assistant.unwatch(sessionId, runId);
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
