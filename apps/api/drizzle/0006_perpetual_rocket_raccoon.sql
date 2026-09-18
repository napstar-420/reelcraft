CREATE TABLE "human_wait" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage_execution_id" text NOT NULL,
	"stage_item_id" text,
	"kind" text NOT NULL,
	"waiting_since" timestamp with time zone DEFAULT now() NOT NULL,
	"reminded_24h_at" timestamp with time zone,
	"reminded_48h_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "stage_attempt" ADD COLUMN "critique_target_stage_key" text;--> statement-breakpoint
ALTER TABLE "human_wait" ADD CONSTRAINT "human_wait_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_wait" ADD CONSTRAINT "human_wait_stage_execution_id_stage_execution_id_fk" FOREIGN KEY ("stage_execution_id") REFERENCES "public"."stage_execution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_wait" ADD CONSTRAINT "human_wait_stage_item_id_stage_item_id_fk" FOREIGN KEY ("stage_item_id") REFERENCES "public"."stage_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "human_wait_open_execution_item_uq" ON "human_wait" USING btree ("stage_execution_id",coalesce("stage_item_id", '')) WHERE "human_wait"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "human_wait_reminder_idx" ON "human_wait" USING btree ("resolved_at","waiting_since");--> statement-breakpoint
CREATE INDEX "stage_attempt_critique_target_outcome_idx" ON "stage_attempt" USING btree ("critique_target_stage_key","outcome");