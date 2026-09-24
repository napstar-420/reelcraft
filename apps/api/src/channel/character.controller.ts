import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  CharacterDto,
  ConfirmCharacterReferenceDto,
  CreateCharacterDto,
  PromoteCharacterReferenceDto,
  RequestCharacterReferenceUploadDto,
  SetPrimaryCharacterReferenceDto,
  UpdateCharacterDto,
  UpdateCharacterReferenceDto,
} from '@reelcraft/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CharacterService } from './character.service';

@Controller()
export class CharacterController {
  constructor(private readonly characters: CharacterService) {}
  @Get('channels/:channelId/characters') async list(@Param('channelId') channelId: string) {
    const rows = await this.characters.list(channelId);
    return rows.map((row) => CharacterDto.parse(row));
  }
  @Post('channels/:channelId/characters') async create(
    @Param('channelId') channelId: string,
    @Body(new ZodValidationPipe(CreateCharacterDto)) dto: CreateCharacterDto,
  ) {
    return CharacterDto.parse(await this.characters.create(channelId, dto));
  }
  @Get('characters/:id') async get(@Param('id') id: string) {
    return CharacterDto.parse(await this.characters.get(id));
  }
  @Patch('characters/:id') async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCharacterDto)) dto: UpdateCharacterDto,
  ) {
    return CharacterDto.parse(await this.characters.update(id, dto));
  }
  @Post('characters/:id/references/upload') upload(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RequestCharacterReferenceUploadDto))
    dto: RequestCharacterReferenceUploadDto,
  ) {
    return this.characters.requestReferenceUpload(id, dto.ext);
  }
  @Post('characters/:id/references') async confirm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConfirmCharacterReferenceDto)) dto: ConfirmCharacterReferenceDto,
  ) {
    return CharacterDto.parse(await this.characters.confirmReference(id, dto));
  }
  @Patch('characters/:id/references/:blobId') async patchRef(
    @Param('id') id: string,
    @Param('blobId') blobId: string,
    @Body(new ZodValidationPipe(UpdateCharacterReferenceDto)) dto: UpdateCharacterReferenceDto,
  ) {
    return CharacterDto.parse(await this.characters.updateReference(id, blobId, dto));
  }
  @Delete('characters/:id/references/:blobId') remove(
    @Param('id') id: string,
    @Param('blobId') blobId: string,
  ) {
    return this.characters.deleteReference(id, blobId);
  }
  @Put('characters/:id/primary-reference') async primary(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetPrimaryCharacterReferenceDto))
    dto: SetPrimaryCharacterReferenceDto,
  ) {
    return CharacterDto.parse(await this.characters.setPrimary(id, dto.blobId));
  }
  @Post('characters/:id/references/promote') async promote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PromoteCharacterReferenceDto)) dto: PromoteCharacterReferenceDto,
  ) {
    return CharacterDto.parse(await this.characters.promoteReference(id, dto));
  }
}
