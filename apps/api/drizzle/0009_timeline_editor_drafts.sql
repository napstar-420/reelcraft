ALTER TABLE "human_wait" ADD COLUMN "draft" jsonb;
--> statement-breakpoint
ALTER TABLE "human_wait" ADD COLUMN "draft_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "human_wait" ADD COLUMN "draft_updated_at" timestamp with time zone;
