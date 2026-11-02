ALTER TABLE "notification" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_session_id_assistant_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_session"("id") ON DELETE no action ON UPDATE no action;