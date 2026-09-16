CREATE TABLE "channel" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT 'local' NOT NULL,
	"name" text NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT 'local' NOT NULL,
	"channel_id" text,
	"blueprint_id" text,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"reference_set" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primary_ref_id" text,
	"lora" jsonb,
	"readiness" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT 'local' NOT NULL,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"blob_id" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"name" text NOT NULL,
	"current_version_id" text,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint_version" (
	"id" text PRIMARY KEY NOT NULL,
	"blueprint_id" text NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"defaults" jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"runnable" boolean DEFAULT false NOT NULL,
	"source_template_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"blueprint_version_id" text NOT NULL,
	"state" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"role_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_config" jsonb NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor_stage_key" text,
	"inngest_run_id" text,
	"budget_cap_usd" numeric(12, 4) NOT NULL,
	"reserved_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"spent_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"failure" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stage_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_execution_id" text NOT NULL,
	"stage_item_id" text,
	"attempt_no" integer NOT NULL,
	"outcome" text NOT NULL,
	"resolved_inputs" jsonb NOT NULL,
	"rendered_prompt" text,
	"idempotency_key" text,
	"phase" text DEFAULT 'created' NOT NULL,
	"job_handle" jsonb,
	"provider_request_id" text,
	"raw_response_ref" text,
	"artifact_id" text,
	"check_results" jsonb,
	"qc_verdict" jsonb,
	"review_note" text,
	"cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"actor" text DEFAULT 'engine' NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage_key" text NOT NULL,
	"state" text NOT NULL,
	"is_iterating" boolean DEFAULT false NOT NULL,
	"item_count" integer,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"output_artifact_id" text,
	"cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"failure" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stage_item" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_execution_id" text NOT NULL,
	"item_index" integer NOT NULL,
	"state" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"output_artifact_id" text,
	"cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"producer_stage_key" text NOT NULL,
	"item_index" integer,
	"generation" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"schema_hash" text,
	"data" jsonb,
	"blob_id" text,
	"probe" jsonb,
	"derived" jsonb,
	"stale" boolean DEFAULT true NOT NULL,
	"user_authored" boolean DEFAULT false NOT NULL,
	"repro_level" text NOT NULL,
	"repro" jsonb,
	"cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT 'local' NOT NULL,
	"scope" text NOT NULL,
	"run_id" text,
	"character_id" text,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"etag" text,
	"gc_eligible" boolean DEFAULT false NOT NULL,
	"gc_eligible_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "blob_scope_reference_ck" CHECK (("blob"."scope" IN ('run','input') AND "blob"."run_id" IS NOT NULL)
          OR ("blob"."scope" = 'character' AND "blob"."character_id" IS NOT NULL)
          OR ("blob"."scope" = 'asset'))
);
--> statement-breakpoint
CREATE TABLE "run_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"mem_key" text NOT NULL,
	"version" integer NOT NULL,
	"written_by" text NOT NULL,
	"written_item" integer,
	"kind" text NOT NULL,
	"schema_hash" text,
	"data" jsonb,
	"artifact_id" text,
	"tombstone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage_key" text NOT NULL,
	"stage_item_id" text,
	"stage_attempt_id" text,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"amount_usd" numeric(12, 4) NOT NULL,
	"confirmed" boolean DEFAULT true NOT NULL,
	"reservation_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT 'local' NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_version" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"requires" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character" ADD CONSTRAINT "character_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character" ADD CONSTRAINT "character_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_blob_id_blob_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint" ADD CONSTRAINT "blueprint_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD CONSTRAINT "blueprint_version_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_blueprint_version_id_blueprint_version_id_fk" FOREIGN KEY ("blueprint_version_id") REFERENCES "public"."blueprint_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_attempt" ADD CONSTRAINT "stage_attempt_stage_execution_id_stage_execution_id_fk" FOREIGN KEY ("stage_execution_id") REFERENCES "public"."stage_execution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_attempt" ADD CONSTRAINT "stage_attempt_stage_item_id_stage_item_id_fk" FOREIGN KEY ("stage_item_id") REFERENCES "public"."stage_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_attempt" ADD CONSTRAINT "stage_attempt_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_execution" ADD CONSTRAINT "stage_execution_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_execution" ADD CONSTRAINT "stage_execution_output_artifact_id_artifact_id_fk" FOREIGN KEY ("output_artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_item" ADD CONSTRAINT "stage_item_stage_execution_id_stage_execution_id_fk" FOREIGN KEY ("stage_execution_id") REFERENCES "public"."stage_execution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_item" ADD CONSTRAINT "stage_item_output_artifact_id_artifact_id_fk" FOREIGN KEY ("output_artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_blob_id_blob_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob" ADD CONSTRAINT "blob_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob" ADD CONSTRAINT "blob_character_id_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_memory" ADD CONSTRAINT "run_memory_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_memory" ADD CONSTRAINT "run_memory_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_stage_item_id_stage_item_id_fk" FOREIGN KEY ("stage_item_id") REFERENCES "public"."stage_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_stage_attempt_id_stage_attempt_id_fk" FOREIGN KEY ("stage_attempt_id") REFERENCES "public"."stage_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_version" ADD CONSTRAINT "template_version_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_channel_id_name_uq" ON "asset" USING btree ("channel_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_version_blueprint_id_version_uq" ON "blueprint_version" USING btree ("blueprint_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_attempt_execution_item_attempt_uq" ON "stage_attempt" USING btree ("stage_execution_id","stage_item_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_execution_run_id_stage_key_uq" ON "stage_execution" USING btree ("run_id","stage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_item_stage_execution_id_item_index_uq" ON "stage_item" USING btree ("stage_execution_id","item_index");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_active_uq" ON "artifact" USING btree ("run_id","producer_stage_key",coalesce("item_index", -1)) WHERE "artifact"."stale" = false;--> statement-breakpoint
CREATE INDEX "blob_gc_idx" ON "blob" USING btree ("scope","gc_eligible_at") WHERE "blob"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "run_memory_run_id_mem_key_version_uq" ON "run_memory" USING btree ("run_id","mem_key","version");--> statement-breakpoint
CREATE INDEX "run_memory_current" ON "run_memory" USING btree ("run_id","mem_key","version" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_open_idx" ON "ledger_entry" USING btree ("run_id","stage_key") WHERE "ledger_entry"."kind" = 'reservation';--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_one_reservation_per_attempt" ON "ledger_entry" USING btree ("stage_attempt_id") WHERE "ledger_entry"."kind" = 'reservation';--> statement-breakpoint
CREATE UNIQUE INDEX "template_owner_id_kind_name_uq" ON "template" USING btree ("owner_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "template_version_template_id_version_uq" ON "template_version" USING btree ("template_id","version");