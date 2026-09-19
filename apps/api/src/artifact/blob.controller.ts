import { Controller, Get, GoneException, NotFoundException, Param, Redirect } from '@nestjs/common';
import { Owner } from '../common/owner.decorator';
import { BlobService } from './blob.service';

@Controller('blobs')
export class BlobController {
  constructor(private readonly blobs: BlobService) {}

  @Get(':id')
  @Redirect(undefined, 302)
  async get(@Owner() ownerId: string, @Param('id') id: string) {
    const result = await this.blobs.readUrl(ownerId, id);
    if (!result) throw new NotFoundException();
    if (result.status === 'gone') throw new GoneException(result.blob);
    return { url: result.url };
  }
}
