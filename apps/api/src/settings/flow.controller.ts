import { Controller, Get } from '@nestjs/common';
import type { FlowAccountsDto } from '@reelcraft/shared';
import { NeoClient } from '../provider/chatgpt/neo-client';
import {
  listGoogleAccountsScript,
  parseGoogleAccounts,
} from '../provider/google/google-accounts-page';

/** The Google accounts signed in to BrowserOS Neo, for the Flow accounts picker. */
@Controller('flow')
export class FlowController {
  constructor(private readonly neo: NeoClient) {}

  @Get('accounts')
  async accounts(): Promise<FlowAccountsDto> {
    const text = await this.neo.run<string>(listGoogleAccountsScript());
    return { accounts: parseGoogleAccounts(text) };
  }
}
