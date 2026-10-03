CREATE TABLE "storage_orphan" (
	"object_key" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "asset_channel_id_name_uq";--> statement-breakpoint
ALTER TABLE "character" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- Assets were soft-deleted through their blob; carry that onto the asset row so
-- the partial unique index below frees their names.
UPDATE "asset" SET "deleted_at" = "blob"."deleted_at" FROM "blob" WHERE "blob"."id" = "asset"."blob_id" AND "blob"."deleted_at" IS NOT NULL;--> statement-breakpoint
-- Files of assets and reference images deleted before this release were never
-- removed from storage: queue them for the blob.gc sweep.
INSERT INTO "storage_orphan" ("object_key", "reason", "queued_at") SELECT "object_key", CASE WHEN "scope" = 'asset' THEN 'asset_deleted' ELSE 'reference_deleted' END, "deleted_at" FROM "blob" WHERE "scope" IN ('asset', 'character') AND "deleted_at" IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE INDEX "storage_orphan_queued_at_idx" ON "storage_orphan" USING btree ("queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_channel_id_name_uq" ON "asset" USING btree ("channel_id","name") WHERE "asset"."deleted_at" IS NULL;