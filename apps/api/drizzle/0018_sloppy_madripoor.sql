ALTER TABLE "blueprint" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "blueprint" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;