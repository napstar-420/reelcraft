import type { Modality } from '@reelcraft/shared';
import type { EngineConfig } from '../../config/engine-config';
import type { SettingsService } from '../../settings/settings.service';
import { browserOsHostHeaders } from '../chatgpt/browseros-host';
import {
  CliJobProviderAdapter,
  type CliModel,
  type CliRuntimeReadiness,
} from '../cli-job/cli-job-provider.adapter';
import type { CliJobLauncher } from '../cli-job/cli-job-launcher';
import type { CliInputMaterializer } from '../cli-job/cli-input-materializer';
import { CLAUDE_MODELS, CLAUDE_NEO_SERVER } from './claude-command';

/** `claude -p` (Claude Code, signed in with the user's Claude plan) as a
 * durable job: text and browser (BrowserOS Neo). Claude has no image
 * generation, so it never offers the `image` modality. */
export class ClaudeProviderAdapter extends CliJobProviderAdapter {
  readonly id = 'claude';
  readonly modalities: Modality[] = ['text', 'browser', 'code'];
  protected readonly label = 'Claude';
  protected readonly cli = 'claude';

  constructor(
    config: Pick<EngineConfig, 'workspaceRoot'> & Partial<EngineConfig>,
    launcher: CliJobLauncher,
    private readonly settings: Pick<SettingsService, 'browserOsUrl'>,
    readiness?: CliRuntimeReadiness,
    inputMaterializer?: CliInputMaterializer,
  ) {
    super(config, launcher, readiness, inputMaterializer);
  }

  protected async catalog(): Promise<CliModel[]> {
    return CLAUDE_MODELS;
  }

  /** Browser jobs reach Neo through an MCP server given on the command line,
   * read from Settings for every job, so nothing has to be registered. */
  protected override async runnerOptions(modality: Modality): Promise<Record<string, unknown>> {
    if (modality !== 'browser') return {};
    const url = await this.settings.browserOsUrl();
    const headers = browserOsHostHeaders(url);
    return {
      mcpServers: {
        [CLAUDE_NEO_SERVER]: {
          type: 'http',
          url,
          ...(Object.keys(headers).length > 0 && { headers }),
        },
      },
    };
  }
}
