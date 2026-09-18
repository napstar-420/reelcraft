import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { PreviewTokenService } from './preview-token.service';
import { RunActionPolicy } from './run-action-policy';
import { RunModule } from './run.module';
import { RunMutationService } from './run-mutation.service';
import { RunWakeupClaimService } from './run-wakeup-claim.service';
import { RunWakeupDispatcher } from './run-wakeup-dispatcher.service';

describe('RunModule run-control wiring', () => {
  it('provides and exports every run-control foundation service', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, RunModule) as unknown[];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, RunModule) as unknown[];
    const services = [
      PreviewTokenService,
      RunActionPolicy,
      RunMutationService,
      RunWakeupDispatcher,
      RunWakeupClaimService,
    ];

    expect(providers).toEqual(expect.arrayContaining(services));
    expect(exports).toEqual(expect.arrayContaining(services));
  });
});
