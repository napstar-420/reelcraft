CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text DEFAULT 'local' NOT NULL,
	"kind" text NOT NULL,
	"run_id" text NOT NULL,
	"stage_key" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_key_uq" ON "notification" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_recipient_created_idx" ON "notification" USING btree ("recipient_id","created_at");