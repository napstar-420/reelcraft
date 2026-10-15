ALTER TYPE "public"."asset_kind" ADD VALUE 'vector';--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "meta" jsonb;