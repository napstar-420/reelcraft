# ADR-0018: VoiceStudio is an external voice service, reached by URL

**Date**: 2026-10-29
**Status**: accepted
**Deciders**: napstar-420, Claude

## Context

[VoiceStudio](https://github.com/debpalash/VoiceStudio) is a free, local voice app (AGPL-3.0) that runs many
speech engines (OmniVoice, CosyVoice, IndexTTS, KittenTTS…) and transcription engines, clones and designs
voices, and serves an OpenAI-compatible local API on port 3900. Users want it as a first-class voice
provider: speech in any installed engine, their own cloned voices, word timings and transcription, all free.
It is a large Python and Electron app with its own installer, updater and model manager.

## Decision

- **Installed and run by the user, never by Reelcraft.** Reelcraft only reaches it by URL: Settings, then
  `VOICESTUDIO_URL`, then `http://127.0.0.1:3900` (`http://host.docker.internal:3900` when `/.dockerenv`
  exists). The image is unchanged, so no `RUNTIME_VERSION` bump. Contrast ADR-0013, where Reelcraft manages
  Qwen3-TTS: VoiceStudio already has an installer, a model manager and GPU detection of its own.
- **One provider, `voicestudio`, two modalities.** `audio`: each engine `GET /engines/tts` lists as
  `available` (and with any licence accepted) is a speech model, its id the engine id. A blueprint keeps the
  engine it chose, whatever is active in VoiceStudio. `media`: one model, `transcribe`, for Analyze Media,
  because VoiceStudio always transcribes with its active ASR engine.
- **Speech is `POST /v1/audio/speech`**, one request per ≤ 4,000 characters, joined like the other speech
  providers. `voiceId` is a saved VoiceStudio voice (profile id) or an engine's built-in voice; unset means
  `default`, the engine's own. Voices come from `GET /v1/audio/voices` (profiles) plus the engine's
  `preset_voices`; profiles are listed only for engines that can clone. Engines that read voice-design
  tags (`instruct_vocabulary: "tags"`, OmniVoice) also list VoiceStudio's designed voices
  (`GET /archetypes`) as `archetype:<id>`. Those are recipes, not recordings: speech sends voice
  `default` with the archetype's tags as `instructions` and its seed (42) unless the stage sets one,
  which is how VoiceStudio speaks one saved as a voice. Reelcraft doesn't save them as VoiceStudio
  profiles, so picking one leaves nothing behind in VoiceStudio.
- **Word timings by transcription.** VoiceStudio returns no timings with speech, so with **Word timings** on,
  the adapter transcribes its own result (`/v1/audio/transcriptions`, `verbose_json`, word granularity) into
  the same `TimingMap` as Analyze Media. QC's **Include transcript** prefers VoiceStudio (free) over Deepgram.
- **Cloning from the library.** `POST /voicestudio/voices` reads an audio or video asset from storage and
  sends it to VoiceStudio's `POST /profiles` (`kind=clone`). VoiceStudio keeps the voice; Reelcraft stores
  nothing new, so there is no table and no cascade to extend. The browser never talks to VoiceStudio.
- **The API key is an ordinary provider key** (`voicestudio`, `VOICESTUDIO_API_KEY`), resolved through
  `KEY_PROVIDER` and sent as a bearer token. VoiceStudio needs it only from another host, which includes
  Reelcraft in Docker.
- **Unreachable is never an error at save time.** `ProviderAdapter.checkModel` (new, optional) lets a
  provider add a validation issue: a closed VoiceStudio is a warning, a missing engine an error. While it is
  closed, `listModels` serves the engines it last saw, each with `unavailableModalities.audio` (which the
  assistant reads), so a stage keeps its model. At run time `poll` checks `/health` and reports a
  `user_action` failure, so the stage fails at once with what to do instead of spending retries.

## Alternatives

- **Bundle or manage VoiceStudio like Qwen3-TTS (ADR-0013).** Gigabytes of Python and models, a second
  installer and updater to maintain, and an AGPL-3.0 component inside the image.
- **One "active engine" model.** Simpler, but a blueprint's voice would change whenever the user switched
  engines in VoiceStudio, and settings differ per engine.
- **VoiceStudio's MCP server.** Fits agents, not a durable provider job with retries and budgets.

## Consequences

- Users install and start a second app; the Settings card and the speech editor show whether it is reachable,
  with **Check again** and **Open VoiceStudio**.
- Reelcraft depends on VoiceStudio's public API shape (`/health`, `/engines/tts`, `/v1/audio/*`, `/profiles`).
  A breaking change there needs a change in `apps/api/src/provider/voicestudio/`.
- Dubbing, voice conversion, vocal isolation, live dictation and MCP are left for later (issue #208).
