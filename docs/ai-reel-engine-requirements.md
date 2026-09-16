# AI Reel Generator Engine — Requirements Document

Status: Draft v1
Scope: Requirements only. Architecture, data schemas, and APIs are covered in the follow-on design spec.

---

## 0. Purpose

An engine for producing AI-generated video reels the way a game engine produces games: the engine provides the primitives (execution, artifacts, cost control, QC), and the user configures **Blueprints** — reusable, versioned recipes made of **Stages** — to produce any type of reel, for any Channel, with any mix of models and providers.

This document defines *what the system must do*. It intentionally leaves out storage schemas, APIs, and UI layout.

---

## 1. Core Concepts & Naming

The term "workflow" is split into two concepts to remove ambiguity:

- **Blueprint** — a reusable, versioned definition of a pipeline: an ordered sequence of Stages, their configuration, budgets, and dependency graph. Not tied to any single execution.
- **Run** — one execution of a specific Blueprint version. Owns its own artifacts, logs, budget ledger, and state.

A **Channel** owns Blueprints, Characters, and Runs, and represents a theme/genre/identity (e.g. "Daily Stoic Podcast Clips").

---

## 2. Entities

### 2.1 Channel
- REQ-2.1.1: A Channel has a name, theme/genre metadata, and default configuration (default models, default budgets) inherited by its Blueprints.
- REQ-2.1.2: A Channel owns zero or more Characters (scope: channel).
- REQ-2.1.3: A Channel owns one or more Blueprints.
- REQ-2.1.4: A Channel owns the history of all Runs executed against its Blueprints.

### 2.2 Character
- REQ-2.2.1: A Character is a persistent identity asset: reference images/sheet, canonical text description, and an optional LoRA (or equivalent conditioning asset).
- REQ-2.2.2: A Character has a `scope`: `channel` (reusable across Blueprints) or `blueprint` (local to one Blueprint).
- REQ-2.2.3: Variable attributes (wardrobe, hairstyle, expression) are **not** part of the Character asset — they are per-Run artifacts produced by Stages and layered onto the Character at generation time.
- REQ-2.2.4: A Blueprint declares abstract **roles** (e.g. "Host", "Guest"), not concrete Characters.
- REQ-2.2.5: A Run binds each declared role to a concrete Character at start time; the binding is snapshotted into the Run and does not change if the Character asset is later edited.
- REQ-2.2.6: Zero roles is a valid, first-class configuration (faceless/characterless reels).

### 2.3 Blueprint
- REQ-2.3.1: A Blueprint is an ordered, sequential list of Stage configurations plus a declared dependency graph (which Stage consumes which prior Stage's artifact(s)).
- REQ-2.3.2: A Blueprint is **immutable per version**. Editing a Blueprint creates a new version (v+1); existing Runs remain pinned to the version they started on.
- REQ-2.3.3: A Blueprint declares its budget caps (see §8), its role list (see §2.2), and its config inheritance defaults (see §13).
- REQ-2.3.4: A Blueprint is authored via a UI-backed editor and stored as database records (not files-in-repo).
- REQ-2.3.5: The Blueprint editor validates on save (see §14) — dangling inputs, type mismatches, and unbound roles must be caught before a Run can be started, not discovered mid-execution.

### 2.4 Stage
- REQ-2.4.1: A Stage is a named node in a Blueprint referencing exactly one **Executor**, plus: its input bindings (which upstream artifacts it consumes), its configuration (model, prompt template, executor-specific params), its Checks, its QC configuration (if any), its budget cap, its retry limit, and whether it requires human approval before advancing.
- REQ-2.4.2: There is no fixed taxonomy of Stage "types." Behavior is entirely driven by which Executor a Stage references and how it's configured. (Applies uniformly to generative, deterministic/code, human-approval, and fan-out stages.)
- REQ-2.4.3: A Stage's declared inputs and outputs must conform to the schema exposed by its Executor.

### 2.5 Executor
- REQ-2.5.1: An Executor is a registered capability (e.g. `llm.generate_text`, `image.generate`, `video.image_to_video`, `tts.synthesize`, `video.join_clips`, `timestamps.align_to_audio`, `human.approve`, `publish.platform_x`).
- REQ-2.5.2: Every Executor declares: input schema, output schema, modality, whether it's synchronous or asynchronous, its cost model (see §8), and whether QC is applicable to its output.
- REQ-2.5.3: Executors are the extension point — adding a new capability to the engine means registering a new Executor, not modifying the engine core.
- REQ-2.5.4: All Executors that call an external provider implement a uniform async job lifecycle: `estimate → submit → poll → fetch → cancel`. Synchronous providers (e.g. a fast text completion) resolve on the first poll. This is required so text, image, video, and audio providers share one execution model despite wildly different latencies.

### 2.6 Check
- REQ-2.6.1: A Check is a deterministic, code-level validation run against a Stage's output before QC runs. Examples: word count, WPM, duration bounds, schema conformance, regex match, file format/codec validation.
- REQ-2.6.2: Checks are authored against a fixed library of parameterized check types (word count, WPM, duration, regex, schema, numeric range, etc.) in v1. A sandboxed custom-code check type is a planned extension, not required for v1.
- REQ-2.6.3: All Check types conform to one contract regardless of authoring method: `(artifact, params) → pass/fail + message`. This contract must not change when custom-code checks are added later.
- REQ-2.6.4: A Stage may have zero or more Checks. All Checks must pass before the artifact proceeds to QC.

### 2.7 QC Agent
- REQ-2.7.1: QC is an LLM-based judge invoked after Checks pass, evaluating a Stage's output against user-specified requirements for that Stage.
- REQ-2.7.2: QC operates on a restricted **context envelope**: the Stage's output artifact, the user-specified acceptance criteria for that Stage, and the Stage's *declared* inputs. It must never see the Stage's prompt, the Stage's internal reasoning, or prior QC verdicts for this artifact.
- REQ-2.7.3: QC verdict shape is a numeric score (0–100) against a configurable pass threshold, plus a written critique.
- REQ-2.7.4: Because QC does not see prior attempts, the *Stage* (not QC) is responsible for accumulating prior critiques across retries and feeding them into the next generation attempt, to avoid oscillating failures.
- REQ-2.7.5: The QC model and its sampling temperature must be pinned per Stage configuration, to keep the pass threshold meaningful across retries.
- REQ-2.7.6: For fan-out Stages, QC applies per-item only in v1 (see §5).

### 2.8 Run
- REQ-2.8.1: A Run is one execution of a specific Blueprint version, scoped to a Channel, with role bindings resolved to concrete Characters.
- REQ-2.8.2: A Run owns its own Artifact set, its own Budget Ledger, and its own execution log.
- REQ-2.8.3: A Run's Stages execute strictly sequentially (no parallel branches in v1). The only concurrency in the system is inside fan-out Executors.
- REQ-2.8.4: A Run is durable — its state survives UI disconnect and server restart. The UI is a view over Run state, not the driver of it.

### 2.9 Artifact
- REQ-2.9.1: An Artifact is the versioned, immutable output of a Stage execution (or a Check/QC verdict, or a manual edit).
- REQ-2.9.2: Artifacts are never hard-deleted. A superseded Artifact is marked **stale** and excluded from the active dependency graph, but remains readable for audit.
- REQ-2.9.3: Media blobs (video/audio/image files) belonging to stale Artifacts are eligible for garbage collection after a configurable retention window. Metadata, logs, prompts, and QC verdicts are retained indefinitely regardless of blob GC.
- REQ-2.9.4: Every Artifact records: which Stage/Executor produced it, its inputs, full provider request/response (or a reference to it), cost incurred, Check results, QC verdict, and a reproducibility level (see §15).

### 2.10 Budget Ledger
- See §8.

---

## 3. Stage & Executor Contract

- REQ-3.1: Every Stage execution follows: resolve inputs → check budget → submit to Executor → (poll if async) → fetch output → run Checks → run QC (if configured) → on pass, produce a final Artifact and advance; on fail, retry per §9.
- REQ-3.2: A Stage's input bindings are explicit — a Stage declares exactly which upstream Artifact(s) it reads, by Stage reference. This is what makes dependency-based invalidation (§4) possible.
- REQ-3.3: A Stage may be flagged to require human approval before its output is considered final, independent of whether Checks/QC passed.

---

## 4. Dependency Graph, Versioning & Invalidation

- REQ-4.1: The Blueprint's dependency graph is derived from Stages' declared inputs, not from Stage position/order. A Stage may consume any upstream Stage's artifact, not only its immediate predecessor (e.g. a wardrobe decision at Stage 3 consumed by clip generation at Stage 8).
- REQ-4.2: Retrying or manually editing a Stage's output marks that Artifact stale and walks the dependency graph forward, marking every artifact that transitively consumed it as stale.
- REQ-4.3: Before invalidation is applied, the user is shown a preview: which artifacts will be marked stale, what was spent producing them, and an estimate of what re-running them would cost.
- REQ-4.4: Stale artifacts are never hard-deleted (REQ-2.9.2). The user may, in principle, manually re-link a stale artifact back into the active graph (future extension; not required for v1 execution logic, but the data model must not preclude it).
- REQ-4.5: A user-edited Artifact is validated against its Executor's output schema (a type/shape check) before being accepted, but does **not** re-run Checks or QC — the user's edit is authoritative.

---

## 5. Fan-Out

- REQ-5.1: A Stage may be configured as a fan-out Stage, meaning its Executor produces N sub-items (e.g. N scene clips) from one input, each executed and tracked independently.
- REQ-5.2: Each fan-out item has its own retry counter, its own cost tracking, and its own Check/QC evaluation (per-item QC in v1; whole-set QC is a future extension).
- REQ-5.3: Fan-out failure handling is **continue-and-isolate**: a failing item is retried independently up to its retry limit; sibling items are not blocked or discarded by one item's failure.
- REQ-5.4: If any fan-out item exhausts its retry limit, the Run enters FAILED state (§9) with all successfully completed sibling items preserved as valid Artifacts.
- REQ-5.5: Fan-out concurrency (parallelism cap) is configurable per Stage to respect provider rate limits and budget reservation granularity (§8).

---

## 6. Quality Control

Covered in §2.7. Summary of key requirements:
- QC is independent/context-limited (REQ-2.7.2), not context-free.
- Verdict is score + critique (REQ-2.7.3).
- Prior critiques are accumulated by the Stage across retries, not by QC (REQ-2.7.4).

---

## 7. Checks

Covered in §2.6.

---

## 8. Budget & Cost Control

- REQ-8.1: Budget caps are configurable at two levels: per-Stage and per-Run. (Channel-level and monthly caps are out of scope for v1, flagged as a future extension.)
- REQ-8.2: All spend counts against budget, including Check execution (if a Check itself calls a model), QC calls, and every retry attempt — not only the "final" successful Stage output.
- REQ-8.3: Budget enforcement uses a **reserve-then-reconcile** model: before an Executor call is submitted, its estimated cost is reserved against the remaining budget; on completion, the reservation is trued up to actual cost. This applies per-item in fan-out Stages, so parallel calls cannot collectively overshoot the cap before any single check fires.
- REQ-8.4: If a reservation would exceed the Stage or Run budget cap, the call is blocked before submission, the Run pauses, and the user is notified with the option to raise the budget and continue, or cancel the Run.
- REQ-8.5: Every Executor must expose a cost estimate (from its `estimate` call in the adapter lifecycle, REQ-2.5.4) sufficient to support REQ-8.3. Where a provider cannot estimate in advance, the Executor must supply a configured worst-case ceiling to reserve against.

---

## 9. Run Lifecycle / State Machine

- REQ-9.1: A Run has at minimum the following states: `RUNNING`, `PAUSED_BUDGET`, `PAUSED_APPROVAL`, `FAILED`, `COMPLETED`, `CANCELLED`.
- REQ-9.2: `FAILED` is a recoverable state, not terminal by default: all artifacts up to the failure point are preserved, and the user may edit the failing Stage's configuration and resume execution from that point, rather than restarting the Run.
- REQ-9.3: A Stage retries automatically, up to a configurable per-Stage retry limit, when it fails Checks or QC.
- REQ-9.4: When a Stage's retry limit is exhausted, the Run transitions to `FAILED` at that Stage (per REQ-9.2, resumable after user intervention).
- REQ-9.5: A Stage flagged for human approval transitions the Run to `PAUSED_APPROVAL` after producing a passing Artifact, and does not advance until the user approves, requests a retry, or edits the output.

---

## 10. Human-in-the-Loop

- REQ-10.1: The user may retry any Stage in a completed or in-progress Run at any time, subject to §4 invalidation rules.
- REQ-10.2: The user may manually edit any Artifact (REQ-4.5), which is treated identically to a retry for invalidation purposes (REQ-4.2).
- REQ-10.3: The user may configure any Stage to require approval before the Run advances past it (REQ-3.3, REQ-9.5).
- REQ-10.4: On `PAUSED_BUDGET`, the user must be able to approve additional spend, adjust the budget cap, or cancel the Run — the Run must not silently resume or silently die.

---

## 11. Characters & Consistency

- REQ-11.1: The consistency mechanism for v1 is reference-image conditioning plus an optional per-Character LoRA (§2.2).
- REQ-11.2: The practical generation path is: generate a consistency-conditioned keyframe image (using the Character's reference/LoRA), then animate via image-to-video. This constrains which video Executors/providers are usable and should be treated as the default pipeline shape for any character-bearing clip Stage.
- REQ-11.3: Per-Run variable attributes (wardrobe, hairstyle, prop, expression) are produced by ordinary Stages as artifacts and passed into the clip-generation Executor alongside the Character's fixed identity data — they are never baked into the Character asset itself.
- REQ-11.4: Faceless/characterless Runs simply bind zero roles; no part of the pipeline should hard-require a Character to exist.

---

## 12. Timestamps & Captions

- REQ-12.1: Timestamp generation is provided as Executors, not a fixed pipeline position, so a Blueprint author chooses when/how to use them:
  - `timestamps.estimate_from_script` — WPM-based estimate, usable before audio exists (e.g. for planning scene boundaries).
  - `timestamps.align_to_audio` — forced alignment against actual synthesized voiceover audio, for accurate captions.
- REQ-12.2: A Blueprint may use either or both; the design spec should note that caption accuracy depends on using alignment against real audio rather than the pre-TTS estimate.

---

## 13. Config Inheritance

- REQ-13.1: Configuration resolves as Channel defaults → Blueprint overrides → Stage overrides, nearest scope wins.
- REQ-13.2: This applies to at least: default LLM/provider model selection, default budget caps, and default retry limits.

---

## 14. Blueprint Authoring & Versioning

- REQ-14.1: Blueprints are authored and edited via UI, persisted as database records (REQ-2.3.4).
- REQ-14.2: Blueprints are immutable per version (REQ-2.3.2); there is no separate file-based or git-based authoring path in v1.
- REQ-14.3: Save-time validation must check: every Stage's declared inputs are produced by some upstream Stage, artifact types match between producer and consumer, every role referenced by a character-bearing Stage is declared at the Blueprint level, and every Executor reference is valid and configured with its required parameters.
- REQ-14.4: Because there is no external version-control system, the immutable version chain is the authoritative audit trail for Blueprint changes over time.

---

## 15. Reproducibility & Audit

- REQ-15.1: Every Artifact is tagged with a reproducibility level: `exact` (seed + pinned model version captured and provider supports deterministic replay), `approximate` (model version pinned, no seed available), or `none` (provider gives no reproducibility guarantees).
- REQ-15.2: Model versions are pinned per Stage configuration at Run start (not "latest") to keep this meaningful.
- REQ-15.3: Every Stage execution is logged with full input, output, provider request/response reference, cost, and Check/QC results (REQ-2.9.4), sufficient for the user to audit and manually improve the Blueprint.

---

## 16. Provider Adapter Contract

- REQ-16.1: All external providers (text, image, video, TTS, music, alignment) are accessed through one uniform adapter interface implementing the async job lifecycle: `estimate → submit → poll → fetch → cancel` (REQ-2.5.4).
- REQ-16.2: OpenRouter (BYOK) is one adapter implementation under this interface, covering text and some image modalities. It is not the foundation of the provider layer — video, TTS, music, and alignment require separate adapter implementations against their respective providers.
- REQ-16.3: Where a provider's model/price list is queryable via API (as OpenRouter's is), the adapter should expose it to support cost estimation (REQ-8.5); where it isn't, cost must be configured manually per model.

---

## 17. Deployment & Platform Scope

- REQ-17.1: v1 is a **single-user local web application**: browser-based UI talking to a local server process.
- REQ-17.2: No auth, multi-tenant isolation, or per-user storage quotas are required in v1.
- REQ-17.3: To avoid a future rewrite, the following seams must exist even in the single-user build: an `owner` field on Channel (unused but present), storage paths namespaced by owner/channel, provider API key retrieval behind an interface (not hardcoded), and no global mutable state inside Executors.
- REQ-17.4: Because Stages include long-running async jobs (video generation), the server must run a durable job loop independent of any single browser session (REQ-2.8.4).

---

## 18. Explicit Non-Goals (v1)

- Multi-tenant auth, billing, or user isolation (deferred, seams reserved per §17.3).
- Publishing to external platforms (Executor slot reserved per REQ-2.5.1 example list; not implemented).
- Parallel/branching Stage execution within a Run (only fan-out concurrency exists, §5).
- Whole-set QC for fan-out Stages (per-item only, REQ-2.7.6).
- Sandboxed custom-code Checks (fixed check library only, REQ-2.6.2).
- Channel-level and monthly budget caps (Stage/Run only, REQ-8.1).
- Manual re-linking of stale artifacts into the active graph (data model allows it; not required to build in v1, REQ-4.4).
- File/git-based Blueprint authoring (DB-backed only, REQ-14.2).

---

## 19. Assumptions Log

Points where a default was chosen on the user's behalf during requirements gathering, flagged here for explicit review:

- Reserve-then-reconcile budget enforcement (§8.3–8.4) was recommended over pure post-hoc tracking due to fan-out overshoot risk; accepted.
- Universal provider adapter (§16) assumed to be shaped around the async job lifecycle, not a flat synchronous call, since video/audio cannot be expressed otherwise.
- QC verdict shape set to score + critique rather than plain pass/fail, to give retry prompts something to act on (REQ-2.7.3–2.7.4).
- Stale artifacts are soft-deleted with blob-only GC, not hard-deleted, to preserve the audit/improve-the-blueprint goal (REQ-2.9.2–2.9.3).

---

*Next phase: design specification — entity schemas, state machine diagrams, Executor registry format, API surface, and UI wireframes.*
