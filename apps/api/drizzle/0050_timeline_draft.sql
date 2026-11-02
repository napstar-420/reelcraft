CREATE TABLE "timeline_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage_key" text NOT NULL,
	"base_artifact_id" text NOT NULL,
	"draft" jsonb NOT NULL,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "timeline_draft" ADD CONSTRAINT "timeline_draft_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_draft_run_stage_uq" ON "timeline_draft" USING btree ("run_id","stage_key");