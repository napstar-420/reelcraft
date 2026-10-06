DROP TABLE "template" CASCADE;--> statement-breakpoint
DROP TABLE "template_version" CASCADE;--> statement-breakpoint
ALTER TABLE "blueprint_version" DROP COLUMN "source_template_id";--> statement-breakpoint
DROP TYPE "public"."template_kind";--> statement-breakpoint
DROP TYPE "public"."template_source";