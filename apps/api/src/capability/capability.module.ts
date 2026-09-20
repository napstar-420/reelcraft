import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ProviderModule } from '../provider/provider.module';
import { StorageModule } from '../storage/storage.module';
import { CapabilityRegistry } from './capability.registry';
import { CapabilityController } from './capability.controller';
import { LlmGenerate } from './impls/llm-generate.capability';
import { PublishStub } from './impls/publish-stub.capability';
import { HumanInputCapability } from './impls/human-input.capability';
import { HumanTimelineEditCapability } from './impls/human-timeline-edit.capability';
import { StyleRegistry } from './style.registry';
import { SubtitlesExportCapability } from './impls/subtitles-export.capability';
import { TimelineRenderCapability, VideoConcatCapability } from './impls/assembly.capability';
import {
  ImageGenerateCapability,
  VideoGenerateCapability,
  AudioSpeechCapability,
  MediaAnalyzeCapability,
} from './impls/media-generate.capability';

/**
 * §1.3 — may inject ProviderModule and StorageModule. Must NOT be able to
 * reach DbModule, RunModule, or BlueprintModule: no such import appears
 * below. See db.module.ts for why DbModule is not @Global() — that's what
 * makes this omission real DI enforcement rather than a convention.
 */
@Module({
  imports: [DiscoveryModule, ProviderModule, StorageModule],
  providers: [
    CapabilityRegistry,
    LlmGenerate,
    HumanInputCapability,
    HumanTimelineEditCapability,
    StyleRegistry,
    SubtitlesExportCapability,
    VideoConcatCapability,
    TimelineRenderCapability,
    PublishStub,
    ImageGenerateCapability,
    VideoGenerateCapability,
    AudioSpeechCapability,
    MediaAnalyzeCapability,
  ],
  controllers: [CapabilityController],
  exports: [CapabilityRegistry, StyleRegistry],
})
export class CapabilityModule {}
