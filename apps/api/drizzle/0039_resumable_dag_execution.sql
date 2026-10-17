ALTER TYPE "public"."run_state" ADD VALUE 'IDLE' BEFORE 'PAUSED_BUDGET';--> statement-breakpoint
ALTER TYPE "public"."run_state" ADD VALUE 'PAUSING' BEFORE 'PAUSED_BUDGET';--> statement-breakpoint
ALTER TYPE "public"."run_state" ADD VALUE 'CANCELLING' BEFORE 'PAUSED_BUDGET';--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD COLUMN "execution" jsonb DEFAULT '{"concurrentBranches":2}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "execution_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "execution_scope" jsonb;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "concurrent_branches" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_wakeup" ADD COLUMN "execution_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_attempt" ADD COLUMN "invocation_key" text;--> statement-breakpoint
ALTER TABLE "stage_attempt" ADD COLUMN "execution_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_attempt" ADD COLUMN "cancellation_confirmed" boolean;--> statement-breakpoint
ALTER TABLE "stage_execution" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "stage_item" ADD COLUMN "input_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "stage_attempt_invocation_uq" ON "stage_attempt" USING btree ("stage_execution_id","invocation_key");