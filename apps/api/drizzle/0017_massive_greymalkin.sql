CREATE TYPE "public"."stage_event_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TABLE "stage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage_execution_id" text NOT NULL,
	"stage_attempt_id" text,
	"item_index" integer,
	"level" "stage_event_level" NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stage_event" ADD CONSTRAINT "stage_event_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_event" ADD CONSTRAINT "stage_event_stage_execution_id_stage_execution_id_fk" FOREIGN KEY ("stage_execution_id") REFERENCES "public"."stage_execution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_event" ADD CONSTRAINT "stage_event_stage_attempt_id_stage_attempt_id_fk" FOREIGN KEY ("stage_attempt_id") REFERENCES "public"."stage_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_event_execution_idx" ON "stage_event" USING btree ("stage_execution_id","id");--> statement-breakpoint
CREATE INDEX "stage_event_attempt_idx" ON "stage_event" USING btree ("stage_attempt_id","id");--> statement-breakpoint
CREATE INDEX "stage_event_run_idx" ON "stage_event" USING btree ("run_id");