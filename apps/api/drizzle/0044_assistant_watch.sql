CREATE TABLE "assistant_watch" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text NOT NULL,
	"wake_count" integer DEFAULT 0 NOT NULL,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text
);
--> statement-breakpoint
ALTER TABLE "assistant_watch" ADD CONSTRAINT "assistant_watch_session_id_assistant_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_watch" ADD CONSTRAINT "assistant_watch_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_watch_run_idx" ON "assistant_watch" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "assistant_watch_session_idx" ON "assistant_watch" USING btree ("session_id");