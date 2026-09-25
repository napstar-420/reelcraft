CREATE TABLE "artifact_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"blob_id" text NOT NULL,
	"role" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_attachment" ADD CONSTRAINT "artifact_attachment_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_attachment" ADD CONSTRAINT "artifact_attachment_blob_id_blob_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_attachment_blob_uq" ON "artifact_attachment" USING btree ("artifact_id","blob_id");