import 'reflect-metadata';
import { ProviderRegistry } from '../../provider/provider.registry';
import { StyleRegistry } from '../../capability/style.registry';
import { CAPABILITY_KEY_METADATA } from '../../capability/capability.decorator';
import type { CapabilityImpl } from '../../capability/capability.interface';
import type { CapabilityRegistry } from '../../capability/capability.registry';
import {
  AudioSpeechCapability,
  ImageGenerateCapability,
  MediaAnalyzeCapability,
  VideoGenerateCapability,
} from '../../capability/impls/media-generate.capability';
import {
  TimelineRenderCapability,
  VideoConcatCapability,
} from '../../capability/impls/assembly.capability';
import { TextGenerateCapability } from '../../capability/impls/text-generate.capability';
import { HumanInputCapability } from '../../capability/impls/human-input.capability';
import { HumanTimelineEditCapability } from '../../capability/impls/human-timeline-edit.capability';
import { SubtitlesExportCapability } from '../../capability/impls/subtitles-export.capability';
import { PublishStub } from '../../capability/impls/publish-stub.capability';
import { BrowserAutomateCapability } from '../../capability/impls/browser-automate.capability';
import { FlowVideoCapability } from '../../capability/impls/flow-video.capability';

/** The real capability instances, built without Nest (only their static metadata is used by
 * tests: key, config schema, slots, allowed outputs), for tests that need the live registry. */
export function realCapabilities(): Array<{ key: string; impl: CapabilityImpl }> {
  const providers = new ProviderRegistry();
  const styles = new StyleRegistry();
  const stub = {} as never;
  const instances: unknown[] = [
    new TextGenerateCapability(providers),
    new HumanInputCapability(),
    new HumanTimelineEditCapability(),
    new SubtitlesExportCapability(),
    new PublishStub(),
    new ImageGenerateCapability(providers),
    new VideoGenerateCapability(providers),
    new AudioSpeechCapability(providers),
    new MediaAnalyzeCapability(providers),
    new VideoConcatCapability(stub),
    new TimelineRenderCapability(stub, stub, styles),
    new BrowserAutomateCapability(providers),
    new FlowVideoCapability(providers),
  ];
  return instances.map((impl) => ({
    key: Reflect.getMetadata(CAPABILITY_KEY_METADATA, (impl as object).constructor) as string,
    impl: impl as CapabilityImpl,
  }));
}

export function realCapabilityRegistry(): CapabilityRegistry {
  const all = realCapabilities();
  return {
    list: () => all,
    get: (key: string) => {
      const found = all.find((c) => c.key === key);
      if (!found) throw new Error(`unknown capability "${key}"`);
      return found.impl;
    },
  } as unknown as CapabilityRegistry;
}
