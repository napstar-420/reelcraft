CREATE TABLE "run_wakeup" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"action" text NOT NULL,
	"source_state" text NOT NULL,
	"expected_revision" bigint NOT NULL,
	"event_name" text NOT NULL,
	"dispatch_attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_wakeup" ADD CONSTRAINT "run_wakeup_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_wakeup_undispatched_idx" ON "run_wakeup" USING btree ("created_at") WHERE "run_wakeup"."dispatched_at" is null;