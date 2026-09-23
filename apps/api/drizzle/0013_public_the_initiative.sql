CREATE TYPE "public"."character_readiness" AS ENUM('draft', 'ready');--> statement-breakpoint
CREATE TYPE "public"."character_scope" AS ENUM('channel', 'blueprint');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('media.image', 'media.video', 'media.audio', 'font', 'lut');--> statement-breakpoint
CREATE TYPE "public"."run_state" AS ENUM('CREATED', 'RUNNING', 'PAUSED_BUDGET', 'PAUSED_APPROVAL', 'PAUSED_INPUT', 'FAILED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."human_wait_kind" AS ENUM('approval', 'input', 'timeline_edit');--> statement-breakpoint
CREATE TYPE "public"."attempt_outcome" AS ENUM('success', 'check_failed', 'qc_failed', 'qc_error', 'qc_budget_exhausted', 'provider_error', 'provider_timeout', 'infra_error', 'budget_blocked', 'rejected', 'cancelled', 'user_edit', 'awaiting_approval');--> statement-breakpoint
CREATE TYPE "public"."stage_attempt_actor" AS ENUM('engine', 'user');--> statement-breakpoint
CREATE TYPE "public"."stage_attempt_phase" AS ENUM('created', 'reserved', 'submitting', 'submitted', 'settled', 'awaiting_approval');--> statement-breakpoint
CREATE TYPE "public"."stage_execution_state" AS ENUM('pending', 'running', 'awaiting_approval', 'awaiting_input', 'passed', 'failed', 'stale', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."stage_item_state" AS ENUM('pending', 'running', 'awaiting_approval', 'passed', 'failed', 'stale');--> statement-breakpoint
CREATE TYPE "public"."artifact_kind" AS ENUM('data', 'text', 'media.image', 'media.video', 'media.audio', 'file.subtitles', 'timeline');--> statement-breakpoint
CREATE TYPE "public"."repro_level" AS ENUM('exact', 'approximate', 'none');--> statement-breakpoint
CREATE TYPE "public"."blob_scope" AS ENUM('run', 'input', 'character', 'asset');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_category" AS ENUM('stage_output', 'qc', 'check');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_kind" AS ENUM('reservation', 'actual', 'release');--> statement-breakpoint
CREATE TYPE "public"."template_kind" AS ENUM('blueprint', 'schema', 'check', 'stage');--> statement-breakpoint
CREATE TYPE "public"."template_source" AS ENUM('builtin', 'user');--> statement-breakpoint
CREATE TYPE "public"."provider_job_state" AS ENUM('submitting', 'submitted', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "character" ALTER COLUMN "scope" SET DATA TYPE character_scope USING "scope"::character_scope;--> statement-breakpoint
ALTER TABLE "character" ALTER COLUMN "readiness" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "character" ALTER COLUMN "readiness" SET DATA TYPE character_readiness USING "readiness"::character_readiness;--> statement-breakpoint
ALTER TABLE "character" ALTER COLUMN "readiness" SET DEFAULT 'draft'::character_readiness;--> statement-breakpoint
ALTER TABLE "asset" ALTER COLUMN "kind" SET DATA TYPE asset_kind USING "kind"::asset_kind;--> statement-breakpoint
ALTER TABLE "run" ALTER COLUMN "state" SET DATA TYPE run_state USING "state"::run_state;--> statement-breakpoint
ALTER TABLE "run_wakeup" ALTER COLUMN "source_state" SET DATA TYPE run_state USING "source_state"::run_state;--> statement-breakpoint
ALTER TABLE "human_wait" ALTER COLUMN "kind" SET DATA TYPE human_wait_kind USING "kind"::human_wait_kind;--> statement-breakpoint
ALTER TABLE "stage_attempt" ALTER COLUMN "outcome" SET DATA TYPE attempt_outcome USING "outcome"::attempt_outcome;--> statement-breakpoint
ALTER TABLE "stage_attempt" ALTER COLUMN "phase" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stage_attempt" ALTER COLUMN "phase" SET DATA TYPE stage_attempt_phase USING "phase"::stage_attempt_phase;--> statement-breakpoint
ALTER TABLE "stage_attempt" ALTER COLUMN "phase" SET DEFAULT 'created'::stage_attempt_phase;--> statement-breakpoint
ALTER TABLE "stage_attempt" ALTER COLUMN "actor" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stage_attempt" ALTER COLUMN "actor" SET DATA TYPE stage_attempt_actor USING "actor"::stage_attempt_actor;--> statement-breakpoint
ALTER TABLE "stage_attempt" ALTER COLUMN "actor" SET DEFAULT 'engine'::stage_attempt_actor;--> statement-breakpoint
ALTER TABLE "stage_execution" ALTER COLUMN "state" SET DATA TYPE stage_execution_state USING "state"::stage_execution_state;--> statement-breakpoint
ALTER TABLE "stage_item" ALTER COLUMN "state" SET DATA TYPE stage_item_state USING "state"::stage_item_state;--> statement-breakpoint
ALTER TABLE "artifact" ALTER COLUMN "kind" SET DATA TYPE artifact_kind USING "kind"::artifact_kind;--> statement-breakpoint
ALTER TABLE "artifact" ALTER COLUMN "repro_level" SET DATA TYPE repro_level USING "repro_level"::repro_level;--> statement-breakpoint
ALTER TABLE "blob" DROP CONSTRAINT "blob_scope_reference_ck";--> statement-breakpoint
ALTER TABLE "blob" ALTER COLUMN "scope" SET DATA TYPE blob_scope USING "scope"::blob_scope;--> statement-breakpoint
ALTER TABLE "blob" ADD CONSTRAINT "blob_scope_reference_ck" CHECK (("blob"."scope" IN ('run','input') AND "blob"."run_id" IS NOT NULL)
          OR ("blob"."scope" = 'character' AND "blob"."character_id" IS NOT NULL)
          OR ("blob"."scope" = 'asset'));--> statement-breakpoint
ALTER TABLE "run_memory" ALTER COLUMN "kind" SET DATA TYPE artifact_kind USING "kind"::artifact_kind;--> statement-breakpoint
DROP INDEX "ledger_open_idx";--> statement-breakpoint
DROP INDEX "ledger_one_reservation_per_attempt";--> statement-breakpoint
ALTER TABLE "ledger_entry" ALTER COLUMN "kind" SET DATA TYPE ledger_entry_kind USING "kind"::ledger_entry_kind;--> statement-breakpoint
ALTER TABLE "ledger_entry" ALTER COLUMN "category" SET DATA TYPE ledger_entry_category USING "category"::ledger_entry_category;--> statement-breakpoint
CREATE INDEX "ledger_open_idx" ON "ledger_entry" USING btree ("run_id","stage_key") WHERE "ledger_entry"."kind" = 'reservation';--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_one_reservation_per_attempt" ON "ledger_entry" USING btree ("stage_attempt_id") WHERE "ledger_entry"."kind" = 'reservation';--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "source" SET DATA TYPE template_source USING "source"::template_source;--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "kind" SET DATA TYPE template_kind USING "kind"::template_kind;--> statement-breakpoint
ALTER TABLE "provider_job" ALTER COLUMN "state" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "provider_job" ALTER COLUMN "state" SET DATA TYPE provider_job_state USING "state"::provider_job_state;--> statement-breakpoint
ALTER TABLE "provider_job" ALTER COLUMN "state" SET DEFAULT 'submitted'::provider_job_state;
