DROP INDEX "blueprint_version_blueprint_id_version_uq";--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD COLUMN "major" integer;--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD COLUMN "minor" integer;--> statement-breakpoint
-- Existing vN becomes v1.(N-1); drafts made before any save (version 0) become 0.0.
UPDATE "blueprint_version" SET "major" = CASE WHEN "version" = 0 THEN 0 ELSE 1 END, "minor" = GREATEST("version" - 1, 0);--> statement-breakpoint
ALTER TABLE "blueprint_version" ALTER COLUMN "major" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "blueprint_version" ALTER COLUMN "minor" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_version_blueprint_id_major_minor_uq" ON "blueprint_version" USING btree ("blueprint_id","major","minor") WHERE draft = false;--> statement-breakpoint
ALTER TABLE "blueprint_version" DROP COLUMN "version";
