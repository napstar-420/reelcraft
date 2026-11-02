ALTER TABLE "channel" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "blueprint" ADD COLUMN "deleted_at" timestamp with time zone;