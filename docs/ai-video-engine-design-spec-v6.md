# AI Video Engine — Design Specification

Status: v6 — Implementation baseline
Supersedes: *AI Reel Generator Engine — Design Specification (Draft v4)*
Scope: System architecture, data model, execution model, and contracts.

Section references (§N) are internal. Requirement references are prefixed REQ-; §27 lists amendments the requirements document needs.

---

## 0. What Changed and Why

v4 described a reel generator with reel-shaped stages baked into the engine. v5 is a general video engine: the engine ships a small fixed set of **capabilities**, and every video type is a **Blueprint** of user-defined **Stages**. No stage is built in. A workflow may contain no script stage, no timeline stage, no anything in particular.

Alongside generalization, v5 adopts a deliberately simpler execution model than v4 and its review rounds argued for. Stated plainly so it reads as a decision rather than drift:

| v4 / review position | v5 decision |
|---|---|
| Parallel fan-out with per-modality concurrency | **Nothing executes in parallel**, ever — not stages, not items |
| A stage may bind any earlier stage | **A stage binds only the previous stage**, plus Run Memory, inputs, and assets |
| Declared dependency graph | **No declared graph**; dependents are computed from what each attempt actually read |
| QC available on any output | **QC forbidden on video output**; human approval replaces it |

The engine becomes smaller and slower and trusts the user to sequence correctly. What it gives up is cost preview for indirect dependents and automatic staleness across Run Memory. §26 records the consequences.

---

## 1. Stack & Deployment

| Concern | Choice |
|---|---|
| Language | TypeScript, end to end |
| Backend | NestJS (Express platform) |
| Frontend | React + Vite, separate SPA |
| Database | Postgres (Docker) |
| ORM / migrations | Drizzle |
| Orchestration | Inngest, self-hosted |
| Blob storage | MinIO (S3-compatible) behind `StorageAdapter` |
| Engine-owned validation | Zod |
| User-defined schema validation | JSON Schema via Ajv (restricted dialect, §4.2) |
| Check sandbox | QuickJS (WebAssembly) |
| Renderer | Remotion, behind a `Renderer` interface, ffmpeg fallback |

### 1.1 Monorepo

```
apps/
  api/                  # NestJS
  web/                  # React + Vite
packages/
  shared/               # Zod schemas: StageDef, Ref, Timeline, ConfigLayer,
                        # capability config schemas, API DTOs, enums
```

`shared` imports nothing from `api` or `web` and performs no I/O. It is load-bearing: the Blueprint editor generates config forms by introspecting capability schemas (§21), so those schemas must be one definition. Every primitive type referenced throughout this document — `JobHandle`, `ModelPin`, `Modality`, and the rest — has its canonical shape in Appendix A, and that appendix is what `packages/shared` should encode as its first commit.

### 1.2 Processes

1. **API** — NestJS on `:3000`. REST, SSE, `POST /api/inngest`.
2. **Web** — Vite on `:5173`, proxying `/api`. Production builds to static files served by Nest.
3. **Postgres** — `:5432`.
4. **MinIO** — `:9000` API, `:9001` console.
5. **Inngest** — `inngest start` on `:8288`, pointed at a **separate Postgres database** from the engine's own.

Use `inngest start`, not `inngest dev` — the Dev Server's state is ephemeral and a mid-flight video job would not survive a restart.

### 1.3 Nest modules

```
AppModule
├── ConfigModule        (global)
├── DbModule            (global)
├── StorageModule                  StorageAdapter, WorkspaceService, ComputeJobService
├── ProviderModule                 adapter registry, KeyProvider, FakeProviderAdapter
├── CapabilityModule               @Capability()-decorated providers + CapabilityRegistry
├── ArtifactModule                 ArtifactService, BlobService, BindingResolver, MemoryService
├── CheckModule                    builtin registry, ScriptCheckSandbox, CheckRunner
├── QcModule                       QcRunner, QcEnvelope
├── BudgetModule                   LedgerService
├── OrchestrationModule            Inngest client, function factory, RunStateService
├── ChannelModule                  Channel, Character, Asset
├── BlueprintModule                versions, ConfigResolver, BlueprintValidator
├── TemplateModule                 template library (§20)
└── RunModule                      lifecycle, retry/approve/input/edit/resume, SSE
```

`CapabilityModule` may inject `ProviderModule` and `StorageModule`. It may **not** inject `RunModule`, `BlueprintModule`, or `DbModule` — capabilities receive a prepared context and have no database access. Enforce by withholding those providers from its DI visibility, so a violation fails at startup rather than in review.

### 1.4 Serving

Dev: Vite proxies `/api`, single origin. Production: Nest serves the built SPA via `ServeStaticModule`. App CORS stays off. MinIO is a deliberate second origin for presigned blob access (§21.3).

---

## 2. Architecture and the Layering Rule

```
┌──────────────────────────────────────────────────────┐
│  apps/web — React SPA                                │
│  Blueprint editor · Run viewer · Artifact inspector  │
└──────────────┬───────────────────────────────────────┘
               │ REST + SSE (shared DTOs)
┌──────────────▼───────────────────────────────────────┐
│  apps/api — NestJS                                   │
│  Controllers · /api/inngest · Domain modules         │
│  ┌────────────────────────────────────────────────┐  │
│  │ Engine Core                                    │  │
│  │  Capability Registry · Binding Resolver ·      │  │
│  │  Run Memory · Config Resolver · Check Runner · │  │
│  │  QC Runner · Budget Ledger · Invalidation ·    │  │
│  │  Validator · Template Library                  │  │
│  └──────┬──────────────────────┬──────────────────┘  │
│  ┌──────▼────────┐    ┌────────▼──────────────────┐  │
│  │ Provider      │    │ Artifact Store            │  │
│  │ Adapters      │    │ (Postgres + MinIO)        │  │
│  └──────┬────────┘    └───────────────────────────┘  │
└─────────┼────────────────────────────────────────────┘
          │                    ▲
   ┌──────▼──────┐      ┌──────┴──────┐
   │ OpenRouter  │      │  Inngest    │
   │ fal / etc.  │      │  :8288      │
   └─────────────┘      └─────────────┘
```

**Layering rule.** Engine Core knows Capabilities, Stages, Artifacts, Bindings, Schemas, Run Memory, Config, Budget, and the Run state machine. It knows nothing about scripts, scenes, wardrobes, reels, explainers, or any video genre. Genre knowledge lives only in Blueprints and Templates.

### 2.1 Capability vs Stage

- **Capability** — a fixed, code-registered thing the engine can *do*: generate structured data with an LLM, generate an image, generate video, synthesize speech, analyze media, concatenate, render a timeline, ask a human. Small set, changes rarely.
- **Stage** — a user-defined unit of work. It picks one capability and supplies input bindings, instructions, an output schema, checks, and QC.

New video types are new Blueprints, never new code. A new capability is added only when a genuinely new *kind of operation* appears — lip-sync, say.

### 2.2 The stage boundary

A stage is one bounded operation producing one output: a single call, or a single provider job, or one iteration of those. It may retry semantically. It does **not** run an open-ended tool loop (§2.3). Agency comes from LLM stages producing plans that later stages consume, where the plan is inspectable, checkable, hand-editable, and priced before anything expensive runs.

### 2.3 Why not tool-loop agents

An agent that decides its own next action cannot be priced before it runs, cannot be validated before it runs, and produces a different stage sequence every time — which makes retry, invalidation, and reproducibility undefined. Every guarantee in this document derives from the stage sequence being known before execution starts. A capability may call a provider that internally uses tools; the engine's own unit of work stays bounded.

---

## 3. Data Model

Drizzle/Postgres. IDs are `text` ULIDs.

### 3.1 Channel

```sql
channel (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL DEFAULT 'local',   -- multi-tenant seam
  name        text NOT NULL,
  theme       jsonb NOT NULL DEFAULT '{}',
  defaults    jsonb NOT NULL DEFAULT '{}',     -- ConfigLayer (§5)
  created_at  timestamptz NOT NULL DEFAULT now()
)
```

### 3.2 Character

```sql
character (
  id             text PRIMARY KEY,
  owner_id       text NOT NULL DEFAULT 'local',
  channel_id     text REFERENCES channel(id),
  blueprint_id   text REFERENCES blueprint(id),
  scope          text NOT NULL,                 -- 'channel' | 'blueprint'
  name           text NOT NULL,
  description    text NOT NULL,
  reference_set  jsonb NOT NULL DEFAULT '[]',   -- ReferenceImage[]
  primary_ref_id text,
  lora           jsonb,
  readiness      text NOT NULL DEFAULT 'draft', -- draft | ready
  created_at     timestamptz NOT NULL DEFAULT now()
)
```

```ts
type ReferenceImage = {
  blobId: string;
  view: 'front' | 'three_quarter' | 'profile' | 'full_body' | 'expression' | 'detail';
  caption?: string;
  origin: 'uploaded' | 'generated';
  sourceArtifactId?: string;
  order: number;
};
```

`primary_ref_id` is explicit because most image models take one reference or a small number, and an implicit "first in array" rule degrades consistency silently when the set is reordered. `readiness` gates role binding (§18.3).

### 3.3 Asset

Reusable channel material with a lifetime longer than a run: logos, fonts, intro stings, LUTs, voice samples.

```sql
asset (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL DEFAULT 'local',
  channel_id  text NOT NULL REFERENCES channel(id),
  name        text NOT NULL,
  kind        text NOT NULL,      -- media.image | media.video | media.audio | font | lut
  blob_id     text NOT NULL REFERENCES blob(id),
  tags        text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, name)
)
```

### 3.4 Blueprint & BlueprintVersion

```sql
blueprint (
  id                  text PRIMARY KEY,
  channel_id          text NOT NULL REFERENCES channel(id),
  name                text NOT NULL,
  current_version_id  text,
  archived            boolean NOT NULL DEFAULT false
)

blueprint_version (
  id             text PRIMARY KEY,
  blueprint_id   text NOT NULL REFERENCES blueprint(id),
  version        integer NOT NULL,
  graph          jsonb NOT NULL,   -- StageDef[]
  inputs         jsonb NOT NULL DEFAULT '[]',   -- InputDef[] (§3.6)
  roles          jsonb NOT NULL DEFAULT '[]',   -- RoleDef[]; v1 permits 0 or 1 (§18.5)
  defaults       jsonb NOT NULL,   -- ConfigLayer
  budget         jsonb NOT NULL,   -- { runCapUsd }
  validation     jsonb NOT NULL,
  runnable       boolean NOT NULL DEFAULT false,
  source_template_id text,         -- provenance if instantiated (§20)
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blueprint_id, version)
)
```

`blueprint.current_version_id` and `blueprint_version.blueprint_id` form a cycle, resolved because the former is nullable: insert blueprint, insert version, update pointer. Drizzle will not infer this — declare `current_version_id` without an FK in the initial migration and add the constraint in a follow-up, and say so in the migration rather than omitting it silently.

The graph is one `jsonb` column: a version is an immutable atomic snapshot, never mutated and never queried stage-by-stage across versions. Runtime state is relational.

### 3.5 StageDef

```ts
type StageDef = {
  key: string;                          // stable, unique within blueprint
  label: string;
  capability: string;                   // registry key
  instructions?: { system?: string; template: string };   // §6.5
  config: Record<string, unknown>;      // capability-specific, Zod-validated
  slots: Record<string, Ref>;           // capability-declared, typed (§6.4)
  context: Record<string, Ref>;         // user-named, template-only (§6.4)
  writes?: Record<string, string>;      // memoryKey -> path into this output (§6.3)
  output: OutputDef;                    // §4.2
  iterate?: {
    over: Ref;                          // must narrow to an array
    itemAlias: string;
    alignWith?: 'item';                 // index-align with previous stage (§14.3)
    itemRetryLimit: number;
  };
  checks: CheckDef[];                   // §9
  qc?: QcDef;                           // §10 — forbidden when output is video
  retryLimit: number;
  approval?: {
    mode: 'stage' | 'item';                // 'item' only on iterating stages
    onReject?: { retryStageKey: string };  // default: this stage (§10.5)
  };
  budget?: { stageCapUsd?: number; qcCapUsd?: number };
  model?: Partial<ModelPin>;
  enabledWhen?: EnabledWhen;            // §16
};
```

`fanOut` from v4 is renamed **`iterate`**, because items no longer run in parallel — the stage loops in order and item *i* can consume item *i−1* (§14). `producesArray` is gone; array-ness comes from the output schema. `promptTemplate` moves out of `config` into `instructions` so the editor, validator, and QC envelope treat it uniformly.

### 3.6 InputDef

```ts
type InputDef = {
  key: string;
  label: string;
  required: boolean;
  accepts:
    | { kind: 'text' }
    | { kind: 'data'; schema: JsonSchema }
    | { kind: 'media.image' | 'media.video' | 'media.audio'; cardinality: 'one' | 'many' };
};
```

### 3.7 Run

```sql
run (
  id                   text PRIMARY KEY,
  channel_id           text NOT NULL REFERENCES channel(id),
  blueprint_version_id text NOT NULL REFERENCES blueprint_version(id),
  state                text NOT NULL,                  -- §12
  inputs               jsonb NOT NULL DEFAULT '{}',    -- values or blob ids
  role_bindings        jsonb NOT NULL DEFAULT '{}',    -- character snapshots
  resolved_config      jsonb NOT NULL,                 -- flattened ConfigLayer at start
  overrides            jsonb NOT NULL DEFAULT '{}',    -- sparse per-stage patch (§12.3)
  cursor_stage_key     text,
  inngest_run_id       text,
  budget_cap_usd       numeric(12,4) NOT NULL,
  reserved_usd         numeric(12,4) NOT NULL DEFAULT 0,
  spent_usd            numeric(12,4) NOT NULL DEFAULT 0,
  failure              jsonb,
  started_at           timestamptz NOT NULL DEFAULT now(),
  ended_at             timestamptz
)
```

`role_bindings` and asset refs store **full snapshots**, not foreign keys, so editing a Character or replacing a logo cannot retroactively change a past run.

### 3.8 StageExecution, StageItem, StageAttempt

```sql
stage_execution (
  id                 text PRIMARY KEY,
  run_id             text NOT NULL REFERENCES run(id),
  stage_key          text NOT NULL,
  state              text NOT NULL,   -- pending|running|awaiting_approval|awaiting_input
                                      -- |passed|failed|stale|skipped
  is_iterating       boolean NOT NULL DEFAULT false,
  item_count         integer,
  attempt_count      integer NOT NULL DEFAULT 0,
  output_artifact_id text REFERENCES artifact(id),
  cost_usd           numeric(12,4) NOT NULL DEFAULT 0,
  generation         integer NOT NULL DEFAULT 0,       -- UI labelling only (§15.3)
  failure            jsonb,
  started_at         timestamptz,
  ended_at           timestamptz,
  UNIQUE (run_id, stage_key)
)

stage_item (
  id                 text PRIMARY KEY,
  stage_execution_id text NOT NULL REFERENCES stage_execution(id),
  item_index         integer NOT NULL,
  state              text NOT NULL,   -- pending|running|awaiting_approval|passed|failed|stale
  attempt_count      integer NOT NULL DEFAULT 0,
  output_artifact_id text REFERENCES artifact(id),
  cost_usd           numeric(12,4) NOT NULL DEFAULT 0,
  UNIQUE (stage_execution_id, item_index)
)

stage_attempt (
  id                  text PRIMARY KEY,
  stage_execution_id  text NOT NULL REFERENCES stage_execution(id),
  stage_item_id       text REFERENCES stage_item(id),
  attempt_no          integer NOT NULL,
  outcome             text NOT NULL,     -- §3.8.1
  resolved_inputs     jsonb NOT NULL,    -- includes memory versions read (§6.3)
  rendered_prompt     text,
  idempotency_key     text,
  phase               text NOT NULL DEFAULT 'created',  -- created|reserved|submitting|submitted|settled
  job_handle          jsonb,
  provider_request_id text,
  raw_response_ref    text,
  artifact_id         text REFERENCES artifact(id),
  check_results       jsonb,
  qc_verdict          jsonb,
  review_note         text,              -- human rejection note (§10.5)
  cost_usd            numeric(12,4) NOT NULL DEFAULT 0,
  actor               text NOT NULL DEFAULT 'engine',   -- 'engine' | 'user'
  duration_ms         integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_execution_id, stage_item_id, attempt_no)
)
```

`attempt_no` is **monotonic and never reset**, including across FAILED → resume. The retry-limit check and the idempotency key both depend on it; resetting it would make a replayed attempt reuse a prior key and silently resolve to an old provider job. The uniqueness constraint is the cheap insurance.

#### 3.8.1 Attempt outcomes

`success` · `check_failed` · `qc_failed` · `qc_error` · `qc_budget_exhausted` · `provider_error` · `provider_timeout` · `infra_error` · `budget_blocked` · `rejected` · `cancelled` · `user_edit`

`qc_error` (unparseable or errored judge) is distinct from `qc_failed` and does not consume a semantic retry (§10.4). `infra_error` covers engine-side failures that are nobody's fault — a restart killing a compute job, a workspace write failing — and is retried up to `infraRetries` (config, default 2) without consuming `retryLimit`, then fails the stage. `rejected` records a human rejection at an approval gate (§10.5). `user_edit` records manual edits so the audit retains who changed what and when.

### 3.9 Artifact

```sql
artifact (
  id                 text PRIMARY KEY,
  run_id             text NOT NULL REFERENCES run(id),
  producer_stage_key text NOT NULL,     -- or '$input:<key>' (§6.2)
  item_index         integer,
  generation         integer NOT NULL DEFAULT 0,
  kind               text NOT NULL,     -- §4.1
  schema_hash        text,              -- sha256 of canonical JSON Schema; null for fixed kinds
  data               jsonb,
  blob_id            text REFERENCES blob(id),
  probe              jsonb,             -- media metadata, populated at write (§9.3)
  derived            jsonb,             -- firstFrame/lastFrame blob ids (§14.4)
  stale              boolean NOT NULL DEFAULT true,    -- born stale, §3.9.1
  user_authored      boolean NOT NULL DEFAULT false,
  repro_level        text NOT NULL,     -- exact|approximate|none
  repro              jsonb,
  cost_usd           numeric(12,4) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX artifact_active_uq
  ON artifact (run_id, producer_stage_key, COALESCE(item_index, -1))
  WHERE stale = false;
```

#### 3.9.1 Artifacts are born stale

Every attempt writes an artifact, including failing ones — QC and checks must judge something, and `stage_attempt.artifact_id` retains the reference regardless of outcome. If attempt artifacts were born active, attempt 2 of any retried stage would insert a second active row and violate `artifact_active_uq`, breaking the retry loop the moment a stage fails one check.

So `stale` defaults to **true**. Exactly one transition flips it false: finalization of a passing attempt, or a manual edit superseding it, in the same transaction that finalizes the attempt.

**The index cannot be deferred.** Postgres partial unique indexes cannot back a `DEFERRABLE` constraint, so there is no end-of-transaction escape. Every supersede path must mark the predecessor stale *before* inserting the replacement, within one transaction. This ordering is a hard requirement, not a preference.

### 3.10 Blob

```sql
blob (
  id             text PRIMARY KEY,
  owner_id       text NOT NULL DEFAULT 'local',
  scope          text NOT NULL,          -- 'run' | 'input' | 'character' | 'asset'
  run_id         text REFERENCES run(id),
  character_id   text REFERENCES character(id),
  bucket         text NOT NULL,
  object_key     text NOT NULL,
  mime           text NOT NULL,
  bytes          bigint NOT NULL,
  sha256         text NOT NULL,
  etag           text,                   -- multipart ETags are not MD5
  gc_eligible    boolean NOT NULL DEFAULT false,
  gc_eligible_at timestamptz,            -- MUST be set whenever gc_eligible flips true (§15.5)
  deleted_at     timestamptz,
  CHECK ((scope IN ('run','input') AND run_id IS NOT NULL)
      OR (scope = 'character' AND character_id IS NOT NULL)
      OR (scope = 'asset'))
);

CREATE INDEX blob_gc_idx ON blob (scope, gc_eligible_at) WHERE deleted_at IS NULL;
```

Only `scope = 'run'` is collectable by retention GC (§4.5). Input blobs are the user's originals; character and asset blobs outlive runs. There is no memory blob scope — Run Memory references artifacts (§6.3).

### 3.11 Run Memory

```sql
run_memory (
  id            text PRIMARY KEY,
  run_id        text NOT NULL REFERENCES run(id),
  mem_key       text NOT NULL,          -- 'keyframe' or 'keyframe#3'
  version       integer NOT NULL,       -- monotonic per (run_id, mem_key)
  written_by    text NOT NULL,          -- stage_key
  written_item  integer,                -- item index, when written from an iterating stage
  kind          text NOT NULL,
  schema_hash   text,
  data          jsonb,                  -- resolved JSON for data/text writes
  artifact_id   text REFERENCES artifact(id),   -- media writes reference the artifact (§6.3)
  tombstone     boolean NOT NULL DEFAULT false, -- value cleared by invalidation (§15.5)
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, mem_key, version)
);

CREATE INDEX run_memory_current ON run_memory (run_id, mem_key, version DESC);
```

Semantics are covered in §6.3. The table is append-only for audit; the *current* value of a key is its highest version.

### 3.12 Ledger

```sql
ledger_entry (
  id                  text PRIMARY KEY,
  run_id              text NOT NULL REFERENCES run(id),
  stage_key           text NOT NULL,
  stage_item_id       text REFERENCES stage_item(id),
  stage_attempt_id    text REFERENCES stage_attempt(id),
  kind                text NOT NULL,   -- reservation|actual|release
  category            text NOT NULL,   -- stage_output|qc|check
  amount_usd          numeric(12,4) NOT NULL,
  confirmed           boolean NOT NULL DEFAULT true,   -- false = provisional (§11.3)
  reservation_id      text,
  expires_at          timestamptz,     -- clock starts at submit (§11.4)
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_open_idx ON ledger_entry (run_id, stage_key) WHERE kind = 'reservation';

-- One reservation per attempt, so a replayed step reuses rather than duplicates (§13.3)
CREATE UNIQUE INDEX ledger_one_reservation_per_attempt
  ON ledger_entry (stage_attempt_id) WHERE kind = 'reservation';
```

### 3.13 Template

See §20.

---

## 4. Artifact Kinds, Schemas, and Storage

### 4.1 Kinds

The closed reel-specific type registry is gone. Seven kinds remain:

| Kind | Payload | Schema source |
|---|---|---|
| `data` | JSON | **user-defined** JSON Schema on the stage |
| `text` | `{ text }` | fixed |
| `media.image` | blob + probe | fixed |
| `media.video` | blob + probe + derived | fixed |
| `media.audio` | blob + probe | fixed |
| `file.subtitles` | blob + `{ format }` | fixed |
| `timeline` | JSON | engine-owned (§17.1) |

`text.idea`, `text.script`, `scene.list`, `style.wardrobe`, `timing.map`, and `media.video.final` leave the engine. Scripts, scene lists, and wardrobes are `data` outputs with user schemas, shipped as presets in the template library (§20). Timing data is a documented **engine preset schema** because `media.analyze` produces it and the render capability consumes it — a preset, not a built-in type. `json.generic` is deleted; an untyped JSON output is `data` with schema `{}`, and the validator warns.

### 4.2 OutputDef and the restricted dialect

```ts
type OutputDef =
  | { kind: 'data'; schema: JsonSchema; schemaName?: string }
  | { kind: 'text' }
  | { kind: 'media.image' | 'media.video' | 'media.audio'; constraints?: MediaConstraints }
  | { kind: 'file.subtitles' }
  | { kind: 'timeline' };

type MediaConstraints = {
  durationSec?: { min?: number; max?: number };
  aspectRatio?: string;
  minWidth?: number;
};
```

**Allowed JSON Schema keywords:** `object`, `array`, `string`, `number`, `integer`, `boolean`, `enum`, `required`, `description`, `minItems`, `maxItems`, `minimum`, `maximum`, `minLength`, `maxLength`.

**Disallowed:** external `$ref`, `oneOf`/`anyOf`/`allOf`, `patternProperties`, conditional keywords.

Two reasons. LLM structured-output modes support only a subset of JSON Schema, and an output schema must be enforceable at generation time rather than only at validation. And the compatibility walker (§16.4) becomes tractable — unions are what make structural subtype checking hard.

**Validation stack.** Zod is the source of truth for engine-owned shapes (StageDef, Timeline, DTOs). User schemas are validated at runtime with Ajv. Every `data` stage's schema is persisted inside `blueprint_version.graph`, and each artifact records its `schema_hash`.

**`output.schema` is not overridable at run level.** `run.overrides` carries a `ConfigLayer` (§5) and `output` is not part of it. Changing a schema mid-run would orphan active artifacts whose `schema_hash` no longer matches, and the FAILED-recovery path is exactly when someone would try.

**Implicit schema check.** Every `data` output runs Ajv validation as an implicit first check. It **short-circuits**: on failure, no further checks run, because they would read fields that may not exist. The attempt records `check_failed` with the Ajv error paths in the critique, so the retry prompt tells the model precisely which fields were wrong.

**Models without native structured output.** When the pinned model's adapter reports `supportsStructuredOutput: false`, the capability injects the schema into the prompt and relies on the implicit Ajv check plus semantic retry. The validator warns rather than blocking, since prompt-and-validate works acceptably for simple schemas and badly for deep ones.

### 4.3 Object layout

One bucket, `video-engine`. Slashes are key prefixes.

```
{ownerId}/{channelId}/{runId}/raw/{attemptId}.json
{ownerId}/{channelId}/{runId}/media/{artifactId}.{ext}
{ownerId}/{channelId}/{runId}/inputs/{blobId}.{ext}
{ownerId}/{channelId}/assets/{blobId}.{ext}
{ownerId}/characters/{characterId}/refs/{blobId}.png
```

```ts
interface StorageAdapter {
  put(key: string, body: Buffer | Readable, meta: { mime: string }): Promise<PutResult>;
  getStream(key: string, range?: ByteRange): Promise<Readable>;
  stat(key: string): Promise<{ bytes: number; etag: string; mime: string }>;
  copy(srcKey: string, destKey: string): Promise<PutResult>;
  delete(keys: string[]): Promise<void>;
  presignGet(key: string, ttlSec: number): Promise<string>;
  presignPut(key: string, ttlSec: number): Promise<string>;
}
```

`@aws-sdk/client-s3` plus the presigner. **`forcePathStyle: true` is mandatory** for MinIO — the SDK defaults to virtual-host addressing, which needs wildcard DNS a local MinIO does not have. Moving to real S3 is a config change.

Bucket versioning stays off: artifacts are append-only with unique IDs, so it would double storage to duplicate an existing guarantee. Uploads stream via `Upload` from `@aws-sdk/lib-storage` rather than buffering large media in Node's heap — including `raw/*.json`, since some provider responses embed base64.

### 4.4 Workspace and durable compute jobs

Short-lived compute uses an ephemeral workspace:

```ts
interface WorkspaceService {
  withWorkspace<T>(runId: string, fn: (ws: Workspace) => Promise<T>): Promise<T>;
}
interface Workspace { dir: string; pull(key: string): Promise<string>; push(p: string, key: string, mime: string): Promise<PutResult>; }
```

`withWorkspace` removes the directory in a `finally`. A workspace path never crosses an Inngest step boundary and is never a step return value or a binding target.

Long compute — ffmpeg concat, Remotion render, forced alignment — outlives the step that spawned it, so an ephemeral workspace would delete its inputs before `poll` ran. It uses a **durable job directory** instead:

```ts
interface ComputeJobService {
  spawn(jobId: string, spec: ComputeSpec): Promise<ComputeHandle>;  // detached child process
  poll(h: ComputeHandle): Promise<JobStatus>;                       // reads status file
  collect(h: ComputeHandle): Promise<string>;
  cancel(h: ComputeHandle): Promise<void>;                          // SIGTERM then SIGKILL
  cleanup(jobId: string): Promise<void>;
}
```

`{workspaceRoot}/jobs/{jobId}/` holds inputs, output, and a status file the child writes on exit. Removed by `cleanup` after `fetch`, or by a reaper cron for runs that ended without collection. `ComputeHandle` is `{ jobId, pid, startedAt }`, persisted as `stage_attempt.job_handle`.

The job survives an API restart but the pid does not, so `poll` treats "status file absent and pid not alive" as failure rather than still-running. A restart mid-render is an `infra_error` (§3.8.1): the render was not wrong, the machine went away, so it is retried without consuming `retryLimit`. Charging a semantic retry for an infrastructure fault would contradict §13.2's division.

Disk: a 20-item video stage plus intermediates can mean several GB transiently. The workspace root needs a preflight free-space check and a different volume from Postgres.

### 4.5 Blob GC

```sql
SELECT id, bucket, object_key FROM blob
WHERE scope = 'run'                    -- never input/character/asset
  AND gc_eligible = true
  AND deleted_at IS NULL
  AND COALESCE(gc_eligible_at, '1970-01-01') < now() - $retention
```

The `COALESCE` is a second line of defense, not the primary fix. The primary fix is §15.5 writing `gc_eligible` and `gc_eligible_at` in the same statement, always. But a defense that depends on every future write path remembering that discipline is exactly the pattern that produced this bug in the first place — `gc_eligible_at` was reachably `NULL` here, and `expires_at` was reachably `NULL` in §11.4's predecessor, and both looked correct in isolation. Folding a NULL into an old sentinel timestamp means a row that *should* have a timestamp and doesn't gets swept immediately and loudly (visible in the delete log) rather than silently retained forever. Cheap insurance against a mistake that costs disk space either way.

Deletion is app-driven because eligibility depends on the `stale` flag, which MinIO cannot see. After collection, `GET /blobs/:id` returns **410 Gone** with artifact metadata still readable, so the UI can render "media collected, metadata retained".

---

## 5. Config Resolution

### 5.1 ConfigLayer

```ts
type ConfigLayer = {
  model?: Partial<ModelPin>;
  qc?: { threshold?: number; model?: Partial<ModelPin>; capUsd?: number };
  budget?: { runCapUsd?: number; stageCapUsd?: number };
  retryLimit?: number;
  iterate?: { itemRetryLimit?: number; maxItems?: number };
  format?: {
    aspectRatio?: string;                 // '9:16' | '16:9' | '1:1' | '4:5'
    resolution?: string;                  // '1080x1920'
    fps?: number;
    targetDurationSec?: { min?: number; max?: number };
  };
  provider?: { preferred?: Record<Modality, string> };
  polling?: { intervalSec?: number; maxWaitSec?: number };
};
```

Every field is optional at every layer — a ConfigLayer is a patch. The TypeScript shape shows `field?: T`, which expresses only "may be absent"; the merge rules distinguish absent from explicitly null, so the **Zod schema must declare these `.nullish()`**, not `.optional()`, or the unset mechanism cannot be expressed.

**`format` is what removes the last reel assumption from the engine.** Generation capabilities default aspect ratio from it; `timeline.render` defaults its canvas from it. A vertical channel sets `9:16`, a YouTube channel sets `16:9`, and no capability hardcodes either.

### 5.2 Resolution

```
engineDefaults → channel.defaults → blueprint_version.defaults → StageDef fields → run.overrides[stageKey]
```

- **Plain objects deep-merge.** Arrays and scalars replace.
- **`undefined` does not override**; `null` explicitly unsets.
- **`model.params` deep-merges only within the same `modelId`.** If a layer changes `modelId`, accumulated params from lower layers are discarded for that layer and above. Params are model-specific, and inheriting `top_k` into a different vendor's model is a silent misconfiguration; discarding is the safer failure.

### 5.3 Timing

Resolution happens at **run start**, once, flattened into `run.resolved_config`, immutable thereafter. `run.overrides` is the sole exception: a sparse `{ [stageKey]: ConfigLayer }` applied at stage execution time to recover a FAILED run without violating version immutability (§12.3).

The effective configuration for a stage is `resolved_config[stageKey] ⊕ overrides[stageKey]`. Every consumer — including the ledger's stage cap (§11.2) — must read the effective value, never `blueprint_version.graph` directly. `ConfigResolver.effectiveStageConfig(runId, stageKey)` is the only sanctioned path.

---

## 6. Bindings, Run Memory, and Templating

### 6.1 Ref

```ts
type Ref =
  | { from: 'prev';     path?: string; alignWith?: 'item' }
  | { from: 'memory';   key: string; path?: string }
  | { from: 'input';    inputKey: string; index?: number; path?: string }
  | { from: 'asset';    assetId: string }
  | { from: 'role';     roleKey: string }
  | { from: 'item';     path?: string }        // current element of iterate.over
  | { from: 'prevItem'; path?: string }        // previous item's output (§14.4)
  | { from: 'const';    value: unknown };
```

**A stage binds only the previous stage.** There is no `{from: 'stage', stageKey}`. Anything a stage needs from further back travels through Run Memory. This is the user-chosen model; §26 records what it costs.

For the first stage in a blueprint, `{from: 'prev'}` is a validation error.

### 6.2 Run inputs as artifacts

At run start each declared input becomes an artifact with `producer_stage_key = '$input:<key>'`. Many-cardinality inputs produce N artifacts with `item_index` 0…N−1. Bindings, the active-artifact index, and invalidation all work unchanged — an input is just an artifact nobody generated.

Media inputs are uploaded before start via presigned PUT, exactly like character references. Replacing an input after start is an invalidation trigger (§15.1).

Asset refs snapshot the asset's `blob_id` into `run.resolved_config` at start, so replacing a logo later does not change past runs.

### 6.3 Run Memory

Run Memory is a mutable, run-scoped key/value store. Any stage may write to it; any later stage may read from it.

**Writing.** `StageDef.writes` maps memory keys to paths into the stage's own output:

```jsonc
"writes": { "keyframe": "$", "palette": "style.colors" }
```

`"$"` means the whole output. For an iterating stage, each item writes its own entry and the key is **indexed by item**: `keyframe#0`, `keyframe#1`, and so on. Because items run sequentially (§14), ordering is deterministic and last-writer-wins is reproducible.

**Reading.** `{from: 'memory', key: 'keyframe'}` resolves to the current value — the highest version that is not a tombstone. For an indexed group, reading the base key `keyframe` yields the **ordered list** of all non-tombstoned indexed entries, by index; reading `keyframe#3` yields one.

Tombstones exist because an iterating stage re-run with fewer items would otherwise leave orphans: a stage that produced `broll#0…#5`, retried and producing four items, would leave `#4` and `#5` as current values and a base-key read would return six clips. Invalidation tombstones every key written by an invalidated stage or item (§15.5), so the base-key read returns the new count.

A read resolving to nothing but tombstones is a runtime error. Array ordering makes it unreachable, so encountering it signals a bug rather than a user mistake.

**Memory reads are tracked dependencies.** A memory key must be written by an earlier stage (§16.2), so a reader always follows its writer. `stage_attempt.resolved_inputs` records the memory version each attempt consumed, and invalidation (§15.2) uses those records: retrying the writer invalidates every stage that read a version it produced. Memory is a convenience for reaching past the previous stage — it is not an escape from dependency tracking, and a finished run is internally consistent.

**Versions are append-only.** Every write appends a `run_memory` row. Old versions are retained for audit; the current value of a key is its highest non-tombstoned version (§15.5).

**The engine writes memory, not capabilities.** `MemoryService.applyWrites(stageKey, itemIndex, artifactId)` runs inside the same transaction that finalizes a passing attempt and flips its artifact's `stale` to false. Failed, rejected, and cancelled attempts never write memory — otherwise an attempt that later fails its checks would already have overwritten a value its successors depend on. Manual edits (§15.4) and `human.input` submissions run the same call.

**Memory references artifacts, not blobs.** A write of a media output stores `artifact_id`; a write of a path into `data` stores the resolved JSON. There is no memory-owned blob, so memory can never point at a blob whose artifact was collected out from under it.

**Declared, so the validator can help.** Because `writes` and memory reads are declared in the StageDef, the validator checks that every key read is written by some earlier stage (§16.2) and the editor can autocomplete keys. Declaration buys existence checking; it does not buy invalidation.

### 6.4 Slots and context

Capabilities declare typed **slots**; users add free-form **context** bindings for templating.

```ts
type SlotDef = {
  name: string;
  accepts: Array<ArtifactKind | JsonSchema>;   // kind, kind pattern, or schema
  required: boolean;
  cardinality: 'one' | 'many';
};
```

Slots are validated structurally at save time (§16.4). Context bindings are checked only for resolvability — the referenced source exists and the path resolves — because there is no declared type to check against. The editor generates slot fields from the registry and lets the user add context freely.

### 6.5 Templating

`instructions.template` supports a restricted path grammar: `{{ name }}`, `{{ name.field }}`, `{{ name.field.sub }}`, `{{ name.list[0].field }}`. No expressions, filters, or function calls. Names resolve against that stage's own `slots` and `context` keys.

The validator resolves every path against the bound value's schema at save time, which user-defined schemas (§4.2) make possible. Unknown paths are save-time errors. Arrays and objects interpolate as pretty-printed JSON.

The rendered prompt is persisted per attempt so the audit shows exactly what was sent.

### 6.6 Media manifests

A planning stage must know *what media exists* without receiving bytes, and must refer to it by a handle it cannot mistype into a blob ID. When a media artifact — or a `cardinality: 'many'` set — is bound into an `text.generate` context, the template receives a **manifest**:

```json
[
  { "handle": "clip#0", "kind": "media.video", "durationSec": 5.0, "width": 1080, "height": 1920, "hasAudio": false },
  { "handle": "clip#1", "kind": "media.video", "durationSec": 5.0, "width": 1080, "height": 1920, "hasAudio": false },
  { "handle": "input:logo", "kind": "media.image", "width": 512, "height": 512 }
]
```

Handle forms: `memory:<key>` and `memory:<key>#<i>`, `prev` and `prev#<i>`, `input:<key>` and `input:<key>#<i>`, `asset:<assetId>`. Assets are addressed by ID rather than name, matching `{from:'asset', assetId}` — names are neither unique across channels nor stable under rename.

Handles are the only way LLM output may reference media. If stage config sets `vision: true` and the model supports it, image slots are additionally sent as images and video slots as sampled frames.

**Handles are relative when written and canonical when stored.** `prev#0` means something different in the stage that wrote it than in the stage that consumes it — a timeline stage writes `prev` meaning the music stage before it, while `timeline.render` sees `prev` as the timeline artifact. `memory:broll#2` has a subtler version of the same problem: at render time it resolves to whatever version is current, not the version the author saw.

So the engine rewrites them. **Immediately after fetch and before any check runs**, every handle in the output is replaced with a canonical form: `artifact:<artifactId>` for stage outputs, memory entries, and run inputs; `asset:<assetId>` for assets. The mapping comes from `stage_attempt.resolved_inputs`, which records what each relative handle pointed at for that attempt.

A handle that maps to nothing fails the attempt as `check_failed`, with the offending handle in the critique — a hallucinated handle is a generation error, caught before it reaches storage.

Downstream stages therefore never interpret a relative handle, and a stored artifact means exactly what it meant when written.

Manifests derive from `artifact.probe`, so this adds no new I/O.

---

## 7. Capability Registry & Contract

### 7.1 Registration

Capabilities are `@Injectable()` providers carrying a decorator, discovered at bootstrap by `DiscoveryService`. The decorator carries **only** the key; all other metadata lives on the instance, so decorator and interface cannot disagree.

```ts
@Capability('video.generate')
@Injectable()
export class VideoGenerate implements CapabilityImpl<Cfg> {
  readonly modality = 'video' as const;
  readonly kind = 'async' as const;
  readonly configSchema = VideoGenerateConfig;
  slots(cfg: Cfg): SlotDef[] { /* depends on cfg.mode */ }
  allowedOutputs(): OutputKind[] { return ['media.video']; }
  validate(cfg, stage, caps) { /* model-specific legality (§16.2) */ }
  // lifecycle below
}
```

`CapabilityRegistry` implements `OnModuleInit`, scans for the metadata key, and throws on duplicates at startup. It backs `GET /capabilities`, so editor form generation, validator type checking, and execution read one source.

Slots and allowed outputs are **functions of config**, because a general capability's shape depends on how it is configured — `image.edit` with `operation: 'inpaint'` needs a mask slot that `operation: 'upscale'` does not.

### 7.2 Lifecycle

```ts
interface CapabilityImpl<Cfg> {
  readonly modality: Modality;
  readonly kind: 'sync' | 'async';
  readonly configSchema: ZodSchema<Cfg>;
  slots(cfg: Cfg): SlotDef[];
  allowedOutputs(cfg: Cfg): OutputKind[];
  validate?(cfg: Cfg, stage: StageDef, caps: ProviderCapabilities): ValidationIssue[];

  estimateCost(ctx: ExecCtx<Cfg>): Promise<CostEstimate>;
  submit(ctx: ExecCtx<Cfg>): Promise<JobHandle>;
  poll(h: JobHandle): Promise<JobStatus>;
  fetch(h: JobHandle, ctx: ExecCtx<Cfg>): Promise<ExecResult>;
  cancel?(h: JobHandle): Promise<void>;
}

type CostEstimate = { expectedUsd: number; ceilingUsd: number;
                      basis: 'provider_quote' | 'token_estimate' | 'configured_ceiling' };
```

The split exists so the orchestrator can place step boundaries correctly (§13.3). A single `execute()` would put a four-minute render inside one step — no durability on replay, and worse, a transport retry would submit a second paid job.

**Idempotency.** `ctx.idempotencyKey` is `sha256(stageExecutionId : attemptNo : itemIndex ?? 0)`, passed to providers that support it. Where a provider does not, the adapter declares `supportsIdempotency: false` and the orchestrator persists `job_handle` **before** the submit step returns, so a replay detects the in-flight job instead of resubmitting.

**`sync` means fast, not local.** ffmpeg and Remotion capabilities are `async` despite running on the same machine, for the reasons in §4.4. Reserve `sync` for work measured in seconds.

`ExecCtx` provides resolved slots and context, the rendered prompt, a `ProviderClient` scoped to the effective model pin, a `BlobWriter`, the idempotency key, and a logger. It does not provide database access, the run object, other stages, or any way to write Run Memory — memory writes are applied by the engine at finalization (§6.3), so a capability cannot publish a value from an attempt that later fails.

### 7.3 Capability set

| Capability | Modality | Kind | Notes |
|---|---|---|---|
| `text.generate` | text | sync | Output `text` or `data`. Image slots enable vision; video slots sampled to frames. |
| `image.generate` | image | async | Optional `references` slot, cardinality many |
| `image.edit` | image | async | `operation`: inpaint, restyle, background removal |
| `video.generate` | video | async | Optional slots `startFrame`, `endFrame`, `references`; legality per pinned model |
| `video.transform` | video | async | `operation`: upscale, lip-sync, extend, restyle |
| `audio.speech` | audio | async | |
| `audio.music` | audio | async | |
| `audio.sfx` | audio | async | |
| `media.analyze` | compute | async | `operation`: probe, transcribe_align, beats, scene_cuts, silence. Output `data` with engine preset schemas. |
| `video.concat` | compute | async | Join clips in order, optional audio track and burned or sidecar subtitles (§17.4) |
| `timeline.render` | compute | async | Full assembly from a `timeline` artifact (§17) |
| `subtitles.export` | compute | sync | Timing data → SRT/VTT/ASS sidecar |
| `human.input` | human | sync | Pause for the user to supply or choose a value matching the stage's output schema |
| `publish.stub` | publish | sync | Registered, throws — reserves the slot |

There is no `human.approve` capability. Approval is a property of the stage that produced the artifact (§10.5), not a separate stage — a gate stage would produce no output, and the stage after it would bind `{from:'prev'}` and receive nothing.

Two assembly capabilities rather than one. `video.concat` covers the common case — join the clips, add subtitles — without requiring the user to produce timeline JSON. `timeline.render` covers overlays, multi-track audio, transitions, and motion. Neither is mandatory; a blueprint may end at a single generated clip.

WPM-based timestamp estimation is not a capability. It is either an `text.generate` output or an inequality inside a check, and shipping it as a capability invites the accuracy trap the validator already warns about.

---

## 8. Provider Adapters

```ts
interface ProviderAdapter {
  id: string;
  modalities: Modality[];
  listModels(): Promise<ModelInfo[]>;
  estimate(req: ProviderRequest): Promise<CostEstimate>;
  submit(req: ProviderRequest, idempotencyKey: string): Promise<JobHandle>;
  poll(h: JobHandle): Promise<JobStatus>;
  fetch(h: JobHandle): Promise<ProviderResult>;
  cancel(h: JobHandle): Promise<void>;
}
```

**Capabilities are declared per model**, not per adapter, since one provider hosts models with different limits:

```ts
type ModelCapabilities = {
  maxRefs?: number;
  supportsSeed: boolean;
  supportsIdempotency: boolean;
  supportsStructuredOutput?: boolean;
  supportsVision?: boolean;
  video?: {
    durationsSec: number[] | { min: number; max: number };
    aspectRatios: string[];
    maxResolution: string;
    inputs: Array<'text' | 'startFrame' | 'endFrame' | 'references'>;
  };
};
```

This is what lets the validator reject an impossible stage before any spend — an `endFrame` slot on a model that does not accept one, a 9:16 request to a model that only does 16:9, a 12-second clip from a model that generates 5 or 10.

**OpenRouter** is one adapter (BYOK) covering text and some image. `listModels()` proxies the models endpoint, cached ~24h, providing per-token pricing for estimation. Video, speech, music, and alignment need their own adapters. Providers without machine-readable pricing use a hand-maintained table keyed by `(providerId, modelId)` with a per-call ceiling; `CostEstimate.basis` records which path was used so the UI can distinguish quotes from guesses.

---

## 9. Checks

### 9.1 Contract

```ts
type CheckDef =
  | { type: 'builtin'; key: string; params: unknown }
  | { type: 'script';  name: string; code: string; refs?: Record<string, Ref> };
```

All checks are **pure, synchronous, and perform no I/O**. Everything a check can see is resolved before it runs.

Builtin library: `word_count`, `wpm`, `duration_range`, `regex_match`, `regex_absent`, `numeric_range`, `array_length`, `media_format`, `non_empty`, plus the built-in timeline checks (§17.3).

All checks run even after the first failure, so a retry prompt receives every problem at once. The sole exception is the implicit Ajv schema check, which short-circuits (§4.2).

### 9.2 Script checks

```js
// artifact: { kind, data, probe }   refs: { [name]: { kind, data, probe } }
// return { pass: boolean, message?: string, details?: object }
const total = artifact.data.scenes.reduce((s, x) => s + x.durationSec, 0);
const vo = refs.voiceover.probe.durationSec;
return Math.abs(total - vo) <= 1
  ? { pass: true }
  : { pass: false, message: `Scenes total ${total}s but voiceover is ${vo}s` };
```

`refs` bindings resolve to `data` and `probe` only — never bytes — which is what preserves purity while enabling cross-artifact verification. Under §6.1, `refs` may point at the previous stage, Run Memory, inputs, or assets.

**Sandbox.** QuickJS compiled to WebAssembly (`quickjs-emscripten`), ~32 MB memory limit, interrupt-based ~100 ms time limit, no host bindings. `vm`/`vm2` are not security boundaries; V8 isolates are heavier with a larger surface. Even single-user, blueprints will be shared and imported through the template library.

**Invalidation.** A check's `refs` are recorded in `stage_attempt.resolved_inputs` alongside the stage's own bindings, so they participate in invalidation like any other read (§15.2). If a check compared scene durations against a voiceover and that voiceover is retried, the checked stage is a dependent — its verdict was computed against a value that changed.

`POST /checks/test` runs a script check against an existing artifact and returns the result, so checks can be iterated without starting runs.

### 9.3 Media probe

`media_format` and `duration_range` would need to read bytes, contradicting purity. Instead, **media-producing capabilities populate `artifact.probe` at write time**, running `ffprobe` in their workspace before pushing the blob:

```ts
type Probe = {
  container: string;
  durationSec: number;
  streams: Array<{ type: 'video'|'audio'; codec: string; width?: number; height?: number; fps?: number; sampleRate?: number }>;
};
```

One probe per media artifact, and the check signature stays stable — which matters because that signature is shared with script checks and anything added later.

---

## 10. Quality Control

```ts
type QcDef = {
  criteria: string;
  threshold: number;         // 0-100
  model: ModelPin;           // pinned, temperature 0
  includeInputs: boolean;    // default true
  media?: { includeTranscript?: boolean };   // audio only; video QC is prohibited (§10.1)
  dimensions?: Array<{ key: string; description: string; weight: number }>;
};
```

### 10.1 QC is forbidden on video output

**A stage whose `output.kind` is `media.video` may not declare `qc`. This is a save-time validation error.**

Judging video means a vision call over sampled frames on every attempt, against the most expensive outputs in the system. Video stages are gated by checks — which read `probe` for free — and by human approval.

The direct consequence, stated rather than buried: video has no automated quality gate. The engine can verify that a clip is 10 seconds at 1080×1920 with the right codec. It cannot tell you the subject's face changed. That judgment is the human's.

### 10.2 What independence buys

`QcRunner` receives a `QcEnvelope` object with no field for the excluded data, rather than the attempt with instructions to ignore parts of it. The envelope holds the output artifact, the criteria, and — if `includeInputs` — the stage's resolved slots and context.

Structurally excluded: `instructions`, the rendered prompt, the stage's model identity, prior attempts, prior verdicts.

Stated honestly: for LLM stages the resolved inputs *are* substantially the prompt's content, since templates interpolate only declared bindings. The envelope buys independence from **the framing, the instructions, and the critique history** — not from the input material. That is the property worth having, since framing and accumulated critique are what would bias a judge toward ratifying its own prior reasoning. It is not blind evaluation.

### 10.3 Modality handling

- **Text and data**: inline.
- **Image**: the image, to a vision model.
- **Audio**: transcript-based by default. Judging raw audio requires an audio-capable model and is opt-in by model choice.
- **Video**: not permitted (§10.1).
- **Timeline**: the timeline JSON can be checked mechanically (§17.3) but not judged — a model reading timeline JSON cannot see whether the result looks right, and the rendered result is video. Timeline stages use checks plus human approval on the render.

Frame sampling and contact sheets have no place here: they exist to judge video, which §10.1 forbids.

**Weighted dimensions** let a blueprint define rubric items — hook strength, brand safety, visual consistency. Score is the weighted mean; per-dimension scores persist on `stage_attempt.qc_verdict` and appear in the critique.

### 10.4 Failure modes and cost

- **`qc_failed`** — a valid verdict below threshold. Consumes a semantic retry; the critique is appended to the stage's critique log and the *next* attempt's prompt receives all prior critiques. QC stays blind; the stage accumulates. This is the anti-oscillation mechanism, and it is why the two halves live in different components.
- **`qc_error`** — unparseable response, schema violation, provider error. Retried up to `qcErrorRetries` (default 2) **without** consuming a semantic retry, then fails the stage. A malformed judge must not exhaust the generation budget.
- **`qc_budget_exhausted`** — `qc.capUsd` is spent and an artifact cannot be judged. Fails the stage. It does not pass the artifact through unjudged, which would silently disable a gate the user configured, and it does not spend past the cap, which would make the cap meaningless. Recovery is the ordinary FAILED path: raise `qc.capUsd` via a run override and resume.

### 10.5 Human approval, and where a rejection goes

A stage with `approval` pauses after producing an artifact that passed its checks. The user may approve, edit the artifact, or **reject with an optional note**.

**Rejection must reach a stage that can act on it.** Rejecting the output of a deterministic stage and retrying that same stage reproduces the identical artifact — the render is a pure function of its timeline. The note has to reach whatever produced the input. `onReject.retryStageKey` names it, defaulting to the stage itself.

On rejection:

1. Write an attempt on the gated stage (or item) with `outcome: 'rejected'` and the note in `review_note`.
2. Append the note to the critique log of `retryStageKey`, exactly as a QC critique would be appended. The next attempt of that stage receives it.
3. Compute invalidation from the target stage (§15.5) and return a preview token, like retry.
4. On confirmation, re-run from the target. The rejection consumes one attempt against the **target** stage's `retryLimit`, not the gated stage's.

`retryStageKey` is the only backward reference by name in the design. It carries no data — the target's inputs are unchanged — only a critique and a resume point. Data flow remains previous-stage-and-memory only.

**Item-mode approval.** With `mode: 'item'`, an iterating stage pauses after each item passes its checks and before the next begins, setting `stage_item.state = 'awaiting_approval'` and the run to `PAUSED_APPROVAL`. Approving continues the loop.

This matters because items chain (§14.4). Under stage-mode approval a bad clip 2 surfaces only after clips 3, 4 and 5 have been generated from it — four clips paid for to discover one fault. Item mode catches it before the next clip starts. It costs elapsed time, which is why it is opt-in.

Rejection is why video works without QC (§10.1). Without a note reaching a stage with instructions, rejecting a clip would retry an identical prompt and produce an equally wrong clip — the failure §13.2's retry table exists to prevent.

---

## 11. Budget Ledger

### 11.1 Concurrency control

A transaction provides atomicity, not mutual exclusion. Under READ COMMITTED, N concurrent reservation transactions each compute a `SUM` that misses the others' uncommitted inserts, all pass the cap check, and all commit.

Within a run this cannot happen: nothing in a run executes in parallel (§13). Across runs it cannot either — budgets are per run, the lock is keyed by run id, and two runs take two different row locks with no shared cap to race over.

The race the lock actually prevents is **between the orchestrator and user actions on the same run**. A budget raise, an override patch, a retry confirmation, or an input replacement can arrive while the orchestrator is mid-stage. Every mutating action takes the same lock and re-checks run state before acting (§12.4).

```sql
BEGIN;
SELECT reserved_usd, spent_usd, budget_cap_usd FROM run WHERE id = $runId FOR UPDATE;
-- compute stage-scope available from ledger + effective stage cap (§5.3)
-- if ceilingUsd > min(runAvailable, stageAvailable) -> ROLLBACK, budget_blocked
INSERT INTO ledger_entry (kind='reservation', amount_usd=$ceiling, ...);
UPDATE run SET reserved_usd = reserved_usd + $ceiling WHERE id = $runId;
COMMIT;
```

The lock is now largely uncontended, which is fine — it costs nothing and it keeps the invariant true if concurrency is ever reintroduced. `reserved_usd` and `spent_usd` are materialized so the hot path reads one row; the ledger remains the source of truth and a periodic reconciliation asserts they agree.

### 11.2 Effective caps

Stage-scope availability is computed against the **effective** stage cap from `ConfigResolver.effectiveStageConfig()`, which includes `run.overrides`. Reading `blueprint_version.graph` directly would ignore the override a user just applied to unblock a FAILED run, and the run would re-block immediately.

### 11.3 Ordering and settlement

The reservation is **committed before** `submit()` is called. The crash window between them leaves an orphan reservation, which the sweep clears; the reverse ordering leaves an unreserved paid job, which nothing detects.

On completion: insert `actual` with true cost, insert `release`, update materialized totals.

**Unconfirmed outcomes settle as provisional actuals, not releases.** A `provider_timeout` means the engine stopped polling, not that the provider stopped rendering; a cancel that `adapter.cancel()` could not confirm means the same. Both write `actual = ceilingUsd` with `confirmed = false`. A later reconciliation can correct downward and flip `confirmed`. The ledger's error stays conservative, because overstating spend is recoverable by inspection while understating it breaks the guarantee the cap exists to provide.

A confirmed non-billing failure — a 4xx rejection, a provider error before work began — writes a plain `release`.

### 11.4 Orphan sweep

**Two expiries, so no reservation is ever unswept.** Setting `expires_at` only at submit leaves a pre-submit crash with `expires_at` NULL, and `NULL < now()` evaluates to NULL rather than true — the sweep would never select the row, and the budget would be consumed permanently by a job that was never sent. The same NULL-comparison trap applies here as to `gc_eligible_at` (§15.5).

- At reservation: `expires_at = now() + preSubmitTtlSec` (config, default 10 min).
- At submit: `expires_at = now() + maxWaitSec + fetchAllowanceSec`.

**The sweep branches on `phase`, not on `job_handle`.** Presence of a handle is the wrong signal: for a provider without idempotency support, a crash after the provider accepted the job but before the handle was persisted looks identical to "nothing was sent", and the reservation would be released while the job bills.

| Phase at expiry | Action |
|---|---|
| `created`, `reserved` | `release` — nothing reached a provider |
| `submitting`, `submitted` | provisional actual (§11.3) — a job may be billing |

The sweep's own query is `WHERE kind = 'reservation' AND expires_at < now()`. Because `expires_at` is set at reservation (§11.3's insert) and again at submit, there is no code path that leaves it `NULL` — unlike the pre-fix version of this section. It is intentionally **not** made `COALESCE`-defensive the way §4.5's is: a `NULL` here would mean the reservation insert itself is broken, which should fail loudly (an application-level assertion on write) rather than be masked by a query-level fallback that hides a worse bug.

`submitting` is written in a committed statement **before** the provider call, and `submitted` once the handle is stored. The window where a paid job is invisible to the sweep is the gap between two adjacent statements rather than the whole submit round trip.

### 11.5 Blocking

On `budget_blocked` the run enters `PAUSED_BUDGET` and waits for the user to raise the cap or cancel. It never silently resumes and never silently dies.

---

## 12. Run State Machine

### 12.1 States

`CREATED` · `RUNNING` · `PAUSED_BUDGET` · `PAUSED_APPROVAL` · `PAUSED_INPUT` · `FAILED` · `COMPLETED` · `CANCELLED`

```
                    ┌──────────┐
                    │ CREATED  │
                    └────┬─────┘
                         │ start
                    ┌────▼─────┐
     ┌──────────────│ RUNNING  │──────────────┐
     │          ┌───┴──┬───┬───┴───┐          │
 budget     approval  input │ retries      all stages pass
     │          │       │   │ exhausted        │
┌────▼─────┐ ┌──▼────┐ ┌▼───────┐ ┌──────▼──┐ ┌───────────┐
│ PAUSED_  │ │PAUSED_│ │PAUSED_ │ │ FAILED  │ │ COMPLETED │
│ BUDGET   │ │APPROVAL││ INPUT  │ └────┬────┘ └───────────┘
└────┬─────┘ └──┬────┘ └┬───────┘      │ override + resume
     └──────────┴───────┴──────────────┘
                   ▼
               RUNNING        (any non-terminal) ──cancel──▶ CANCELLED
```

`PAUSED_INPUT` is distinct from `PAUSED_APPROVAL`: approval gates an artifact that already exists, whereas `human.input` *produces* the artifact. Different UI, different resume payload.

### 12.2 FAILED is recoverable

All artifacts survive. The user edits the failing stage's configuration and resumes from `cursor_stage_key`. Resuming starts a fresh Inngest run that skips `passed` stage executions and, for iterating stages, skips `passed` items (§14.5).

### 12.3 Run overrides

A pinned blueprint version is immutable, so a fix is stored as `run.overrides[stageKey]`, a sparse `ConfigLayer` applied over `resolved_config`. Written via `PATCH /runs/:id/overrides`. When the fix works, the UI offers to promote the override into a new blueprint version — the improve-the-blueprint loop.

`output.schema` is not overridable (§4.2).

### 12.4 What the user may do, and when

Every mutating action takes the per-run row lock (§11.1) and re-checks state. Disallowed actions return `409 Conflict` with the current state.

| Action | RUNNING | PAUSED_* | FAILED | COMPLETED | CANCELLED |
|---|---|---|---|---|---|
| Retry stage or item (confirm) | ✗ | ✓ | ✓ | ✓ | ✗ |
| Manual artifact edit | ✗ | ✓ | ✓ | ✓ | ✗ |
| Replace run input | ✗ | ✓ | ✓ | ✓ | ✗ |
| Patch overrides | ✗ | ✓ | ✓ | ✗ | ✗ |
| Raise budget | ✓ | ✓ | ✓ | ✗ | ✗ |
| Approve / reject | — | `PAUSED_APPROVAL` only | ✗ | ✗ | ✗ |
| Submit input | — | `PAUSED_INPUT` only | ✗ | ✗ | ✗ |
| Resume | ✗ | ✓ | ✓ | ✗ | ✗ |
| Cancel | ✓ | ✓ | ✓ | ✗ | ✗ |

Raising a budget is the one mutation permitted while `RUNNING`, because it only widens a cap and cannot invalidate anything. Everything else that touches artifacts requires the orchestrator to be parked, which is why the preview token (§21) expires — a confirmation must not apply to a state that moved underneath it.

Retrying on a `COMPLETED` run returns it to `RUNNING` after confirmation.

---

## 13. Orchestration

### 13.1 Bridging Inngest and Nest DI

Inngest functions are plain objects created by `createFunction()`; Nest services come from the DI container. A function defined at module scope cannot reach `StageRunnerService`. Resolution: a factory that runs after the container exists.

```ts
export function buildInngestFunctions(app: INestApplicationContext) {
  const stages = app.get(StageRunnerService);
  const runs   = app.get(RunStateService);
  const client = app.get(INNGEST_CLIENT);
  /* createFunction calls closing over resolved services */
  return [orchestrate, stageExecute, budgetSweep, blobGc, jobReaper];
}
```

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
app.useBodyParser('json', { limit: '10mb' });   // memoized step state grows with the run
app.use('/api/inngest', serve({ client: app.get(INNGEST_CLIENT), functions: buildInngestFunctions(app) }));
```

Functions belong to `OrchestrationModule`. Domain modules expose services; they never construct functions. Replacing Inngest later means rewriting one file.

### 13.2 Two rules

**Rule 1 — steps return references, never payloads.** Inngest memoizes step return values into function state for replay. Every `step.run` returns an ID. Local workspace paths never cross a step boundary.

**Rule 2 — two distinct retry concepts.**

| | Transport retry | Semantic retry |
|---|---|---|
| Cause | Network error, 5xx, rate limit | Check failed, QC below threshold, human rejection |
| Owner | Inngest (`retries: n`) | Engine loop in `stage.execute` |
| Counts against `retryLimit`? | No | Yes |
| New `stage_attempt` row? | No | Yes |
| New prompt? | No, identical | Yes, with critiques appended |

A semantic retry must mutate the prompt; an Inngest retry replays the same step deterministically. Conflating them produces a stage that fails identically N times.

### 13.3 Step boundaries and polling

```ts
// Reservation and submit share one step: queue wait happens before the step begins,
// so the pre-submit window is two adjacent statements rather than a round trip.
// ledger_one_reservation_per_attempt makes a replayed step reuse its reservation.
const handle = await step.run(`submit-${key}-${att}`, () =>
  stages.reserveAndSubmit({ runId, stageKey, attemptNo, itemIndex }));  // persists job_handle

let status;
for (let i = 0; i < maxPolls; i++) {
  status = await step.run(`poll-${key}-${att}-${i}`, () => stages.poll(handle));
  if (status.done) break;
  await step.sleep(`wait-${key}-${att}-${i}`, backoff(i));
}
if (!status?.done) { /* provider_timeout: cancel, settle per §11.3, consume an attempt */ }

const artifactId = await step.run(`fetch-${key}-${att}`, () =>
  stages.fetch(handle, { runId, stageKey, attemptNo, itemIndex }));
```

Polling defaults, resolvable per §5.1: backoff 5s → 15s → 30s capped; `maxWaitSec` 900 video, 300 audio and image, 120 text. Exceeding it produces `provider_timeout`, calls `cancel()`, settles per §11.3, and **consumes a semantic attempt** — an unresponsive provider is a failure of that attempt, not a free retry.

Because sleeps happen between steps, the function holds no compute while waiting and the run survives an API restart.

**Step execution timeout.** Every step here is short — submit, one poll, fetch — with waiting expressed as `step.sleep` between steps. Durable compute jobs (§4.4) follow the same shape with their own `maxWaitSec`. Verify the configured step timeout exceeds the slowest single `fetch`, which for a large video download is the realistic worst case.

### 13.4 Function topology

| Function | Trigger | Role |
|---|---|---|
| `run.orchestrate` | `run/started`, `run/resumed` | Walks stages in array order, owns run state |
| `stage.execute` | `step.invoke` | One stage: items, attempts, checks, QC, retries |
| `budget.sweep` | cron `*/15 * * * *` | Orphan reservation reconciliation |
| `blob.gc` | cron daily | Retention sweep |
| `job.reaper` | cron hourly | Abandoned compute job directories |

There is no per-item function. Items execute inside `stage.execute` as a sequential loop (§14), because they are not independent — item *i* may consume item *i−1*.

`run.orchestrate` carries `concurrency: { limit: 1, key: 'event.data.runId' }`, preventing two orchestrators for one run.

**The engine does not cap provider load across runs.** An earlier draft placed a provider-keyed Inngest constraint on `stage.execute` for this. It would not have worked: Inngest concurrency counts steps currently executing, and a function parked in `step.sleep` between polls holds no slot, so the limit would have bounded submit and poll calls while renders ran unbounded — a cap that reads as protection and provides none.

Rather than build a real one, the engine has no opinion. Whether to run several blueprints at once against the same provider is the operator's call, and their provider's rate limits and spend caps are the right place to enforce it. Concurrent runs may hit provider rate limits; those surface as `provider_error` and retry normally.

Within a run, nothing is parallel regardless (§14).

### 13.5 Cancellation

```ts
cancelOn: [{ event: 'run/cancelled', if: 'event.data.runId == async.data.runId' }]
```

`POST /runs/:id/cancel` performs, in order:

1. Set run state `CANCELLED`, preventing new stage starts.
2. Query in-flight attempts with a non-null `job_handle` and call `cancel()` on each. Without this, cancelling merely stops tracking jobs that continue to bill.
3. **Settle reservations according to what step 2 confirmed** — `release` where the provider confirms it stopped, provisional actual (§11.3) where it cannot. Releasing an unconfirmed job assumes a charge that may still arrive.
4. Send `run/cancelled`, releasing parked functions.

`cancel()` is best-effort; many providers will not stop a running render. Record the outcome per attempt so the cost is attributable rather than mysterious.

---

## 14. Iteration

`iterate` replaces v4's fan-out. Items run **in order**, never in parallel.

### 14.1 Execution

1. Resolve `iterate.over` → array of length N. Fail if it is not an array or N exceeds the effective `iterate.maxItems` (default 50).
2. Create N `stage_item` rows in state `pending`.
3. Loop `i` from 0 to N−1. For each: resolve bindings with `{from:'item'}` bound to element *i* and `{from:'prevItem'}` bound to item *i−1*'s output, reserve budget, submit, poll, fetch, run checks, run QC if permitted, retry to `itemRetryLimit`.
4. If item *i* exhausts retries, the stage fails and the run enters `FAILED`. Items 0…*i*−1 are preserved.

There is no continue-and-isolate. Items are a chain: item *i+1* may need item *i*, so skipping ahead is not meaningful.

### 14.2 Wall clock, stated plainly

Six ten-second clips at roughly four minutes each is about twenty-five minutes, not eight. Sequential iteration buys visual continuity — each clip can start from the previous one's last frame — and costs elapsed time. Runs are durable and the UI polls, so nothing breaks; it is slow by design rather than by accident.

### 14.3 Index alignment

`{from: 'prev', alignWith: 'item'}` resolves to **item *i* of the previous stage**. Valid only when the previous stage also iterates.

The validator canonicalizes each `iterate.over` Ref to a `(producerStageKey, path)` tuple and requires the tuples to be equal. Comparing Refs directly does not work: two stages' `{from:'prev'}` name different producers, so structurally identical Refs can denote different arrays.

| Ref | Canonical form |
|---|---|
| `{from:'prev', path}` | `(previous stage's key, path ?? '$')` |
| `{from:'memory', key, path}` | `(the key's writer stage key, writePath + path)` |
| `{from:'input', inputKey}` | `('$input:' + inputKey, path ?? '$')` |
| `{from:'const'}` | not permitted as an `iterate.over` for an aligned pair |

A runtime assertion confirms equal item counts before the first item executes, so a mismatch fails before any spend rather than at item N.

### 14.4 The carry, and derived frames

`{from: 'prevItem'}` is undefined for item 0; the validator requires any slot bound to it to be `required: false`, or the stage to supply a fallback via `config`.

Video artifacts expose derived frames without needing a stage:

```
{ from: 'prevItem', path: 'lastFrame' }
{ from: 'prev', path: 'firstFrame' }
```

The resolver extracts the frame locally with ffmpeg on first access, stores it as a `scope='run'` blob, and records it in `artifact.derived` so repeat access is free. This is what makes chained generation configurable in one line rather than requiring an extraction stage between every pair of clips.

### 14.5 Partial resume

On resume, the loop starts at the lowest item whose `stage_item.state` is not `passed`. This is a direct query, not a fold over attempt rows — the reason `stage_item` exists. Completed items are neither regenerated nor recharged, which is the main cost protection in the system since iteration is where video spend concentrates.

---

## 15. Invalidation

### 15.1 Triggers

Stage retry, item retry, manual artifact edit, run input replacement, or an override changing a stage's generative configuration.

### 15.2 Invalidation by recorded reads

Array position alone over-invalidates. Retrying a b-roll stage would discard the music stage that follows it and never read it, and no ordering fixes this — put music first and a music retry discards every clip.

Nothing new has to be declared to do better. `stage_attempt.resolved_inputs` already records what each attempt actually read, including the memory version (§6.3). Invalidation is computed from those records:

```
invalid = { the retried stage, or the retried item }
for each later stage S in array order:
    if S bound {from:'prev'} to a stage in invalid
    or S read (via slots, context, or check refs) a memory version
       written by a stage or item in invalid
    or S reads a run input being replaced
  then add S, and its affected items, to invalid
```

The source is the **active attempt's** record. A stage that never ran has no artifact to invalidate, so its absence from the records is correct rather than a gap.

This keeps the model declaration-free — the user never draws a graph — while re-running only genuine dependents.

**Memory readers are dependents.** A stage that consumed a memory version written by an invalidated stage read a value that has changed, so it is invalidated like any other consumer. Memory is a route past the previous stage, not an exemption from dependency tracking. A finished run is internally consistent.

**Item-level.** Retrying item *i* invalidates later items of the same stage **only if the stage binds `{from:'prevItem'}`** in any slot, context binding, or check `refs`. Where it does not, items are independent and only item *i* is invalidated. A following stage with `alignWith: 'item'` has only its item *i* invalidated. Retrying a whole iterating stage invalidates all its items.

Without this rule, retrying one clip in a six-clip stage discards four paid-for clips that were never derived from it.

Cost preview (REQ-4.3) is computed over the resulting artifact set, so the user sees the spend at risk before confirming.

### 15.3 The active-artifact rule

An artifact is **active** iff `stale = false`. Nothing else — not generation, not recency.

Partial resume produces mixed generations within one stage: re-running items 3–5 of 20 yields artifacts at generation N+1 alongside survivors at generation N. "Active = current generation" is therefore wrong. The partial unique index in §3.9 enforces at most one active artifact per `(run, stage, item)`, so a resolver bug surfaces as a constraint violation rather than a silently wrong input. `generation` is retained for UI labelling of attempt history.

### 15.4 Manual edits

A manual edit writes a `stage_attempt` with `outcome: 'user_edit'` and `actor: 'user'`, recording the prior artifact ID, the new value, and the timestamp.

The new artifact is validated against the stage's `output` schema — a type guarantee — but skips checks and QC. The user outranks the judge.

A hand-edited timeline must carry canonical handles, so the editor supplies a media picker rather than a free-text handle field. There is no rewrite pass on a manual edit — nothing generated it, so nothing recorded a relative mapping to rewrite from.

**Order is not negotiable.** Within one transaction: mark the prior artifact stale **first**, insert the replacement with `stale = false`, then repoint `output_artifact_id` and increment `attempt_count`. Inserting before staling violates `artifact_active_uq`, and the index cannot be deferred (§3.9.1). Every supersede path follows this order.

### 15.5 Procedure

```
1. dependents = closure computed per §15.2 from recorded reads
2. preview: per affected artifact, cost spent + estimated re-run cost
3. return to UI, await explicit confirmation
4. on confirm, one transaction:
     artifact.stale = true for target + dependents
     stage_item.state / stage_execution.state = 'stale'
     for every memory key written by an invalidated stage or item:
       append a run_memory version with tombstone = true
     blob.gc_eligible = true, blob.gc_eligible_at = now()
       for stale run-scoped media blobs only
5. resume from the earliest invalidated stage
```

The tombstone write is in the same transaction as the stale marking, so memory and artifacts can never disagree about what is current. It is what prevents an iterating stage re-run with fewer items from leaving orphaned indexed entries (§6.3).

Step 4 writes `gc_eligible_at` alongside `gc_eligible`, always. §4.5's query filters on the timestamp, and `NULL < now() - interval` evaluates to NULL rather than true — so a blob marked eligible without a timestamp is not late to collection, it is permanently invisible to the sweep. Since invalidation is the primary source of collectable media, omitting it would mean retention never fires while appearing correctly configured. Treat them as one write.

Nothing is hard-deleted. Stale records remain queryable indefinitely; only blobs are collected, on retention, and only run-scoped ones.

---

## 16. Validator

Runs on every save. `blueprint_version.runnable` stays false while errors exist.

### 16.1 Ordering invariant

**Stage array order is execution order.** Since a stage may bind only the previous stage, forward references are structurally impossible and cycles cannot form. The invariant reduces to: the first stage may not use `{from: 'prev'}`.

The engine does not reorder stages or judge sequencing. It only refuses orders that cannot execute.

### 16.2 Errors

**Structure**
- First stage binds `{from:'prev'}`
- Unknown capability key, or `config` failing `configSchema`
- Required slot unbound
- Slot bound to a source whose kind or schema is incompatible (§16.4)
- `cardinality: 'one'` slot bound to an iterating producer, or `'many'` to a scalar

**Schemas and templating**
- Invalid JSON Schema, or a keyword outside the restricted dialect (§4.2)
- Template path does not exist in the bound value's schema
- `iterate.over` does not narrow to an array schema

**Bindings**
- `{from:'memory'}` reads a key no earlier stage writes
- `{from:'input'}` references an undeclared input
- `{from:'asset'}` references a missing asset
- `{from:'role'}` references an undeclared role
- `{from:'prevItem'}` in a non-iterating stage, or bound to a `required: true` slot without a fallback
- `alignWith: 'item'` where the previous stage does not iterate, or the two `iterate.over` Refs differ after canonicalization (§14.3)

**Model legality**
- Capability slot illegal for the pinned model — `endFrame` on a model without it
- Requested aspect ratio unsupported by the pinned model
- Requested duration unsupported by the pinned model, **when it is a constant**. A `durationFrom` Ref is only known at runtime (§17.5); it is snapped to a supported value, and a result still outside range fails the attempt as `check_failed` before submit, so no spend occurs
- `vision: true` on a model without vision support
- Text stage without `max_tokens` in effective model params (§16.5)
- Model pinned to a floating alias such as `latest`

**QC and checks**
- **`qc` declared on a stage whose output kind is `media.video`** (§10.1)
- Blueprint declares more than one role (§18.5)
- `approval.onReject.retryStageKey` is not this stage or an earlier one
- `approval.mode: 'item'` on a non-iterating stage
- Script check fails to compile in the sandbox
- The `timeline` slot is bound to a source whose kind is not `timeline`

**Runtime feasibility**
- Post-submit reservation TTL shorter than the modality's poll + fetch window (§11.4)
- Required slot bound to `{from:'prev'}` of a stage carrying `enabledWhen`, without the same condition or `required: false` (§16.6)
- Required slot or context binding reads a memory key whose every writer carries `enabledWhen`, and the reader does not carry the same condition
- Template path reads a binding that may be absent — templates have no conditionals, so optional values belong in slots with `required: false` and a capability default

### 16.3 Warnings

- `data` output with empty schema `{}`
- Stage with neither checks nor QC — and, separately, a video stage with neither checks nor approval, which has no gate at all
- Video-modality stage with no effective stage cap
- `supportsStructuredOutput: false` on a `data` stage with a deep schema
- Narrated blueprint where a planning stage precedes speech alignment (§17.5)
- Timeline-writing stage with no media manifest in context
- Blueprint declares a role no stage binds
- Sum of stage caps exceeds run cap
- A memory key written by more than one stage — legal, last-writer-wins, but rarely intended
- `approval.onReject` targets a stage with no `instructions`; a rejection note cannot change a deterministic output

### 16.4 Compatibility is a component

Checking "this source satisfies this slot at this path" is structural subtype checking across a dot-path into a schema. Neither Zod nor Ajv gives it directly. Implementation needs Zod → JSON Schema conversion for fixed kinds, a path resolver narrowing a schema to a dot-path, and a compatibility walker.

**Compatibility is nominal by kind at the top level, structural below.** `media.image` satisfies a slot accepting `media.image` or `media.*`. A path into a user schema is checked structurally against the slot's accepted schema, made tractable by the restricted dialect. Slots accept kinds, kind patterns, or schemas, so the walker handles both forms.

The same introspection backs the editor's generated forms. Budget it as a multi-day component in phase 2, not a validator bullet.

### 16.5 Cost ceilings for text

`ceilingUsd` is what gets reserved. For token-priced calls, input is boundable but output is not unless `max_tokens` is set — an unbounded reservation is not a reservation. `max_tokens` is required in effective `model.params` for text modality, enforced at save time.

### 16.6 Conditional stages

```ts
type EnabledWhen = { input: string; equals: string | number | boolean };
```

Evaluated **once at run start** from `run.inputs`, never from runtime outputs, so the graph is fully known before any spend and cost estimates stay static. Disabled stages get `stage_execution.state = 'skipped'`.

**Skipped stages are not transparent.** `{from:'prev'}` always means the immediately preceding stage in array order; if that stage is skipped, the binding resolves to absent.

Transparency was the obvious rule and it breaks static typing: if `prev` silently retargets to the last *enabled* stage, its type depends on which stages are enabled, and the validator would have to check every combination — exponential in the number of optional stages, and unverifiable at save time, which is where the engine's guarantees live.

A slot bound to `prev` of a conditional stage must therefore be `required: false`, or carry the same `enabledWhen`. Anything a stage needs from before an optional stage travels through memory, where the dependency is explicit and the validator can see it.

---

## 17. Assembly: Timeline and Concat

### 17.1 Timeline schema

Engine-owned, Zod in `shared`.

```ts
type Timeline = {
  version: 1;
  canvas: { width: number; height: number; fps: number; background?: string };
  tracks: Track[];                                // lower index renders underneath
};

type Track = { id: string; type: 'video' | 'audio' | 'overlay' | 'captions';
               duckUnder?: string; items: TimelineItem[] };

type TimelineItem =
  | { type: 'media'; handle: string; startSec: number;
      durationSec?: number; trimInSec?: number;
      fit?: 'cover' | 'contain' | 'fill';
      overflow?: 'trim' | 'loop' | 'freeze' | 'speed';
      volume?: number; fadeInSec?: number; fadeOutSec?: number;
      motion?: { type: 'ken_burns' | 'zoom_in' | 'pan'; intensity?: number };
      transitionIn?: { type: 'cut' | 'crossfade' | 'slide' | 'wipe'; durationSec: number } }
  | { type: 'text'; text: string; startSec: number; durationSec: number;
      styleId: string; position: 'top' | 'center' | 'bottom' | { x: number; y: number } }
  | { type: 'captions'; timingHandle: string; styleId: string; startSec?: number };
```

Design rules:

- **Handles, not blob IDs** (§6.6). A stored timeline contains only canonical handles (`artifact:…`, `asset:…`); the LLM writes relative ones and the engine rewrites them before checks run.
- **Styles are registered in code** (`styleId`), not free-form CSS. An LLM choosing from `caption.bold_pop` or `lower_third.minimal` produces consistent output and cannot break the renderer. Styles are listed at `GET /styles`.
- **Ducking is declared on the track** (`duckUnder`), not computed by the LLM.

### 17.2 `timeline.render`

- Slot: `timeline` (kind `timeline`, required). Media resolves through canonical handles, so the slot list does not grow with the timeline's complexity and the renderer never interprets a relative handle.
- Output: `media.video`, plus an optional `file.subtitles` sidecar when `exportSubtitles` is set.
- Async compute job via `ComputeJobService`. All referenced blobs are pulled into the job directory before spawn.
- Config `quality: 'draft' | 'final'`. Draft renders at reduced resolution for **human review**; final renders after approval, so a timeline that will be revised does not cost a full render.
- Renderer: Remotion behind a `Renderer` interface, with an ffmpeg renderer for simple cut-and-mux timelines. Remotion needs headless Chromium in the render environment.

**Licensing.** Remotion is free for individuals and for-profit teams of up to three people, commercial use included. Above that, this engine falls in their Automators tier — explicitly aimed at prompt-to-video apps and automated pipelines — at $0.01 per render with a $100/month minimum. The cost appears at a fourth hire, not at a usage threshold. The `Renderer` interface and the ffmpeg fallback are what keep that switchable.

### 17.3 Built-in timeline checks

Run automatically on every `timeline` output, before user checks.

| Check | Fails when |
|---|---|
| `timeline.handles_resolve` | A canonical handle points at no existing non-stale artifact, or at no existing asset |
| `timeline.styles_exist` | A `styleId` is not registered |
| `timeline.source_bounds` | `trimInSec + durationSec` exceeds probed source duration and `overflow` is not `loop`/`freeze`/`speed` |
| `timeline.coverage` | The primary video track has gaps, when `config.allowGaps` is false |
| `timeline.av_alignment` | The last audio item ends more than `toleranceSec` from the last video item |
| `timeline.canvas_match` | Canvas aspect ratio differs from effective `format.aspectRatio` |

Failures feed the critique like any check, so the timeline-writing LLM gets precise errors — `clip#3: requested 7.0s from a 5.0s source`.

### 17.4 `video.concat`

The common case without timeline JSON. Slots: `clips` (`media.video`, cardinality many), optional `audio`, optional `subtitles`. Config covers ordering, transition between clips, whether subtitles are burned or sidecar, and output format. Async compute job via ffmpeg.

### 17.5 Duration reconciliation

Nothing forces generated clip durations to agree with narration. Three points address it:

1. **Plan from real audio.** A narrated blueprint should run `audio.speech` then `media.analyze(transcribe_align)` *before* the planning stage, binding timing into the planner's context. Scene durations then come from measured speech rather than an LLM estimate. Template presets encode this order and the validator warns when it is inverted.
2. **Snap to provider durations.** `video.generate` config takes `durationFrom: Ref` plus `snap: 'up' | 'nearest'`, rounding the request to the model's supported durations — up by default, so there is always enough footage to trim.
3. **Resolve at assembly.** Each timeline media item declares `overflow`; `timeline.source_bounds` and `timeline.av_alignment` verify the result before render.

---

## 18. Characters

Unchanged from v4 in substance. A Character is a persistent identity asset; a Blueprint declares roles; a Run binds roles to Characters and snapshots them.

### 18.1 Reference selection

```ts
type ReferencePolicy = { maxRefs: number; prefer: ReferenceView[]; alwaysIncludePrimary: boolean };
```

`primary_ref_id` first, then fill by walking `prefer`, then by `order`, stopping at `maxRefs` — which comes from the pinned model's capabilities, not stage config. Selected blob IDs are recorded in `stage_attempt.resolved_inputs` so an inconsistent clip traces to the exact references that produced it.

### 18.2 Getting references in

**Uploaded:** presigned PUT, browser to MinIO, then confirm with view and caption. The API never proxies image bytes.

**Generated:** a run produces candidates and the user promotes chosen artifacts. Promotion **copies** the object into the `characters/` prefix as a new `scope='character'` blob rather than referencing the run's blob — otherwise the reference would be subject to run GC and invalidation, and retrying a long-finished stage would mark a live Character's identity anchor stale. `sourceArtifactId` preserves provenance without lifecycle coupling.

This is the bootstrapping path: generate a character sheet with the engine, promote the best results.

### 18.3 Readiness

At run start each bound Character must be `readiness = 'ready'` — at least one non-deleted reference or a trained LoRA. Failing this blocks the run **before any spend** rather than after clips are paid for.

### 18.4 Consistency in a sequential engine

Two mechanisms now coexist, and they suit different cases:

- **Reference conditioning** (§18.1) anchors every clip to the same identity. Independent per item.
- **Chained generation** (§14.4) starts each clip from the previous clip's last frame. Continuous, but drift accumulates over a long chain.

A blueprint can use either or both — references for identity, the carry for motion continuity. The engine has no opinion; both are bindings.

**LoRA training** is out-of-band: a Character-scoped async job with its own cost tracking. A run consumes a trained LoRA and never trains one mid-pipeline.

**Faceless runs** bind zero roles. No code path requires a role.

### 18.5 One character at a time

**A blueprint may declare zero or one role.** Two or more is a save-time validation error.

This is a scope decision, not a structural one. `blueprint_version.roles` stays an array, `run.role_bindings` stays a map, and `RoleDef` is unchanged — only the validator objects. Enabling multiple characters later is one rule removal plus whatever §18.6 concludes, with no migration and no change to any stored blueprint.

What the constraint buys immediately: reference selection (§18.1) gets the pinned model's entire `maxRefs` budget for a single identity. A model taking four references receives front, three-quarter, profile, and full-body — the multi-view set the policy was designed around. Split across two characters, the same model gives each one view and the policy degrades to "send whatever fits", which is materially worse consistency for materially more complexity.

Zero roles remains fully supported: faceless and characterless blueprints are the common case, not a special one (REQ-11.4).

### 18.6 Deferred

**Multi-character shots.** When the constraint lifts, two questions must be answered together rather than in sequence. Does `image.generate` take a `subject` slot with `cardinality: 'many'`, or do multi-character blueprints run sequential single-character stages and composite? And how does reference budget degrade when several identities compete for one `maxRefs` allowance — equal split, primary-only per character, or a fallback to compositing when the budget cannot cover the cast? Deciding the slot shape first would likely force a redesign once the degradation behavior is built.

**Roles as typed inputs.** Longer term a role is just a run input whose value is a character snapshot. Unifying `roles` into `inputs` (`accepts: { kind: 'character' }`) removes a parallel binding path and lets non-person identities — a product, a mascot, a location — reuse reference selection and the readiness gate. Defer until the input system is proven.

---

## 19. Reproducibility

```ts
type ModelPin = { provider: string; modelId: string; version?: string; params: Record<string, unknown> };
```

Pinned per stage, snapshotted into `run.resolved_config` at start. Floating aliases are rejected.

| `repro_level` | Condition |
|---|---|
| `exact` | seed captured, version pinned, provider documents determinism |
| `approximate` | version pinned, no seed available |
| `none` | neither |

Surfaced per artifact so "why can't I reproduce this clip" has a visible answer. `raw_response_ref` retains the full provider response regardless of level.

**Run Memory is snapshotted per read**, not per run: `stage_attempt.resolved_inputs` records the memory version each attempt consumed. Without this, replaying a run would show whatever memory holds today rather than what that attempt actually saw.

---

## 20. Template Library

Templates are how schemas, checks, and whole blueprints become shareable — the mechanism that keeps genre knowledge out of the engine (§2).

```sql
template (
  id            text PRIMARY KEY,
  owner_id      text NOT NULL DEFAULT 'local',
  source        text NOT NULL,          -- 'builtin' | 'user'
  kind          text NOT NULL,          -- 'blueprint' | 'schema' | 'check' | 'stage'
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  tags          text[] NOT NULL DEFAULT '{}',
  archived      boolean NOT NULL DEFAULT false,
  UNIQUE (owner_id, kind, name)
)

template_version (
  id           text PRIMARY KEY,
  template_id  text NOT NULL REFERENCES template(id),
  version      integer NOT NULL,
  body         jsonb NOT NULL,          -- StageDef[] | JsonSchema | CheckDef | StageDef
  requires     jsonb NOT NULL DEFAULT '{}',   -- { capabilities: [], inputs: InputDef[] }
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
)
```

Immutable versions, matching the Blueprint model. `source = 'builtin'` marks engine-shipped presets — the timing schema, common script and scene schemas, the three reference blueprints from §25 — seeded on migration and not user-editable; `'user'` marks saved work.

**Instantiation copies, never references.** `POST /templates/:id/instantiate` creates a new `blueprint_version` with the template body **inlined**, recording `source_template_id` for provenance. Schema presets inline the same way, which is necessary anyway since the restricted dialect disallows `$ref` (§4.2).

The consequence is deliberate: updating a template does not change blueprints already made from it. Blueprint versions are immutable, and a template that could mutate an existing blueprint would break that. The editor can offer a diff against a newer template version, which the user applies as an ordinary edit producing a new blueprint version.

`requires` lets the editor warn before instantiating — a template needing `video.generate` and an input the channel has no asset for should say so up front rather than failing validation afterwards.

---

## 21. API Surface

Nest controllers under `/api`. Single-user, no auth; `ownerId` comes from an `@Owner()` decorator backed by a resolver returning `'local'` — the multi-tenant seam. When auth arrives, the decorator changes and controllers do not.

```
GET    /capabilities                      # registry listing
POST   /capabilities/:key/resolve         # { config } -> slots, allowedOutputs
GET    /check-types                       GET /styles
GET    /providers/:id/models              # with per-model capabilities

GET    /channels                          POST   /channels
GET    /channels/:id/assets               POST   /channels/:id/assets    # -> presigned PUT
DELETE /assets/:id
GET    /channels/:id/characters           POST   /channels/:id/characters
GET    /blueprints/:id/characters         POST   /blueprints/:id/characters
GET    /characters/:id                    PATCH  /characters/:id
POST   /characters/:id/references         PUT    /characters/:id/references/:blobId
POST   /characters/:id/references/promote DELETE /characters/:id/references/:blobId
PUT    /characters/:id/primary-reference  POST   /characters/:id/lora

GET    /blueprints/:id/versions           POST   /blueprints/:id/versions
POST   /blueprints/:id/validate           # dry-run validator, no persist
POST   /blueprints/:id/versions/:v/dry-run  # full run against FakeProviderAdapter

GET    /templates                         POST   /templates
POST   /templates/:id/instantiate         GET    /templates/:id/versions

GET    /runs                              POST   /runs
POST   /runs/:id/inputs/:key/upload       # presigned PUT before start
PUT    /runs/:id/inputs/:key              # replace -> invalidation preview
GET    /runs/:id                          GET    /runs/:id/events        # SSE
GET    /runs/:id/memory                   # current + version history (§6.3)
POST   /runs/:id/cancel                   POST   /runs/:id/resume
PATCH  /runs/:id/overrides                POST   /runs/:id/budget

GET    /runs/:id/stages/:key/items        GET    /runs/:id/stages/:key/attempts
GET    /runs/:id/invalidation-preview?stageKey=&itemIndex=
POST   /runs/:id/stages/:key/retry        # -> { previewToken, affected[], costs }
POST   /runs/:id/stages/:key/retry/confirm
POST   /runs/:id/stages/:key/items/:i/retry
POST   /runs/:id/stages/:key/items/:i/retry/confirm
POST   /runs/:id/stages/:key/approve      # { action, note?, itemIndex? }; reject returns a preview token
POST   /runs/:id/stages/:key/input        # human.input submission
POST   /runs/:id/stages/:key/artifact     # manual edit

POST   /checks/test                       # { check, artifactId } -> CheckResult
GET    /artifacts/:id                     GET /blobs/:id   # 302 or 410
```

Two-call retry: the first returns a `previewToken` with the affected set and costs; the second executes against it. The token encodes the computed invalidation set and expires (default 10 min), so a confirmation cannot apply to a stale preview.

### 21.1 Validation

A global `ZodValidationPipe` against DTOs in `shared`, not `class-validator`. The editor needs runtime-introspectable schemas, and two parallel validation systems for the same shapes will drift.

### 21.2 SSE

Nest's `@Sse()` returning an `Observable<MessageEvent>`, fed by an in-process RxJS subject that `RunStateService` publishes to on state, cost, and stage transitions.

This is the one component with no multi-tenant seam, deliberately: an in-process subject is correct for single-replica and wrong the moment a second replica exists, since a client on replica A hears nothing about work on replica B. The replacement is Postgres `LISTEN/NOTIFY` or Redis pub/sub behind the same `RunEvents` interface — one implementation swap, flagged so it is a decision rather than a discovery.

### 21.3 Blob access

`GET /blobs/:id` authorizes, then `302`s to a short-lived presigned MinIO URL (default 15 min), so range requests and seeking are MinIO's concern and large media never occupies the Node event loop. Collected blobs return 410.

This makes MinIO a second origin, so bucket CORS must allow the app origin for `GET` and `HEAD` with `Range` — otherwise playback fails in the browser while `curl` succeeds. Presigned URLs carry their signature in the query string and are bearer tokens: redact them from logs.

---

## 22. Testing

Every execution path costs money, so a fake provider is a first-class component, not a fixture. It lands in **phase 1**.

**`FakeProviderAdapter`** implements the full adapter interface with scripted latency, deterministic cost, and injectable failures: transport error, timeout, malformed response, unconfirmable cancel, cost overrun. Selected by `provider: 'fake'` in a ModelPin, so a whole blueprint runs end to end for free. `POST /blueprints/:id/versions/:v/dry-run` exposes this to users.

What it makes testable that otherwise is not:

- **Idempotency** — force a transport retry after a successful submit, assert one provider job.
- **Sequential iteration and the carry** — assert item *i* receives item *i−1*'s output, and that `lastFrame` extraction is cached rather than recomputed.
- **Partial resume** — fail item 7 of 20, resume, assert items 0–6 were not re-executed or recharged.
- **Precise invalidation** — retry `broll` in §25.1; assert `music` stays active and is not recharged. Retry `music`; assert every `broll` item stays active.
- **Item independence** — retry item 2 of a stage that does not bind `prevItem`; assert items 3–5 stay active. Repeat with `prevItem` bound; assert they go stale.
- **Memory consistency** — retry a writer; assert its readers are invalidated and its keys tombstoned. Retry an iterating stage producing fewer items; assert a base-key read returns the new count. Fail an attempt's checks; assert memory is unchanged.
- **Settlement branches** — provisional actual on unconfirmed cancel and timeout; plain release on confirmed non-billing.
- **Pre-submit orphan** — crash between reservation and submit; assert the sweep releases it at `preSubmitTtlSec` rather than leaving it forever.
- **Orchestrator vs user action** — fire a budget raise and an override patch while a stage is mid-flight; assert the row lock serializes them and a stale preview token is rejected.
- **Handle rewriting** — assert a stored timeline contains only canonical handles, and that a hallucinated handle fails the attempt before storage.
- **Schema retry** — a fake that returns schema-violating JSON, asserting the Ajv paths reach the retry prompt.

**Record/replay cassettes** capture real provider responses once and replay them in CI, so parsing logic is tested against real payload shapes without repeat spend.

### 22.1 The nullable-timestamp-in-a-sweep-predicate class

Two defects in this document's review history had the identical shape: a nullable timestamp column, set on one code path and compared with `<` on another, where a comparison against `NULL` in SQL evaluates to `NULL` rather than `false` and the row silently never matches. `gc_eligible_at` (§4.5) and an earlier draft of `expires_at` (§11.4) both had this property, and both passed schema review, index review, and query review individually — the bug lives in the gap between the writer and the reader, which no single section's review sees.

Treat this as a standing rule for phase 1, not a one-off fix: **every sweep query (`budget.sweep`, `blob.gc`, `job.reaper`) gets a test that inserts a row with the compared timestamp left `NULL` and asserts the sweep either handles it or the write path that produced it is unreachable by construction** (`NOT NULL DEFAULT`, or an application assertion on insert). Write these three tests in phase 1 alongside the schema, before the sweeps have any real data to hide behind.

---

## 23. Configuration & Secrets

- Provider API keys in `.env` / OS keychain via `KeyProvider { get(providerId) }`. Never in Postgres, artifacts, or logs.
- MinIO credentials from the same config module, with `S3_FORCE_PATH_STYLE` set. Root credentials are console-only; the app uses a scoped service account limited to its bucket.
- `redactSecrets()` covers provider requests before persistence, and presigned URLs in logs.
- Engine config: workspace root, presign TTL, blob retention days, `iterate.maxItems` default, `preSubmitTtlSec`, `fetchAllowanceSec`, poll intervals and caps, `qcErrorRetries`, `infraRetries`, sandbox memory and time limits.
- Bootstrap ensures the bucket exists, applies the CORS rule, and seeds builtin templates, so a fresh clone plus `docker compose up` is a working environment.

---

## 24. Build Order

1. **Skeleton** — workspace, Drizzle schema, MinIO with bucket bootstrap, Nest modules, `shared` with StageDef and Ref, Inngest via the DI factory, `text.generate` over OpenRouter, **`FakeProviderAdapter`**, minimal React shell. One-stage blueprint end to end.
2. **Core loop** — config resolver; binding resolver with slots and context; restricted JSON Schema + Ajv; compatibility walker (§16.4); template paths; builtin and script checks with the QuickJS sandbox; QC; semantic retry. *Test: a three-stage text blueprint with user-defined schemas and a cross-artifact script check.*
3. **Budget** — ledger, row-locked reserve/reconcile, settlement branches, `PAUSED_BUDGET`, orphan sweep with submit-anchored TTL. Exercised against a slow, costly fake.
4. **Inputs and human-in-loop** — run inputs, channel assets, Run Memory with tombstones, stage approval with reject routing, `human.input` with `PAUSED_INPUT`, manual edit, invalidation from recorded reads, overrides, resume, the action matrix.
5. **Media** — image, speech, video adapters with per-model capabilities; `media.analyze` probe and alignment; format config; media manifests; ffprobe population.
6. **Assembly** — `video.concat`, timeline schema, styles registry, built-in timeline checks, `timeline.render` via ComputeJobService, draft/final quality. *Test: render a video assembled purely from uploaded inputs, with no generation at all.*
7. **Iteration** — `iterate`, sequential loop, `prevItem` carry, derived frames, per-item retry, partial resume, duration snapping.
8. **Characters** — assets, reference upload and promotion, readiness gate, selection policy, LoRA job.
9. **Editor and templates** — capability-resolved forms, schema editor, script-check tester, template library, dry-run.

Phase 6 is the real test of genericity: if a video can be assembled from inputs alone with no generation, the engine is not secretly a reel generator. Phase 7 is where the money protection becomes real, which is why the fake provider exists from phase 1.

---

## 25. Worked Examples

Three blueprints stressing different parts of the design. All ship as builtin templates and double as validator regression fixtures.

### 25.1 Narrated faceless explainer, 9:16

Run input: `topic` (`text`). Inputs are not stages.

| # | Stage | Capability | Output | Writes | Notes |
|---|---|---|---|---|---|
| 1 | `script` | `text.generate` | `data` | `script` | binds `input:topic` |
| 2 | `vo` | `audio.speech` | `media.audio` | `vo` | |
| 3 | `timing` | `media.analyze` (transcribe_align) | `data` | `timing` | |
| 4 | `shots` | `text.generate` | `data` (array) | `shots` | binds `prev` + `memory:script` |
| 5 | `broll` | `video.generate`, iterates `memory:shots` | `media.video` | `broll` | `approval: { mode: 'item' }` |
| 6 | `music` | `audio.music` | `media.audio` | `music` | binds `memory:script` only |
| 7 | `timeline` | `text.generate` | `timeline` | `timeline` | manifests for `memory:broll`, `vo`, `music` |
| 8 | `draft` | `timeline.render` (draft) | `media.video` | — | `approval: { onReject: { retryStageKey: 'timeline' } }` |
| 9 | `final` | `timeline.render` (final) | `media.video` | — | binds `memory:timeline` |

Four things this example exists to demonstrate:

- **`timeline` writes to memory** so that `final` can reach it. `final`'s `prev` is `draft`, a rendered video — the timeline is two stages back, and memory is the only route (§6.1).
- **There is no approval stage.** `draft` carries `approval` itself. A gate stage would produce no output and `final`'s `prev` would resolve to nothing.
- **Rejecting `draft` retries `timeline`**, not `draft`. Re-rendering the same timeline reproduces the same video; the note has to reach the stage with `instructions` (§10.5).
- **`broll` uses item-mode approval**, so a bad clip is caught before the next clip is generated from its last frame. Stage-mode approval would surface it after five clips were paid for.

`broll` has checks on duration and resolution but **no QC**, per §10.1. The draft render exists so a human reviews at low cost before `final` pays for a full render.

Stresses: duration reconciliation, manifests, memory as the long-range data path, draft/final split.

### 25.2 Product demo from user material, 16:9

```
brief (input:text) + screenshots (input:media.image, many) + logo (asset)
  → outline   (text.generate, vision on screenshots)     writes: outline
  → vo        (audio.speech)                            writes: vo
  → timing    (media.analyze:transcribe_align)          writes: timing
  → timeline  (text.generate:timeline)
  → render    (timeline.render)
```

Screenshots get `ken_burns` motion, the logo is an overlay, captions come from timing. **Nothing is generated** — no image model, no video model. The output is entirely assembly of material the user supplied.

This is the genericity test. If this blueprint needs a code change, the engine is still reel-shaped.

### 25.3 Music visualizer, 1:1

```
track (input:media.audio)
  → beats    (media.analyze:beats)                      writes: beats
  → sections (text.generate:data, context: beats)        writes: sections
  → theme    (human.input: choose visual theme)         writes: theme
  → prompts  (text.generate:data, one per section)       writes: prompts
  → clips    (video.generate, iterates over memory:prompts,
              startFrame from prevItem.lastFrame)       writes: clips
  → timeline (text.generate:timeline, cuts aligned to beats)
  → render   (timeline.render)
```

Stresses: analysis-driven planning, `human.input` and `PAUSED_INPUT`, the `prevItem` carry with derived frames, and a script check asserting timeline cut points fall within 50 ms of detected beats. No speech at all.

### 25.4 Failure and invalidation traces

**Failure.** `broll` item 4 of 6 fails its duration check twice and exhausts `itemRetryLimit`.

1. `stage_item(broll, 4).state = 'failed'`; items 0–3 are `passed` with artifacts intact. Item 5 never started — iteration is sequential.
2. Run → `FAILED`, `cursor_stage_key = 'broll'`. Four clips of video spend preserved.
3. The user inspects attempts for item 4, patches the stage config via `PATCH /runs/:id/overrides`, and resumes.
4. The loop restarts at item 4 (§14.5). Items 0–3 are neither regenerated nor recharged.

**Invalidation, and what it does not touch.** The user dislikes `broll` item 2 and retries it.

1. `broll` binds `{from:'prevItem'}` for start-frame continuity, so items 3–5 are dependents and go stale. Item 2 plus three successors.
2. `timeline` read `memory:broll` and is invalidated. `draft` and `final` follow from `timeline`.
3. **`music` is not invalidated.** It reads only `memory:script`, which nothing in the invalid set wrote. Under array-position invalidation it would have been discarded for coming after `broll`; under §15.2 it survives.
4. Memory keys `broll#2…#5` are tombstoned in the same transaction, so a base-key read during the re-run sees only the surviving entries.
5. Preview reads: "re-run 4 clips ($1.60) + timeline + 2 renders. Music preserved."

**Rejection routing.** The user rejects `draft` with the note "cuts land after the beat".

1. An attempt with `outcome: 'rejected'` and the note is written on `draft`.
2. The note is appended to `timeline`'s critique log, and the rejection consumes one of `timeline`'s retries.
3. Invalidation is computed from `timeline`: `timeline`, `draft`, `final`. Every clip survives — nothing regenerates video.
4. `timeline` re-runs with the note in its prompt and produces a revised timeline.

Had the rejection retried `draft` instead, the same timeline would have re-rendered to the identical video and burned a retry.

---

## 26. Decisions, Consequences, and Open Questions

### 26.1 Deliberate simplifications

Recorded so a future reader sees decisions, not drift.

**No parallelism anywhere.** Stages run in array order; items run in order within a stage. Cost: a six-clip video stage takes roughly twenty-five minutes instead of eight. Benefit: item *i* can consume item *i−1*, which is what makes chained generation possible at all, and the entire concurrency surface — races, per-modality limits, fan-out scheduling — disappears.

**A stage binds only the previous stage.** Everything further back goes through Run Memory. Cost: memory becomes the primary long-range data path, and a blueprint author must remember to write a value before a later stage can use it — a missing `writes` is a validation error rather than a silent failure, but it is still bookkeeping the user carries. Benefit: no declared graph, no forward references, no cycles, and ordering that matches how the pipeline reads.

**Run Memory is tracked, not exempt.** An earlier draft asserted that memory readers were never invalidated, and described that as the sharpest trade in the design. It was not a trade, because it was not reachable: the validator requires a memory key to be written by an earlier stage, so a reader always follows its writer, and any rule that invalidates dependents covers it. v5.1 makes this explicit — memory reads are recorded per attempt and participate in invalidation like any other dependency. A finished run is internally consistent. The freedom the user asked for turned out to cost nothing, because the architecture had already closed the gap.

**Dependents come from observation, not declaration.** The user is never asked to draw a dependency graph; the engine reads `stage_attempt.resolved_inputs`, which it records anyway. This keeps authoring simple while avoiding the waste of discarding a music stage because it happened to follow a video stage. The cost is that invalidation reasons about run history rather than blueprint structure, so a preview depends on what actually ran — which is more accurate, but harder to explain in the editor before a run exists.

**QC is forbidden on video.** Video has no automated quality gate. Checks verify duration, resolution, and codec; a human verifies everything else. Rejection notes feed the retry prompt so the human occupies the slot QC vacated.

**Templates copy rather than reference.** Updating a template never changes an existing blueprint. The editor offers a diff instead.

### 26.2 Defaults applied

1. `iterate` replaces `fanOut`, since items are a sequential chain rather than a parallel spread.
2. Two assembly capabilities — `video.concat` and `timeline.render` — so concatenation does not require timeline JSON.
3. Reservation TTL anchored at submit.
4. `output.schema` excluded from run overrides.
5. Implicit Ajv check short-circuits before other checks.
6. Prompt-and-validate fallback for models without native structured output; warn, do not block.
7. Assets addressed by ID in handles, matching `{from:'asset', assetId}`.
8. `PAUSED_INPUT` distinct from `PAUSED_APPROVAL`.
9. Memory versioned for audit only.
10. Derived `firstFrame`/`lastFrame` on video artifacts, extracted locally and cached.
11. No engine-side cap on concurrent runs against a provider — whether to run blueprints in parallel is the operator's decision, enforced at their provider account rather than by the engine (§13.4).
12. Builtin and user templates share one table with a `source` discriminator.
13. A blueprint declares at most one role, enforced by the validator rather than the schema, so the constraint lifts without a migration (§18.5).
14. Handles are rewritten to canonical form after fetch and before checks, so a stored artifact means the same thing in every later stage (§6.6).
15. Rejections route to a named earlier stage via `approval.onReject`, the only backward reference in the design and one that carries no data (§10.5).
16. Memory writes are applied by the engine at attempt finalization, never by capabilities mid-attempt (§6.3).
17. Two reservation expiries with a `phase` column, so no reservation is ever unswept and no billed job is ever released (§11.4).
18. Skipped stages are opaque to `prev`, preserving save-time type checking (§16.6).

### 26.3 Open

- **Multi-character support** is deliberately out of scope for v1 (§18.5) and the design questions it raises are parked in §18.6 rather than open here.
- **Blob retention default.** Not derivable from requirements; depends on disk budget.
- **Approval timeouts.** Whether stage approval and `human.input` should expire at all, or park indefinitely.
- **Style registry scope.** Whether timeline styles are engine-only or user-extensible, which would make them a fourth template kind.

---

## 27. Requirements Document Amendments

| Requirement | Amendment |
|---|---|
| REQ-2.4.2 (no fixed stage taxonomy) | Reaffirmed and strengthened: stages are user-defined, capabilities are fixed |
| REQ-2.5.x (executors) | Rename to capabilities; slots and outputs become functions of config |
| REQ-2.6.3 (checks pure and sync) | Keep; extend to script checks with resolved `refs` |
| REQ-2.8.3 (sequential stages) | Keep, and extend: items within a stage are also sequential |
| REQ-2.7.x (QC) | Add: QC is prohibited on video output; human approval with routed rejection notes replaces it |
| REQ-10.3 (approval) | Approval is a stage property, not a stage; add item-mode approval and reject routing |
| REQ-4.1 (dependency-based invalidation) | Dependents are computed from recorded reads rather than a declared graph; memory reads are dependencies |
| REQ-5.x (fan-out) | Rename to iteration; remove parallelism and continue-and-isolate; add the `prevItem` carry |
| REQ-9.1 (run states) | Add `CREATED`, `PAUSED_INPUT`, and stage-level `skipped` |
| REQ-12.x (timestamps) | Remove WPM estimation as an engine concern; alignment is a `media.analyze` operation |
| REQ-11.4 (faceless) | Generalize: a run may bind zero roles and generate zero media |
| REQ-2.2.4 (roles) | Constrain for v1: a blueprint declares zero or one role |
| New | Run inputs and channel assets |
| New | Run Memory, tracked as a dependency and tombstoned on invalidation |
| New | User-defined output schemas on a restricted JSON Schema dialect |
| New | Format configuration with inheritance |
| New | Assembly capabilities and the timeline artifact |
| New | Template library |

---

## 28. Revision History

**v5.1** — v5 review corrections.

- Run Memory reframed: readers are tracked dependencies, not exemptions (§6.3, §15.2, §26.1). v5 contradicted itself inside §15.2, and the "sharpest trade" it described was unreachable.
- Memory writes applied by the engine at finalization rather than by capabilities mid-attempt; memory references artifacts rather than blobs; invalidation tombstones keys so a shorter re-run leaves no orphaned indexed entries (§6.3, §15.5).
- Invalidation computed from recorded reads instead of array position, at both stage and item level (§15.2) — v5 discarded a music stage for following a video stage it never read, and discarded four clips to fix one.
- Approval became a stage property with reject routing and item mode (§10.5); `human.approve` removed. §25.1 could not execute as written.
- Handles rewritten to canonical form after fetch (§6.6) — `prev#0` meant different things in the writing and consuming stages.
- Two reservation expiries and a `phase` column (§11.4): v5 set `expires_at` only at submit, so a pre-submit crash left it NULL and the sweep never selected it — the same NULL-comparison trap as `gc_eligible_at`.
- Cross-run provider cap removed (§13.4): Inngest concurrency counts executing steps, so it would have limited API calls while renders ran unbounded. Concurrency across runs is the operator's decision.
- Row-lock rationale corrected and an action matrix added (§11.1, §12.4).
- Skipped stages made opaque to `prev` (§16.6), preserving save-time typing.
- Minor: `infra_error` outcome, dead QC media fields removed, `alignWith` canonicalization by producer tuple, runtime duration legality, redundant timeline validator rule.

**v5** — Generalization from reel generator to video engine, plus the v4 review fixes.

- Capability/Stage split; no stage is built into the engine (§2.1).
- User-defined output schemas on a restricted JSON Schema dialect replace the closed artifact type registry (§4.2).
- Run inputs, channel assets, and Run Memory as bindable sources (§3.3, §3.11, §6).
- Execution simplified: no parallelism anywhere; a stage binds only the previous stage; iteration is a sequential loop with a `prevItem` carry and derived frames (§14).
- Invalidation reduced to array-order chaining, with Run Memory claimed to be non-invalidating — both corrected in v5.1.
- QC prohibited on video output; human rejection notes feed the retry prompt (§10.1, §10.5).
- Timeline artifact, `timeline.render`, and `video.concat` (§17).
- Script checks in a QuickJS sandbox (§9.2); media manifests and handles (§6.6); format config and duration reconciliation (§17.5); template library (§20).
- Single-character constraint for v1, enforced in the validator so the schema already supports the multi-character case (§18.5, §18.6).
- v4 fixes carried in: provider timeout settles as a provisional actual; TTL anchored at submit; templating allows validated field paths; `max_tokens` cross-reference corrected.

**v4** — Review corrections: cancellation settlement, `gc_eligible_at`, validator additions.
**v3** — Born-stale artifacts, per-modality concurrency, durable compute jobs, provisional actuals, declared cardinality groups.
**v2** — Config resolution, budget row lock, lifecycle split, `stage_item`, correlated bindings, slots vs context, cancellation wiring, testing strategy.
**v1** — Initial design specification.

---

## Appendix A: Core Type Reference

Every type used across this document but not fully defined at its point of use. This is what `packages/shared` should encode first — before any capability, before any controller — since almost everything else imports from it.

```ts
// ---- Identity & primitives -------------------------------------------------

type ULID = string;

type Modality = 'text' | 'image' | 'video' | 'audio' | 'compute' | 'human' | 'publish';

type ArtifactKind =
  | 'data' | 'text' | 'media.image' | 'media.video' | 'media.audio'
  | 'file.subtitles' | 'timeline';

type OutputKind = ArtifactKind;   // OutputDef.kind draws from the same set (§4.2)

// JsonSchema is the restricted dialect from §4.2 — a subset of the JSON Schema
// spec, not the full spec. Validate blueprint-authored schemas against this
// subset at save time, independent of what Ajv itself would accept.
type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  enum?: (string | number)[];
  description?: string;
  properties?: Record<string, JsonSchema>;      // type: 'object'
  required?: string[];                          // type: 'object'
  items?: JsonSchema;                            // type: 'array'
  minItems?: number; maxItems?: number;          // type: 'array'
  minimum?: number; maximum?: number;            // type: 'number' | 'integer'
  minLength?: number; maxLength?: number;        // type: 'string'
};
// Deliberately absent: $ref, oneOf/anyOf/allOf, patternProperties, if/then/else (§4.2).

// ---- Storage (§4.3) ---------------------------------------------------------

type PutResult = { key: string; etag: string; bytes: number };
type ByteRange = { start: number; end?: number };   // HTTP Range semantics, end inclusive

// ---- Provider & capability job lifecycle (§7.2, §8) -------------------------

type JobStatus =
  | { done: false; phase: 'queued' | 'running'; progress?: number }
  | { done: true; outcome: 'succeeded' }
  | { done: true; outcome: 'failed'; reason: string; retryable: boolean };

// Opaque to engine core; each provider adapter defines its own payload shape
// and treats it as a black box on the other side of (de)serialization.
type JobHandle = { providerId: string; externalId: string; payload?: unknown };

type ExecResult<Out = unknown> = {
  output: Out;
  probe?: Probe;              // populated for media outputs (§9.3)
  costUsd: number;
  repro: { level: 'exact' | 'approximate' | 'none'; seed?: string; providerVersion?: string };
  rawResponseRef?: string;    // blob id of the full provider payload, for audit
};

type ExecCtx<Cfg> = {
  runId: ULID; stageKey: string; attemptNo: number; itemIndex?: number;
  config: Cfg;
  slots: Record<string, unknown>;      // resolved per SlotDef (§6.4)
  context: Record<string, unknown>;    // resolved per StageDef.context (§6.4)
  renderedPrompt?: string;             // for text.generate and any templated capability
  provider: ProviderClient;            // scoped to the effective ModelPin
  blobs: Pick<StorageAdapter, 'put' | 'presignPut'>;   // BlobWriter — write-only, no reads
  idempotencyKey: string;
  logger: Logger;
};
// Deliberately absent from ExecCtx: database access, the run object, other
// stages, and any memory-write capability (§6.3, §7.2) — enforced by this
// type, not by convention.

type ValidationIssue = { path: string; message: string; severity: 'error' | 'warning' };

// Declared per pinned model (§8), not per adapter — capability .validate()
// receives this to reject impossible stage configs at save time (§16.2).
type ModelCapabilities = {
  maxRefs?: number;
  supportsSeed: boolean;
  supportsIdempotency: boolean;
  supportsStructuredOutput?: boolean;
  supportsVision?: boolean;
  video?: {
    durationsSec: number[] | { min: number; max: number };
    aspectRatios: string[];
    maxResolution: string;
    inputs: Array<'text' | 'startFrame' | 'endFrame' | 'references'>;
  };
};
// ProviderCapabilities, as referenced by CapabilityImpl.validate() (§7.1), is
// this same type — one name throughout; use ModelCapabilities everywhere.

// ---- Compute jobs (§4.4) -----------------------------------------------------

type ComputeSpec = {
  command: string;
  args: string[];
  inputs: Array<{ sourceKey: string; asFilename: string }>;  // pulled into the job dir before spawn
  outputFilename: string;
  maxWaitSec: number;
};

// Behind ComputeJobService (§4.4). Remotion is the default for timeline.render;
// an ffmpeg-only Renderer covers video.concat and simple cut-and-mux timelines.
interface Renderer {
  render(timeline: Timeline, ctx: { jobDir: string; quality: 'draft' | 'final' }): Promise<ComputeSpec>;
}

// ---- Config & bindings (§3.4, §3.5, §5, §6) ----------------------------------

type ModelPin = { provider: string; modelId: string; version?: string; params: Record<string, unknown> };

type Ref =
  | { from: 'prev';     path?: string; alignWith?: 'item' }
  | { from: 'memory';   key: string; path?: string }
  | { from: 'input';    inputKey: string; index?: number; path?: string }
  | { from: 'asset';    assetId: string }
  | { from: 'role';     roleKey: string }
  | { from: 'item';     path?: string }
  | { from: 'prevItem'; path?: string }
  | { from: 'const';    value: unknown };

type SlotDef = {
  name: string;
  accepts: Array<ArtifactKind | JsonSchema>;
  required: boolean;
  cardinality: 'one' | 'many';
};

type InputDef = {
  key: string; label: string; required: boolean;
  accepts:
    | { kind: 'text' }
    | { kind: 'data'; schema: JsonSchema }
    | { kind: 'media.image' | 'media.video' | 'media.audio'; cardinality: 'one' | 'many' };
};

type OutputDef =
  | { kind: 'data'; schema: JsonSchema; schemaName?: string }
  | { kind: 'text' }
  | { kind: 'media.image' | 'media.video' | 'media.audio'; constraints?: MediaConstraints }
  | { kind: 'file.subtitles' }
  | { kind: 'timeline' };

type MediaConstraints = {
  durationSec?: { min?: number; max?: number };
  aspectRatio?: string;
  minWidth?: number;
};

type CheckDef =
  | { type: 'builtin'; key: string; params: unknown }
  | { type: 'script';  name: string; code: string; refs?: Record<string, Ref> };

type QcDef = {
  criteria: string;
  threshold: number;
  model: ModelPin;
  includeInputs: boolean;
  media?: { includeTranscript?: boolean };   // audio only — video QC is prohibited (§10.1)
  dimensions?: Array<{ key: string; description: string; weight: number }>;
};

type EnabledWhen = { input: string; equals: string | number | boolean };

type StageDef = {
  key: string; label: string; capability: string;
  instructions?: { system?: string; template: string };
  config: Record<string, unknown>;
  slots: Record<string, Ref>;
  context: Record<string, Ref>;
  writes?: Record<string, string>;
  output: OutputDef;
  iterate?: { over: Ref; groupKey?: string; itemAlias: string; alignWith?: 'item'; itemRetryLimit: number };
  checks: CheckDef[];
  qc?: QcDef;
  retryLimit: number;
  approval?: { mode: 'stage' | 'item'; onReject?: { retryStageKey: string } };
  budget?: { stageCapUsd?: number; qcCapUsd?: number };
  model?: Partial<ModelPin>;
  enabledWhen?: EnabledWhen;
};

type ConfigLayer = {
  model?: Partial<ModelPin>;
  qc?: { threshold?: number; model?: Partial<ModelPin>; capUsd?: number };
  budget?: { runCapUsd?: number; stageCapUsd?: number };
  retryLimit?: number;
  iterate?: { itemRetryLimit?: number; maxItems?: number };
  format?: { aspectRatio?: string; resolution?: string; fps?: number;
             targetDurationSec?: { min?: number; max?: number } };
  provider?: { preferred?: Record<Modality, string> };
  polling?: { intervalSec?: number; maxWaitSec?: number };
};
// Every field .nullish() in the Zod encoding, not .optional() — §5.1 explains why.

// ---- Media probe (§9.3) ------------------------------------------------------

type Probe = {
  container: string;
  durationSec: number;
  streams: Array<{ type: 'video' | 'audio'; codec: string;
                    width?: number; height?: number; fps?: number; sampleRate?: number }>;
};

// ---- Reference images (§3.2) -------------------------------------------------

type ReferenceImage = {
  blobId: string;
  view: 'front' | 'three_quarter' | 'profile' | 'full_body' | 'expression' | 'detail';
  caption?: string;
  origin: 'uploaded' | 'generated';
  sourceArtifactId?: string;
  order: number;
};

type ReferencePolicy = { maxRefs: number; prefer: ReferenceImage['view'][]; alwaysIncludePrimary: boolean };

// ---- Cost & estimation (§7.2, §8) --------------------------------------------

type CostEstimate = {
  expectedUsd: number;
  ceilingUsd: number;
  basis: 'provider_quote' | 'token_estimate' | 'configured_ceiling';
};

// ---- Timeline (§17.1) ---------------------------------------------------------

type Timeline = { version: 1; canvas: { width: number; height: number; fps: number; background?: string }; tracks: Track[] };
type Track = { id: string; type: 'video' | 'audio' | 'overlay' | 'captions'; duckUnder?: string; items: TimelineItem[] };
type TimelineItem =
  | { type: 'media'; handle: string; startSec: number; durationSec?: number; trimInSec?: number;
      fit?: 'cover' | 'contain' | 'fill'; overflow?: 'trim' | 'loop' | 'freeze' | 'speed';
      volume?: number; fadeInSec?: number; fadeOutSec?: number;
      motion?: { type: 'ken_burns' | 'zoom_in' | 'pan'; intensity?: number };
      transitionIn?: { type: 'cut' | 'crossfade' | 'slide' | 'wipe'; durationSec: number } }
  | { type: 'text'; text: string; startSec: number; durationSec: number; styleId: string;
      position: 'top' | 'center' | 'bottom' | { x: number; y: number } }
  | { type: 'captions'; timingHandle: string; styleId: string; startSec?: number };
```

### A.1 Naming note

`ProviderCapabilities` (§7.1's `CapabilityImpl.validate()` signature) and `ModelCapabilities` (§8) are the same type under two names introduced in different sections. Use **`ModelCapabilities`** throughout the implementation; treat any other spelling in this document as referring to it.

### A.2 What is intentionally not here

`ProviderAdapter`, `CapabilityImpl`, `StorageAdapter`, `ComputeJobService`, and `WorkspaceService` are interfaces with real behavior, not data shapes — they stay defined at their point of use (§8, §7.1, §4.3, §4.4) rather than duplicated here. This appendix covers the nouns that pass *between* those interfaces.
