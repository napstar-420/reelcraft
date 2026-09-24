import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { CreateChannelDto, UpdateChannelDto } from '@reelcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { channel } from '../db/schema/index';
import { ulid } from '../common/ulid';

@Injectable()
export class ChannelService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async create(ownerId: string, dto: CreateChannelDto) {
    const id = ulid();
    await this.db.insert(channel).values({
      id,
      ownerId,
      name: dto.name,
      description: dto.description ?? null,
      theme: dto.theme,
      defaults: dto.defaults,
    });
    return this.get(id);
  }

  async list() {
    return this.db.select().from(channel);
  }

  async get(id: string) {
    const [row] = await this.db.select().from(channel).where(eq(channel.id, id)).limit(1);
    if (!row) throw new NotFoundException(`Channel ${id} not found`);
    return row;
  }

  async update(id: string, dto: UpdateChannelDto) {
    await this.get(id);
    await this.db.update(channel).set(dto).where(eq(channel.id, id));
    return this.get(id);
  }
}
