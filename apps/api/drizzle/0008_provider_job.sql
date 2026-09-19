CREATE TABLE "provider_job" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "external_id" text,
  "callback_token" text NOT NULL,
  "state" text DEFAULT 'submitted' NOT NULL,
  "payload" jsonb NOT NULL,
  "result" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_job_idempotency_uq" ON "provider_job" USING btree ("provider","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_job_callback_token_uq" ON "provider_job" USING btree ("callback_token");
--> statement-breakpoint
CREATE INDEX "provider_job_external_idx" ON "provider_job" USING btree ("provider","external_id");
