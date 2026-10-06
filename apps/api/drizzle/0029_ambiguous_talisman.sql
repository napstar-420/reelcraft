CREATE TABLE "assistant_item" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"state" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_session" (
	"id" text PRIMARY KEY NOT NULL,
	"blueprint_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"external_session_id" text NOT NULL,
	"app_version" text NOT NULL,
	"tools_hash" text NOT NULL,
	"title" text,
	"apply_mode" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"model" text,
	"effort" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_item" ADD CONSTRAINT "assistant_item_session_id_assistant_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_session" ADD CONSTRAINT "assistant_session_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_item_session_id_seq_uq" ON "assistant_item" USING btree ("session_id","seq");