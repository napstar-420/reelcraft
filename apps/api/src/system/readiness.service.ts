import { Injectable } from '@nestjs/common';
import { EngineConfig } from '../config/engine-config';

/** Tracks start-up work that must finish before the API reports healthy.
 * Today that is only registering with Inngest when INNGEST_SYNC_ON_BOOT is
 * set: until Inngest knows the app's functions, events such as `run/started`
 * are accepted but trigger nothing, and the run stays CREATED. */
@Injectable()
export class ReadinessService {
  private inngestSynced: boolean;

  constructor(config: EngineConfig) {
    this.inngestSynced = !config.inngestSyncOnBoot;
  }

  get ready(): boolean {
    return this.inngestSynced;
  }

  markInngestSynced(): void {
    this.inngestSynced = true;
  }
}
