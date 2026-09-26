# Graph Report - reelcraft  (2026-09-27)

## Corpus Check
- 499 files · ~307,381 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 3, .example 1, .tour 1)

## Summary
- 3134 nodes · 9347 edges · 144 communities (130 shown, 14 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 392 edges (avg confidence: 0.8)
- Token cost: 289,139 input · 0 output

## Community Hubs (Navigation)
- Blueprint/Channel/Run Core Services
- Blueprint Editor Binding & Validation UI
- Media Artifacts & Timeline Resources
- Provider Adapters (ElevenLabs/Fal/OpenRouter)
- Artifact Recording Services
- Runs List UI & Actions
- Run Wakeup & Human-Wait Services
- Capability Execution Contexts
- Codex Provider Adapter
- Capability Config & Media Descriptors
- Drizzle DB Schema (artifact/asset/blob)
- App Shell & Sidebar Navigation
- Capability Registry & Style Registry
- Built-in Check Definitions
- Blueprint Visual Canvas Editor
- Local Compute & Timeline Render Capability
- Channel/Character Dialogs
- Asset & Character Cards UI
- Asset Upload & Approval UI
- Engine Config
- Timeline Composition (Remotion)
- Stage/Timeline Check Services
- Blueprint Draft Canvas Graph
- Run Controller (REST API)
- shadcn UI Primitives
- Root ESLint/Prettier Config
- Artifact Edit & Human Action Services
- Run Input Service
- Budget Ledger & Run Cancellation
- Stage Runner Service
- Codex Launch & Status Files
- Blueprint Validator Service
- Stage Attempt Loop
- Deepgram Adapter
- Env & Bucket Bootstrap
- Render Worker Job
- In-Process Run Events (SSE)
- QC Envelope/Runner/Verdict
- Templated Stage Output Instructions
- Capability & Model DTOs
- Nest Domain Modules
- API DTOs (Blueprint/Character/Check)
- Web Routed Shell & Tabs
- Asset/Character Lookup
- Preview Token Service
- Run Launch Values
- Blueprint Controller (REST)
- Asset Controller/Service
- Web Package Manifest
- Template Controller/Service
- Invalidation Closure & Preview
- shadcn Components Config
- Run DTOs (Approval/Attach/Create)
- API Package Dependencies
- Nest Modules (Blueprint/Capability/Channel)
- Web Package Dependencies
- Check/QC/Template Test DTOs
- Channel DTOs & Config Layer
- Stage Attempt Resolve/Submit
- Character Controller
- Timeline Draft & Media Manifest DTOs
- Root TS Config
- Check Controller & Test Service
- Blob Controller & Zod Pipe
- Timeline Editor Service
- Script Sandbox Service
- Web TS Config
- Asset/Reference DTOs
- API Package Manifest
- Binding Resolver Service
- Check Runner & Ref Envelope
- Character Service
- Dropdown Menu UI
- Shared Package Manifest
- Acceptance Test Scripts
- Phase 7 Iteration Design Notes
- Channel Controller
- Env Loading & Drizzle Config
- Derived Frame Service (test doubles)
- Engine Config Validator Fakes
- Compatibility Verdict/Schema Match
- Memory Storage Adapter
- Nest Test App Bootstrap
- File/Media Artifact Service
- Template Path Parsing
- Codex Args/Prompt Builder
- Run Action Policy & Wakeup Claim
- Schema Validator Service
- Fake Provider Adapter
- Memory Invalidation Closure
- Theme Provider & App Root
- Blueprint Canvas Page Design
- Blueprint Version DTOs
- Template Requires/Counts
- Ledger & Run Orchestrate Design
- JSON Schema & Media Constraints
- Timeline-Composition TS Config
- API Dev Dependencies
- Reservation & Ledger Helpers
- Acceptance TS Config
- Checks Editor UI
- Requirements: Core Entities
- Acceptance Codex Workspace Design
- Character Controller Tests
- S3 Storage Adapter
- Test TS Config
- Phase 6/7 Acceptance Design
- API Bootstrap Helpers
- Iterate Binding Resolver Design
- Source Type Resolution
- Run State Service
- API TS Config
- Render-Worker TS Config
- Type Dev Dependencies
- Nest CLI Config
- Timeline Handle Service
- Timeline Resource Resolver Service
- Timeline Gap/Aspect Helpers
- Build TS Config
- Item-Level Invalidation Design
- Shared Package TS Config
- Artifact Attachment Service
- Iterating Stage Loop Drivers
- Web Package Scripts
- Params Editor UI
- Requirements: Character/LoRA
- Provider Module Bootstrap
- Run Service Test Helpers
- Template Seed Service
- Secret Redaction Helpers
- PR #19 Post-Review Fixes
- Prettier Config
- Global Config Module
- Workspace Pull/Push
- Test TS Config (nested)
- Root TS Project References
- Phase 7 B-Roll Script
- Derived Frame Shared Helper
- Bootstrap Script
- Inngest DB Init Script
- Live Updates via SSE/Socket.IO
- Blueprint Create Endpoint
- Templated Stage Output Feature

## God Nodes (most connected - your core abstractions)
1. `@nestjs/common` - 117 edges
2. `EngineConfig` - 88 edges
3. `Db` - 76 edges
4. `drizzle-orm` - 74 edges
5. `ulid` - 73 edges
6. `run` - 62 edges
7. `StageRunnerService` - 55 edges
8. `RunService` - 49 edges
9. `BlueprintService` - 44 edges
10. `DRIZZLE` - 40 edges

## Surprising Connections (you probably didn't know these)
- `docker-compose.yml Local Stack` --semantically_similar_to--> `CI Workflow (GitHub Actions)`  [INFERRED] [semantically similar]
  docker-compose.yml → .github/workflows/ci.yml
- `CLAUDE.md Project Instructions` --semantically_similar_to--> `AGENTS.md Project Instructions`  [INFERRED] [semantically similar]
  CLAUDE.md → AGENTS.md
- `TimelineEditorPage()` --calls--> `timelineDurationSec()`  [EXTRACTED]
  apps/web/src/pages/TimelineEditorPage.tsx → packages/timeline-composition/src/index.tsx
- `Known Gotchas (infra/build pitfalls)` --references--> `Invalidation Transaction`  [INFERRED]
  README.md → .claude/plans/phase-4-inputs-hitl.md
- `codex-app-server.client` --implements--> `Local Codex Provider (text.generate)`  [INFERRED]
  .claude/tdd/codex-provider.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase 4 Durable Run-Control Lifecycle** — claude_plans_phase_4_inputs_hitl_run_revision, claude_plans_phase_4_inputs_hitl_run_wakeup_outbox, claude_plans_phase_4_inputs_hitl_signed_invalidation_previews, claude_plans_phase_4_inputs_hitl_run_action_policy, claude_plans_phase_4_inputs_hitl_human_wait, claude_plans_phase_4_inputs_hitl_cancel_result [INFERRED 0.85]
- **Phase 9/9.5 Capability-Driven No-Code Editor Pipeline** — claude_plans_phase_9_progress_capability_config_form, claude_plans_phase_9_progress_schema_editor, claude_plans_phase_9_5_progress_stage_inspector, claude_plans_phase_9_5_progress_schema_form, claude_plans_phase_9_5_progress_binding_picker, claude_plans_phase_9_5_progress_model_pin_editor [INFERRED 0.80]
- **Code-Review-Driven Fix Cycle Across PRs 17/19/20** — claude_reviews_pr_17_review_iterate_provenance_finding, claude_reviews_pr_19_review_capability_resolve_notfound, claude_reviews_pr_19_review_instantiate_dto_validation, claude_reviews_pr_20_review_string_only_value_editors, claude_reviews_pr_20_review_typed_value_input [INFERRED 0.75]
- **Iterate stage execution pipeline (Phase 7)** — docs_plans_phase_7_iteration_iterate_field, docs_plans_phase_7_iteration_stage_item_table, docs_plans_phase_7_iteration_binding_resolver_service, docs_plans_phase_7_iteration_ledger_service, apps_api_src_run_invalidation_closure, docs_plans_phase_7_iteration_run_orchestrate_fn [INFERRED 0.85]
- **Phase 9 editor backend surface consumed by Phase 9.5 canvas** — docs_plans_phase_9_editor_templates_capability_resolve_endpoint, docs_plans_phase_9_editor_templates_check_types_endpoint, docs_plans_phase_9_editor_templates_validate_endpoint, docs_plans_phase_9_editor_templates_dry_run_endpoint, docs_plans_phase_9_5_visual_canvas_blueprint_canvas_page [EXTRACTED 1.00]
- **Character identity consistency pipeline** — docs_ai_reel_engine_requirements_character, docs_plans_phase_8_characters_channel_character, docs_plans_phase_8_characters_reference_promotion, docs_plans_phase_8_characters_immutable_run_snapshot [INFERRED 0.85]

## Communities (144 total, 14 thin omitted)

### Community 0 - "Blueprint/Channel/Run Core Services"
Cohesion: 0.06
Nodes (45): BlueprintService, Injectable, ChannelService, Injectable, stageAttempt, apps_api_src_db_schema_index_ledgerentry, apps_api_src_db_schema_index_stageattempt, ledgerEntry (+37 more)

### Community 1 - "Blueprint Editor Binding & Validation UI"
Cohesion: 0.05
Nodes (56): acceptsManyMedia(), ALL_REF_KINDS, availableRefKinds(), BindingPicker(), BindingPickerProps, defaultRefFor(), BlueprintSettingsPanel(), buildAccepts() (+48 more)

### Community 2 - "Media Artifacts & Timeline Resources"
Cohesion: 0.08
Nodes (42): SupportingAttachmentInput, ArtifactRow, DerivedFrameKind, DerivedFrameManifest, Executor, Inject, Inject, Inject (+34 more)

### Community 3 - "Provider Adapters (ElevenLabs/Fal/OpenRouter)"
Cohesion: 0.06
Nodes (29): ElevenLabsAdapter, Inject, Injectable, FakeJobPayload, FalAdapter, FalHandle, Inject, Injectable (+21 more)

### Community 4 - "Artifact Recording Services"
Cohesion: 0.07
Nodes (48): ArtifactRecord, ArtifactService, Executor, RecordAttemptArtifactInput, RecordInputArtifactInput, Inject, Injectable, ArtifactRow (+40 more)

### Community 5 - "Runs List UI & Actions"
Cohesion: 0.06
Nodes (53): StageAttemptsSheet(), AlertDialog(), AlertDialogAction(), AlertDialogCancel(), AlertDialogContent(), AlertDialogDescription(), AlertDialogFooter(), AlertDialogHeader() (+45 more)

### Community 6 - "Run Wakeup & Human-Wait Services"
Cohesion: 0.05
Nodes (36): collectAssetIds(), artifactAttachment, humanWait, apps_api_src_db_schema_index_artifactattachment, apps_api_src_db_schema_index_humanwait, apps_api_src_db_schema_index_runwakeup, runWakeup, RunStartedEventData (+28 more)

### Community 7 - "Capability Execution Contexts"
Cohesion: 0.05
Nodes (13): ExecCtx, BrowserAutomateCapability, Injectable, HumanInputCapability, Injectable, HumanTimelineEditCapability, Injectable, MediaAnalyzeCapability (+5 more)

### Community 8 - "Codex Provider Adapter"
Cohesion: 0.06
Nodes (23): CodexAppServerClient, CodexModel, RpcResponse, SpawnCodex, CodexInputMaterializer, Inject, Injectable, CodexJobLauncher (+15 more)

### Community 9 - "Capability Config & Media Descriptors"
Cohesion: 0.10
Nodes (29): Capability(), CAPABILITY_KEY_METADATA, CancelResult, CapabilityImpl, ExecResult, ConcatConfig, estimate, MediaDescriptor (+21 more)

### Community 10 - "Drizzle DB Schema (artifact/asset/blob)"
Cohesion: 0.15
Nodes (34): artifactKind, reproLevelEnum, assetKindEnum, blobScopeEnum, channel, character, characterReadinessEnum, characterScopeEnum (+26 more)

### Community 11 - "App Shell & Sidebar Navigation"
Cohesion: 0.07
Nodes (30): AppShell(), AppSidebar(), navItems, Breadcrumb(), BreadcrumbItem(), BreadcrumbLink(), BreadcrumbList(), BreadcrumbPage() (+22 more)

### Community 12 - "Capability Registry & Style Registry"
Cohesion: 0.06
Nodes (21): CapabilityController, noProviders, noStyles, Body, Controller, Get, Param, Post (+13 more)

### Community 13 - "Built-in Check Definitions"
Cohesion: 0.08
Nodes (29): arrayLength, Params, paramsSchema, durationRange, Params, paramsSchema, mediaFormat, Params (+21 more)

### Community 14 - "Blueprint Visual Canvas Editor"
Cohesion: 0.05
Nodes (40): AGENTS.md Project Instructions, apps/web index.html Shell, CLAUDE.md Project Instructions, Cost Preview (spentUsd/estimatedRerunUsd), Invalidation Transaction, Observational Invalidation, BindingPicker (Ref editor), BlueprintCanvasPage (xyflow visual canvas) (+32 more)

### Community 15 - "Local Compute & Timeline Render Capability"
Cohesion: 0.09
Nodes (9): LocalComputeCapability, TimelineRenderCapability, Injectable, unwrap(), VideoConcatCapability, ComputeHandle, ComputeJobService, Inject (+1 more)

### Community 16 - "Channel/Character Dialogs"
Cohesion: 0.16
Nodes (23): api, ASSET_KINDS, ChannelDialog(), ChannelDialogMode, themeLabel(), CharacterDialogMode, RaiseBudgetDialog(), StageRetryDialog() (+15 more)

### Community 17 - "Asset & Character Cards UI"
Cohesion: 0.14
Nodes (25): AssetCard(), KIND_ICONS, Violation, ChannelCard(), themeLabels(), ChannelDialogState, CharacterCard(), CharacterDetailSheet() (+17 more)

### Community 18 - "Asset Upload & Approval UI"
Cohesion: 0.10
Nodes (23): AssetCreateDialog(), AddReference(), VIEW_OPTIONS, ApprovalCandidate(), ApprovalReviewSheet(), RejectionPreview, Progress(), ScrollArea() (+15 more)

### Community 19 - "Engine Config"
Cohesion: 0.05
Nodes (7): fakeEngineConfig(), EngineConfig, Injectable, Inject, Inject, fakeEngineConfig(), fakeEngineConfig()

### Community 20 - "Timeline Composition (Remotion)"
Cohesion: 0.06
Nodes (32): packages_shared_dist_index_timelineitem, dependencies, react, @reelcraft/shared, remotion, @remotion/media, devDependencies, @types/react (+24 more)

### Community 21 - "Stage/Timeline Check Services"
Cohesion: 0.09
Nodes (19): Inject, MODALITIES, TimelineCheckService, Inject, Injectable, CONSUMES_SEMANTIC_ATTEMPT, StageAttemptContext, StageContext (+11 more)

### Community 22 - "Blueprint Draft Canvas Graph"
Cohesion: 0.08
Nodes (23): graph(), AddStageMenu(), handleAdd(), defaultOutput(), nextStageKey(), CapabilityPicker(), parseValidationPath(), BlueprintDraft (+15 more)

### Community 23 - "Run Controller (REST API)"
Cohesion: 0.15
Nodes (10): RunController, Body, Controller, Get, Param, Patch, Post, Put (+2 more)

### Community 24 - "shadcn UI Primitives"
Cohesion: 0.14
Nodes (16): Alert(), AlertDescription(), alertVariants, Label(), Slider(), Tooltip(), TooltipContent(), TooltipTrigger() (+8 more)

### Community 25 - "Root ESLint/Prettier Config"
Cohesion: 0.06
Nodes (32): devDependencies, eslint, eslint-config-prettier, eslint-plugin-import, prettier, typescript, typescript-eslint, engines (+24 more)

### Community 26 - "Artifact Edit & Human Action Services"
Cohesion: 0.16
Nodes (7): isUniqueViolation(), nextVersion(), Tx, ArtifactEditService, Injectable, HumanActionService, Injectable

### Community 27 - "Run Input Service"
Cohesion: 0.11
Nodes (3): modalityForCapability(), RunInputService, Injectable

### Community 28 - "Budget Ledger & Run Cancellation"
Cohesion: 0.13
Nodes (10): isUniqueViolation(), LedgerService, Inject, Injectable, fromUsd(), toUsd(), RunCancellationService, Inject (+2 more)

### Community 29 - "Stage Runner Service"
Cohesion: 0.11
Nodes (5): buildStageExecuteFunction(), StageRunnerService, Injectable, createRun(), setUpBroll()

### Community 30 - "Codex Launch & Status Files"
Cohesion: 0.13
Nodes (22): apps_api_dist_provider_codex_codex_app_server_client, apps_api_dist_provider_codex_codex_app_server_client_codexappserverclient, apps_api_dist_provider_codex_codex_job_launcher, apps_api_dist_provider_codex_codex_job_launcher_codexjoblauncher, apps_api_dist_provider_codex_codex_provider_adapter, apps_api_dist_provider_codex_codex_provider_adapter_codexprovideradapter, CodexLaunchInput, PersistedStatus (+14 more)

### Community 31 - "Blueprint Validator Service"
Cohesion: 0.14
Nodes (10): BlueprintValidatorService, canonicalizeIterateOver(), iterateProducedArity(), sameEnabledWhen(), Injectable, BlueprintValidationInput, buildValidationContext(), MemoryWriter (+2 more)

### Community 32 - "Stage Attempt Loop"
Cohesion: 0.13
Nodes (16): BlobService, Inject, Injectable, buildBudgetSweepFunction(), buildCronShellFunctions(), buildHumanReminderSweepFunction(), buildInngestFunctions(), buildRunWakeupDispatchFunction() (+8 more)

### Community 33 - "Deepgram Adapter"
Cohesion: 0.09
Nodes (13): DeepgramAdapter, normalize(), Inject, Injectable, DeepgramController, Body, Controller, Post (+5 more)

### Community 34 - "Env & Bucket Bootstrap"
Cohesion: 0.13
Nodes (13): Env, EnvSchema, validateEnv(), config(), NOW, fakeEngineConfig(), BucketBootstrapService, Injectable (+5 more)

### Community 35 - "Render Worker Job"
Cohesion: 0.08
Nodes (24): dependencies, @reelcraft/shared, @reelcraft/timeline-composition, remotion, @remotion/bundler, @remotion/renderer, devDependencies, @types/node (+16 more)

### Community 36 - "In-Process Run Events (SSE)"
Cohesion: 0.09
Nodes (18): InProcessRunEvents, RunEvent, RunEvents, Injectable, packages_shared_dist_index_approvalactiondto, packages_shared_dist_index_confirmrunactiondto, packages_shared_dist_index_humaninputsubmissiondto, packages_shared_dist_index_listrunsquerydto (+10 more)

### Community 37 - "QC Envelope/Runner/Verdict"
Cohesion: 0.16
Nodes (15): buildQcEnvelope(), QcEnvelope, QcEnvelopeSource, buildQcPrompt(), describeError(), QcOutcome, QcRunner, QcVerdict (+7 more)

### Community 38 - "Templated Stage Output Instructions"
Cohesion: 0.11
Nodes (15): buildStageOutput(), isOutputInstructionsIssue(), outputInstructions(), supportsOutputInstructions(), updateDataOutputSchema(), nextFreeKey(), QcDimensionsEditor(), remove() (+7 more)

### Community 39 - "Capability & Model DTOs"
Cohesion: 0.10
Nodes (22): CapabilityDto, ModelInfoDto, ResolveCapabilityRequestDto, ResolveCapabilityResponseDto, ArtifactKind, BlobScope, CharacterReadiness, CharacterScope (+14 more)

### Community 40 - "Nest Domain Modules"
Cohesion: 0.19
Nodes (16): ArtifactModule, Module, BudgetModule, Module, CheckModule, Module, DbModule, Module (+8 more)

### Community 41 - "API DTOs (Blueprint/Character/Check)"
Cohesion: 0.08
Nodes (23): ApiError, BlueprintDto, CharacterListItemDto, CheckResultDto, CheckTypeDto, InstantiateTemplateResult, request(), TemplateListItem (+15 more)

### Community 42 - "Web Routed Shell & Tabs"
Cohesion: 0.15
Nodes (19): TimelineEditorPage, AssetsTab(), BlueprintsTab(), CapabilityConfigForm(), CheckTesterPage(), DryRunTrigger(), SchemaEditor(), TemplateLibraryPanel() (+11 more)

### Community 43 - "Asset/Character Lookup"
Cohesion: 0.13
Nodes (13): AssetLookup, CharacterLookup, parseConfigLayerMap(), resolveJudgeModel(), toModelPin(), engineDefaults(), isPlainObject(), Json (+5 more)

### Community 44 - "Preview Token Service"
Cohesion: 0.15
Nodes (14): canonicalJson(), schemaHash(), sortKeys(), claimsSchema, IssuedPreviewToken, IssuePreviewToken, previewPayloadDigest(), PreviewTokenBinding (+6 more)

### Community 45 - "Run Launch Values"
Cohesion: 0.12
Nodes (20): buildLaunchInputs(), CreatedRun, executeRunLaunch(), extension(), LaunchResume, LaunchRunError, LaunchValue, LaunchValues (+12 more)

### Community 46 - "Blueprint Controller (REST)"
Cohesion: 0.14
Nodes (7): BlueprintController, Body, Controller, Get, Param, Post, Query

### Community 47 - "Asset Controller/Service"
Cohesion: 0.14
Nodes (11): AssetController, Body, Controller, Delete, Get, Param, Post, AssetService (+3 more)

### Community 48 - "Web Package Manifest"
Cohesion: 0.09
Nodes (21): react, @reelcraft/shared, @reelcraft/timeline-composition, @types/node, @types/react, typescript, vitest, name (+13 more)

### Community 49 - "Template Controller/Service"
Cohesion: 0.13
Nodes (10): TemplateController, Body, Controller, Get, Param, Post, isUniqueViolation(), TemplateService (+2 more)

### Community 50 - "Invalidation Closure & Preview"
Cohesion: 0.16
Nodes (11): InvalidationClosure, InvalidationSeed, InvalidationPreview, stageBindsPrevItem(), RunActionService, iteratingStage, nonIteratingStage, sequencedDb() (+3 more)

### Community 51 - "shadcn Components Config"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 52 - "Run DTOs (Approval/Attach/Create)"
Cohesion: 0.12
Nodes (19): attempt, ApprovalCandidateDto, AttachInputDto, CreateRunDto, ListRunsQueryDto, ListRunsResultDto, PutRunInputDto, RaiseBudgetDto (+11 more)

### Community 53 - "API Package Dependencies"
Cohesion: 0.10
Nodes (21): dependencies, ajv, @aws-sdk/client-s3, @aws-sdk/lib-storage, @aws-sdk/s3-request-presigner, dotenv, drizzle-orm, express (+13 more)

### Community 54 - "Nest Modules (Blueprint/Capability/Channel)"
Cohesion: 0.15
Nodes (16): BlueprintModule, Module, CapabilityModule, Module, ChannelModule, Module, JsonSchemaModule, Module (+8 more)

### Community 55 - "Web Package Dependencies"
Cohesion: 0.10
Nodes (21): dependencies, class-variance-authority, cn, date-fns, @fontsource-variable/geist, lucide-react, next-themes, radix-ui (+13 more)

### Community 56 - "Check/QC/Template Test DTOs"
Cohesion: 0.18
Nodes (12): CheckDef, ModelPin, TestCheckRequestDto, InstantiateTemplateDto, SaveTemplateDto, TemplateMetaFields, TemplateRequires, QcDef (+4 more)

### Community 57 - "Channel DTOs & Config Layer"
Cohesion: 0.13
Nodes (16): ConfigLayer, PartialModelPin, ArchiveChannelDto, ChannelDto, CreateChannelDto, ListChannelsQueryDto, UpdateChannelDto, ApprovalActionDto (+8 more)

### Community 58 - "Stage Attempt Resolve/Submit"
Cohesion: 0.24
Nodes (15): isUniqueViolation(), passItem(), passShotsStage(), passStage(), runOneItemAttempt(), driveItemAttempts(), passStage(), driveItemAttempts() (+7 more)

### Community 59 - "Character Controller"
Cohesion: 0.21
Nodes (9): CharacterController, Body, Controller, Delete, Get, Param, Patch, Post (+1 more)

### Community 60 - "Timeline Draft & Media Manifest DTOs"
Cohesion: 0.13
Nodes (16): SaveTimelineDraftDto, SubmitTimelineDraftDto, TimelineEditorSessionDto, FileSource, MediaManifest, MediaSource, Probe, TimingMap (+8 more)

### Community 61 - "Root TS Config"
Cohesion: 0.10
Nodes (19): compilerOptions, composite, declaration, declarationMap, emitDecoratorMetadata, esModuleInterop, exactOptionalPropertyTypes, experimentalDecorators (+11 more)

### Community 62 - "Check Controller & Test Service"
Cohesion: 0.14
Nodes (10): BUILTIN_CHECKS, CheckController, Body, Controller, Get, Post, CheckTestService, Inject (+2 more)

### Community 63 - "Blob Controller & Zod Pipe"
Cohesion: 0.13
Nodes (11): BlobController, Controller, Get, Param, Owner, ZodValidationPipe, packages_shared_dist_index_createchanneldto, packages_shared_dist_index_instantiatetemplatedto (+3 more)

### Community 64 - "Timeline Editor Service"
Cohesion: 0.19
Nodes (5): dedupeResources(), TimelineEditorService, toSourceRow(), Inject, Injectable

### Community 65 - "Script Sandbox Service"
Cohesion: 0.16
Nodes (10): buildSource(), classifyFailure(), describeError(), SandboxCompileOutcome, SandboxOutcome, ScriptSandboxService, Injectable, wrapScript() (+2 more)

### Community 66 - "Web TS Config"
Cohesion: 0.11
Nodes (18): compilerOptions, baseUrl, composite, declaration, declarationMap, isolatedModules, jsx, lib (+10 more)

### Community 67 - "Asset/Reference DTOs"
Cohesion: 0.11
Nodes (15): ReferenceImage, ReferencePolicy, AssetDto, AssetKind, CreateAssetDto, RequestAssetUploadDto, RequestAssetUploadResultDto, CharacterDto (+7 more)

### Community 68 - "API Package Manifest"
Cohesion: 0.11
Nodes (15): @reelcraft/shared, @types/node, typescript, vitest, zod, name, private, version (+7 more)

### Community 69 - "Binding Resolver Service"
Cohesion: 0.22
Nodes (7): BindingResolverService, itemIndexOf(), mediaManifest(), Injectable, unwrapArtifactData(), unwrapText(), packages_shared_dist_index_artifactkind

### Community 70 - "Check Runner & Ref Envelope"
Cohesion: 0.31
Nodes (11): RefEnvelope, authoringFault(), CheckRunner, ScriptReturn, toCheckResult(), Injectable, CheckArtifact, CheckOutcome (+3 more)

### Community 71 - "Character Service"
Cohesion: 0.26
Nodes (3): CharacterService, Inject, Injectable

### Community 72 - "Dropdown Menu UI"
Cohesion: 0.14
Nodes (5): ModeToggle(), DropdownMenu(), DropdownMenuContent(), DropdownMenuItem(), DropdownMenuTrigger()

### Community 73 - "Shared Package Manifest"
Cohesion: 0.11
Nodes (17): dependencies, zod, devDependencies, typescript, vitest, typescript, vitest, zod (+9 more)

### Community 74 - "Acceptance Test Scripts"
Cohesion: 0.12
Nodes (17): scripts, acceptance:codex, acceptance:codex-browser, acceptance:codex-image, acceptance:phase4-restart, acceptance:phase6-render, acceptance:phase7-broll, build (+9 more)

### Community 75 - "Phase 7 Iteration Design Notes"
Cohesion: 0.13
Nodes (17): CancelResult Contract, Chunk 2 — Invalidation Engine, Previews, Tombstones, Chunk 3 — Retry/Confirm, Overrides, Generalized Resume, Manual Edit, Chunk 4 — Stage Approval and Routed Rejection, Chunk 5 — human.input and PAUSED_INPUT, Chunk 6 — Cancellation and 24h/48h Reminder Sweep, Chunk 7 — Action-Matrix Acceptance and Hardening, human_wait Table (+9 more)

### Community 76 - "Channel Controller"
Cohesion: 0.17
Nodes (7): ChannelController, Body, Controller, Get, Param, Patch, Post

### Community 77 - "Env Loading & Drizzle Config"
Cohesion: 0.18
Nodes (8): loadRootEnv(), dotenv, path, applyTestEnvDefaults(), PLACEHOLDER_DEFAULTS, dotenv, drizzle-kit, postgres

### Community 78 - "Derived Frame Service (test doubles)"
Cohesion: 0.16
Nodes (7): Inject, DerivedFrameService, execFileAsync, Injectable, CountingDerivedFrameService, TestableDerivedFrameService, TestableDerivedFrameService

### Community 79 - "Engine Config Validator Fakes"
Cohesion: 0.14
Nodes (11): fakeEngineConfig(), fakeRegistry(), llmGenerate, makeValidator(), sandbox, videoGen, withManyImageReferences, withManySlot (+3 more)

### Community 80 - "Compatibility Verdict/Schema Match"
Cohesion: 0.24
Nodes (10): checkBound(), CompatibilityDeps, CompatibilityVerdict, isCompatible(), isCompatibleWithOne(), isSubschema(), deps, dataSource (+2 more)

### Community 81 - "Memory Storage Adapter"
Cohesion: 0.20
Nodes (6): hashOf(), MemoryStorageAdapter, StoredObject, streamToBuffer(), packages_shared_dist_index_byterange, packages_shared_dist_index_putresult

### Community 82 - "Nest Test App Bootstrap"
Cohesion: 0.20
Nodes (10): AppModule, Module, bootstrap(), INNGEST_CLIENT, inngestClientProvider, buildHttpTestApp(), HttpTestApp, express (+2 more)

### Community 83 - "File/Media Artifact Service"
Cohesion: 0.18
Nodes (7): FileArtifactService, Injectable, extensionFor(), MediaArtifactService, Injectable, execFileAsync, Inject

### Community 84 - "Template Path Parsing"
Cohesion: 0.27
Nodes (11): getByPath(), parseTemplatePaths(), parseTemplatePathSegments(), PathSegment, renderPrompt(), renderStagePrompt(), narrowDataSchema(), narrowLiteral() (+3 more)

### Community 85 - "Codex Args/Prompt Builder"
Cohesion: 0.26
Nodes (11): buildCodexArgs(), buildCodexPrompt(), RESERVED_CONFIG_KEYS, toTomlValue(), acquireBrowserLock(), appendBounded(), atomicJson(), main() (+3 more)

### Community 86 - "Run Action Policy & Wakeup Claim"
Cohesion: 0.22
Nodes (8): RunActionPolicy, Injectable, isRunAction(), RunWakeupClaimService, lockingQuery(), serviceFor(), Inject, Injectable

### Community 87 - "Schema Validator Service"
Cohesion: 0.22
Nodes (5): EXPECTED_KEYS, normalizeAjvPath(), SchemaValidatorService, SchemaViolation, Injectable

### Community 89 - "Memory Invalidation Closure"
Cohesion: 0.24
Nodes (10): ActiveExecutionRead, AffectedItem, computeInvalidationClosure(), markInvalid(), markWholeStage(), memoryVersionKey(), MemoryVersionWriter, nodeKey() (+2 more)

### Community 90 - "Theme Provider & App Root"
Cohesion: 0.19
Nodes (10): App(), ThemeProvider(), Toaster(), TooltipProvider(), apps_web_src_index, queryClient, root, next-themes (+2 more)

### Community 91 - "Blueprint Canvas Page Design"
Cohesion: 0.19
Nodes (13): Phase 9.5: Visual Graph Canvas, Phase 9: Editor & Templates, BlueprintCanvasPage, Fixed sequential trunk layout, no auto-layout, Client-side memory-writer lookup, No-code mandate (no JSON textarea), Ref → visual element mapping, React Flow adoption rationale (+5 more)

### Community 92 - "Blueprint Version DTOs"
Cohesion: 0.17
Nodes (11): BlueprintVersionDto, CreateBlueprintDto, CreateBlueprintVersionDto, RoleDef, ComputeSpec, CostEstimate, JobHandle, JobStatus (+3 more)

### Community 93 - "Template Requires/Counts"
Cohesion: 0.30
Nodes (7): apps_api_src_db_schema_index_template, apps_api_src_db_schema_index_templateversion, template, templateVersion, HELLO_STAGE_GRAPH, EMPTY_REQUIRES, TemplateRequires

### Community 94 - "Ledger & Run Orchestrate Design"
Cohesion: 0.20
Nodes (12): Budget Ledger (requirements), Fan-Out, Reserve-then-reconcile budget model, LedgerService, Locked decision: one Inngest function stays per-stage entry point, run.orchestrate Inngest function, stage.execute step, ConfigResolverService.resolveRunConfig (+4 more)

### Community 95 - "JSON Schema & Media Constraints"
Cohesion: 0.23
Nodes (6): JsonSchema, MediaConstraints, OutputDef, OutputInstructions, ByteRange, PutResult

### Community 96 - "Timeline-Composition TS Config"
Cohesion: 0.17
Nodes (11): compilerOptions, isolatedModules, jsx, lib, module, moduleResolution, noEmit, target (+3 more)

### Community 97 - "API Dev Dependencies"
Cohesion: 0.18
Nodes (11): devDependencies, drizzle-kit, @inngest/test, @nestjs/cli, @nestjs/testing, tsx, @types/express, @types/node (+3 more)

### Community 98 - "Reservation & Ledger Helpers"
Cohesion: 0.20
Nodes (5): ReservationCategory, ReserveResult, seedAttempt(), seedRun(), packages_shared_dist_index_ledgerentrycategory

### Community 99 - "Acceptance TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, declaration, declarationMap, outDir, rootDir, sourceMap, extends (+2 more)

### Community 100 - "Checks Editor UI"
Cohesion: 0.18
Nodes (5): ChecksEditor(), remove(), nextFreeKey(), RefsEditor(), add()

### Community 101 - "Requirements: Core Entities"
Cohesion: 0.24
Nodes (11): Artifact (requirements), Blueprint (requirements), Channel, Check (requirements), Config Inheritance (Channel→Blueprint→Stage), Dependency Graph & Invalidation, QC Agent, Run (requirements) (+3 more)

### Community 102 - "Acceptance Codex Workspace Design"
Cohesion: 0.20
Nodes (11): Async job lifecycle (estimate→submit→poll→fetch→cancel), OpenRouter adapter (BYOK), Provider Adapter Contract, Reproducibility & Audit levels, acceptance:codex script, Manual BrowserOS acceptance procedure, WORKSPACE_ROOT/codex-jobs directory, codex provider (text.generate adapter) (+3 more)

### Community 103 - "Character Controller Tests"
Cohesion: 0.20
Nodes (8): row, packages_shared_dist_index_confirmcharacterreferencedto, packages_shared_dist_index_createcharacterdto, packages_shared_dist_index_promotecharacterreferencedto, packages_shared_dist_index_requestcharacterreferenceuploaddto, packages_shared_dist_index_setprimarycharacterreferencedto, packages_shared_dist_index_updatecharacterdto, packages_shared_dist_index_updatecharacterreferencedto

### Community 105 - "Test TS Config"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, declaration, declarationMap, noEmit, rootDir, extends, include (+1 more)

### Community 106 - "Phase 6/7 Acceptance Design"
Cohesion: 0.20
Nodes (10): Executor, Phase 6: Assembly, Phase 7: Iteration, Phase 8: Characters, acceptance:phase6-render script, ComputeJobService (durable compute-job directories), human.timeline_edit stage, subtitles.export (SRT/WebVTT) (+2 more)

### Community 107 - "API Bootstrap Helpers"
Cohesion: 0.39
Nodes (8): apiEntry, assert(), http(), main(), port, startApi(), stopApi(), waitFor()

### Community 108 - "Iterate Binding Resolver Design"
Cohesion: 0.22
Nodes (9): BindingResolverService, BlueprintValidatorService (iterate rules), iterate field (StageDef.iterate), prevItem carry with derived frames, Run Memory indexed groups (key#i aggregation), stage_attempt.stageItemId, stage_item table, parseValidationPath() utility (+1 more)

### Community 109 - "Source Type Resolution"
Cohesion: 0.46
Nodes (7): resolveBoundType(), sourceTypeOfInputAccepts(), sourceTypeOfOutput(), sourceTypeOfRef(), SourceTypeResult, unresolved(), narrowRefPath()

### Community 110 - "Run State Service"
Cohesion: 0.32
Nodes (4): buildRunOrchestrateFunction(), RunStateService, Inject, Injectable

### Community 111 - "API TS Config"
Cohesion: 0.25
Nodes (7): compilerOptions, baseUrl, outDir, rootDir, extends, include, ../../tsconfig.base.json

### Community 112 - "Render-Worker TS Config"
Cohesion: 0.25
Nodes (7): compilerOptions, jsx, outDir, rootDir, extends, include, ../../tsconfig.base.json

### Community 113 - "Type Dev Dependencies"
Cohesion: 0.25
Nodes (8): devDependencies, @types/node, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react, vitest

### Community 114 - "Nest CLI Config"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, tsConfigPath, $schema, sourceRoot

### Community 115 - "Timeline Handle Service"
Cohesion: 0.48
Nodes (4): RefProvenance, relativeHandle(), TimelineHandleService, Injectable

### Community 116 - "Timeline Resource Resolver Service"
Cohesion: 0.29
Nodes (4): ResolvedBindings, TimelineResourceResolverService, Inject, Injectable

### Community 117 - "Timeline Gap/Aspect Helpers"
Cohesion: 0.29
Nodes (6): failed(), findGaps(), itemEnd(), maxTrackEnd(), parseAspect(), passed()

### Community 118 - "Build TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, composite, incremental, exclude, extends, ./tsconfig.json

### Community 119 - "Item-Level Invalidation Design"
Cohesion: 0.29
Nodes (7): phase7-broll.e2e.test.ts Acceptance Scenario, ensureStageItems Self-Consistency Guard, Item-Level Invalidation Closure ((stageKey,itemIndex) nodes), Item-Mode Approval, iterate.over Invalidation Provenance Fix, HIGH Finding: iterate.over Provenance Never Recorded, PR #17 — Phase 7 Iteration

### Community 120 - "Shared Package TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json

### Community 121 - "Artifact Attachment Service"
Cohesion: 0.33
Nodes (3): ArtifactAttachmentService, Inject, Injectable

### Community 122 - "Iterating Stage Loop Drivers"
Cohesion: 0.53
Nodes (4): driveUntilPauseOrDone(), driveIteratingLoop(), driveIteratingLoop(), driveAllItemsToPassed()

### Community 123 - "Web Package Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, preview, test, typecheck

### Community 124 - "Params Editor UI"
Cohesion: 0.33
Nodes (3): nextFreeKey(), ParamsEditor(), add()

### Community 125 - "Requirements: Character/LoRA"
Cohesion: 0.40
Nodes (6): Character (requirements), Channel-owned Character asset, Immutable run snapshot (role binding), LoRA training deferred, Readiness gate / run start revalidation, Reference upload/promotion to Character namespace

### Community 127 - "Provider Module Bootstrap"
Cohesion: 0.40
Nodes (3): ProviderModule, Module, makeRunner()

### Community 128 - "Run Service Test Helpers"
Cohesion: 0.60
Nodes (4): makeListService(), makeService(), queryChain(), updateQuery()

### Community 129 - "Template Seed Service"
Cohesion: 0.40
Nodes (3): TemplateSeedService, Inject, Injectable

### Community 131 - "PR #19 Post-Review Fixes"
Cohesion: 0.50
Nodes (4): PR #19 Post-Review Fixes, MEDIUM: CapabilityController.resolve() Uncaught Throw, MEDIUM: /templates/:id/instantiate Missing Zod Validation, PR #19 — Phase 9 Editor & Templates

### Community 132 - "Prettier Config"
Cohesion: 0.50
Nodes (3): printWidth, singleQuote, trailingComma

### Community 133 - "Global Config Module"
Cohesion: 0.67
Nodes (3): ConfigModule, Module, Global

## Knowledge Gaps
- **625 isolated node(s):** `singleQuote`, `trailingComma`, `printWidth`, `$schema`, `collection` (+620 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1135 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@nestjs/common` connect `Provider Adapters (ElevenLabs/Fal/OpenRouter)` to `Blueprint/Channel/Run Core Services`, `Media Artifacts & Timeline Resources`, `Artifact Recording Services`, `Run Wakeup & Human-Wait Services`, `Codex Provider Adapter`, `Capability Config & Media Descriptors`, `Capability Registry & Style Registry`, `Stage/Timeline Check Services`, `Codex Launch & Status Files`, `Blueprint Validator Service`, `Stage Attempt Loop`, `Env & Bucket Bootstrap`, `In-Process Run Events (SSE)`, `QC Envelope/Runner/Verdict`, `Nest Domain Modules`, `Preview Token Service`, `Asset Controller/Service`, `Nest Modules (Blueprint/Capability/Channel)`, `Check Controller & Test Service`, `Blob Controller & Zod Pipe`, `Script Sandbox Service`, `API Package Manifest`, `Check Runner & Ref Envelope`, `Character Service`, `Nest Test App Bootstrap`, `Schema Validator Service`, `Template Requires/Counts`, `Reservation & Ledger Helpers`, `Character Controller Tests`, `Timeline Handle Service`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `iterate field (StageDef.iterate)` connect `Iterate Binding Resolver Design` to `Memory Invalidation Closure`, `Phase 6/7 Acceptance Design`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **What connects `singleQuote`, `trailingComma`, `printWidth` to the rest of the system?**
  _625 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Blueprint/Channel/Run Core Services` be split into smaller, more focused modules?**
  _Cohesion score 0.061764705882352944 - nodes in this community are weakly interconnected._
- **Should `Blueprint Editor Binding & Validation UI` be split into smaller, more focused modules?**
  _Cohesion score 0.045177045177045176 - nodes in this community are weakly interconnected._
- **Should `Media Artifacts & Timeline Resources` be split into smaller, more focused modules?**
  _Cohesion score 0.07757860711137232 - nodes in this community are weakly interconnected._
- **Should `Provider Adapters (ElevenLabs/Fal/OpenRouter)` be split into smaller, more focused modules?**
  _Cohesion score 0.06070175438596491 - nodes in this community are weakly interconnected._