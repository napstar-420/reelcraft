import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { StageDef } from '@reefcraft/shared';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { template, templateVersion } from '../db/schema/index';
import { ulid } from '../common/ulid';

/** Exported so `blueprint-validator.test.ts` can assert this exact fixture
 * validates clean — every e2e in chunks 4-5 boots `AppModule`, which seeds
 * this on `onApplicationBootstrap`, so a regression here fails at boot. */
export const HELLO_STAGE_GRAPH: StageDef[] = [
  {
    key: 'hello',
    label: 'Hello',
    capability: 'llm.generate',
    instructions: { template: 'Say a short, friendly hello to a new video-engine project.' },
    config: {},
    slots: {},
    context: {},
    output: { kind: 'text' },
    checks: [],
    retryLimit: 0,
    model: { provider: 'fake', modelId: 'fake-text-1', params: { max_tokens: 256 } },
  },
];

/**
 * §23/§24 phase 1 — seeds one builtin template so a fresh clone plus
 * `docker compose up` has something runnable without manual setup. §20:
 * `source = 'builtin'` templates are seeded on migration and not
 * user-editable.
 */
@Injectable()
export class TemplateSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TemplateSeedService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(template)
      .where(
        and(
          eq(template.ownerId, 'local'),
          eq(template.kind, 'blueprint'),
          eq(template.name, 'Hello Stage'),
        ),
      )
      .limit(1);

    if (existing) return;

    const templateId = ulid();
    await this.db.transaction(async (tx) => {
      await tx.insert(template).values({
        id: templateId,
        ownerId: 'local',
        source: 'builtin',
        kind: 'blueprint',
        name: 'Hello Stage',
        description: 'A single llm.generate stage against the fake provider — phase 1 smoke test.',
      });
      await tx.insert(templateVersion).values({
        id: ulid(),
        templateId,
        version: 1,
        body: HELLO_STAGE_GRAPH,
        requires: { capabilities: ['llm.generate'], inputs: [] },
      });
    });

    this.logger.log('Seeded builtin template "Hello Stage"');
  }
}
