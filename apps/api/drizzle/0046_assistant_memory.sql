CREATE TABLE "assistant_memory_doc" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT 'local' NOT NULL,
	"kind" text NOT NULL,
	"session_id" text,
	"channel_id" text,
	"blueprint_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_note" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT 'local' NOT NULL,
	"scope" text NOT NULL,
	"channel_id" text,
	"text" text NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_memory_doc" ADD CONSTRAINT "assistant_memory_doc_session_id_assistant_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memory_doc" ADD CONSTRAINT "assistant_memory_doc_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memory_doc" ADD CONSTRAINT "assistant_memory_doc_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_note" ADD CONSTRAINT "assistant_note_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_memory_doc_tsv_idx" ON "assistant_memory_doc" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "assistant_memory_doc_session_idx" ON "assistant_memory_doc" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "assistant_memory_doc_channel_idx" ON "assistant_memory_doc" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "assistant_memory_doc_blueprint_idx" ON "assistant_memory_doc" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX "assistant_note_channel_idx" ON "assistant_note" USING btree ("channel_id");