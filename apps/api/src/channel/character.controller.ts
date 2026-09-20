import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ConfirmCharacterReferenceDto,
  CreateCharacterDto,
  PromoteCharacterReferenceDto,
  RequestCharacterReferenceUploadDto,
  SetPrimaryCharacterReferenceDto,
  UpdateCharacterDto,
  UpdateCharacterReferenceDto,
} from '@reefcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CharacterService } from './character.service';

@Controller()
export class CharacterController {
  constructor(private readonly characters: CharacterService) {}
  @Get('channels/:channelId/characters') list(@Param('channelId') channelId: string) {
    return this.characters.list(channelId);
  }
  @Post('channels/:channelId/characters') create(
    @Param('channelId') channelId: string,
    @Body(new ZodValidationPipe(CreateCharacterDto)) dto: CreateCharacterDto,
  ) {
    return this.characters.create(channelId, dto);
  }
  @Get('characters/:id') get(@Param('id') id: string) {
    return this.characters.get(id);
  }
  @Patch('characters/:id') update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCharacterDto)) dto: UpdateCharacterDto,
  ) {
    return this.characters.update(id, dto);
  }
  @Post('characters/:id/references/upload') upload(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RequestCharacterReferenceUploadDto))
    dto: RequestCharacterReferenceUploadDto,
  ) {
    return this.characters.requestReferenceUpload(id, dto.ext);
  }
  @Post('characters/:id/references') confirm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConfirmCharacterReferenceDto)) dto: ConfirmCharacterReferenceDto,
  ) {
    return this.characters.confirmReference(id, dto);
  }
  @Patch('characters/:id/references/:blobId') patchRef(
    @Param('id') id: string,
    @Param('blobId') blobId: string,
    @Body(new ZodValidationPipe(UpdateCharacterReferenceDto)) dto: UpdateCharacterReferenceDto,
  ) {
    return this.characters.updateReference(id, blobId, dto);
  }
  @Delete('characters/:id/references/:blobId') remove(
    @Param('id') id: string,
    @Param('blobId') blobId: string,
  ) {
    return this.characters.deleteReference(id, blobId);
  }
  @Put('characters/:id/primary-reference') primary(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetPrimaryCharacterReferenceDto))
    dto: SetPrimaryCharacterReferenceDto,
  ) {
    return this.characters.setPrimary(id, dto.blobId);
  }
  @Post('characters/:id/references/promote') promote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PromoteCharacterReferenceDto)) dto: PromoteCharacterReferenceDto,
  ) {
    return this.characters.promoteReference(id, dto);
  }
}
