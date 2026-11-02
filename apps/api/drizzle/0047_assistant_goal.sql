CREATE TABLE "assistant_goal" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"blueprint_id" text NOT NULL,
	"goal" text NOT NULL,
	"max_runs" integer NOT NULL,
	"max_spend_usd" numeric(12, 4) NOT NULL,
	"run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assistant_goal" ADD CONSTRAINT "assistant_goal_session_id_assistant_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_goal" ADD CONSTRAINT "assistant_goal_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_goal_session_idx" ON "assistant_goal" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "assistant_goal_blueprint_idx" ON "assistant_goal" USING btree ("blueprint_id");