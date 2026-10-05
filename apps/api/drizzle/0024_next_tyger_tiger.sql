ALTER TYPE "public"."run_state" ADD VALUE 'PAUSED_QUOTA' BEFORE 'FAILED';--> statement-breakpoint
ALTER TYPE "public"."attempt_outcome" ADD VALUE 'deferred';--> statement-breakpoint
ALTER TYPE "public"."artifact_kind" ADD VALUE 'media.video_list' BEFORE 'file.subtitles';--> statement-breakpoint
ALTER TABLE "run_wakeup" ADD COLUMN "not_before" timestamp with time zone;