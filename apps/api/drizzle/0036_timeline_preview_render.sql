CREATE TABLE "timeline_preview_render" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage_key" text NOT NULL,
	"draft_revision" integer NOT NULL,
	"state" text NOT NULL,
	"job_handle" jsonb,
	"blob_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "timeline_preview_render" ADD CONSTRAINT "timeline_preview_render_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_preview_render" ADD CONSTRAINT "timeline_preview_render_blob_id_blob_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timeline_preview_render_stage_idx" ON "timeline_preview_render" USING btree ("run_id","stage_key","created_at");