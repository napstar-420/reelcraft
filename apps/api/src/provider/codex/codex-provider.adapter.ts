import type { JsonSchema, Modality } from '@reelcraft/shared';
import type { EngineConfig } from '../../config/engine-config';
import {
  CliJobProviderAdapter,
  type CliModel,
  type CliRuntimeReadiness,
} from '../cli-job/cli-job-provider.adapter';
import type { CliJobLauncher } from '../cli-job/cli-job-launcher';
import type { CliInputMaterializer } from '../cli-job/cli-input-materializer';
import type { CodexAppServerClient } from './codex-app-server.client';
import { strictJsonSchema } from './codex-command';

/** `codex exec` as a durable job: text, image (its image-generation tool) and
 * browser (BrowserOS Neo through Codex's MCP config). */
export class CodexProviderAdapter extends CliJobProviderAdapter {
  readonly id = 'codex';
  readonly modalities: Modality[] = ['text', 'image', 'browser', 'code'];
  protected readonly label = 'Codex';
  protected readonly cli = 'codex';
  private readonly profile: string;

  constructor(
    config: Pick<EngineConfig, 'workspaceRoot'> & Partial<EngineConfig>,
    private readonly models: CodexAppServerClient,
    launcher: CliJobLauncher,
    readiness?: CliRuntimeReadiness,
    inputMaterializer?: CliInputMaterializer,
  ) {
    super(config, launcher, readiness, inputMaterializer);
    this.profile = config.codexProfile ?? 'reelcraft';
  }

  protected catalog(): Promise<CliModel[]> {
    return this.models.listModels();
  }

  protected override wireSchema(schema: JsonSchema): unknown | undefined {
    return strictJsonSchema(schema);
  }

  protected override async runnerOptions(): Promise<Record<string, unknown>> {
    return { profile: this.profile };
  }
}
