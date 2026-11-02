ALTER TYPE "public"."blob_scope" ADD VALUE 'assistant';--> statement-breakpoint
CREATE TABLE "assistant_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text DEFAULT 'local' NOT NULL,
	"session_id" text,
	"blob_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blob" DROP CONSTRAINT "blob_scope_reference_ck";--> statement-breakpoint
ALTER TABLE "assistant_attachment" ADD CONSTRAINT "assistant_attachment_session_id_assistant_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_attachment" ADD CONSTRAINT "assistant_attachment_blob_id_blob_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_attachment_session_idx" ON "assistant_attachment" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "blob" ADD CONSTRAINT "blob_scope_reference_ck" CHECK (("blob"."scope" IN ('run','input') AND "blob"."run_id" IS NOT NULL)
          OR ("blob"."scope" = 'character' AND "blob"."character_id" IS NOT NULL)
          OR ("blob"."scope"::text IN ('asset','assistant')));