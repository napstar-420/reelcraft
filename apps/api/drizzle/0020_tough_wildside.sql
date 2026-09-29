DROP INDEX "blueprint_version_blueprint_id_version_uq";--> statement-breakpoint
ALTER TABLE "blueprint" ADD COLUMN "working_draft" jsonb;--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_version_blueprint_id_version_uq" ON "blueprint_version" USING btree ("blueprint_id","version") WHERE draft = false;