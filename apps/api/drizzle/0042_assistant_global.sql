ALTER TABLE "assistant_session" DROP CONSTRAINT "assistant_session_blueprint_id_blueprint_id_fk";
--> statement-breakpoint
ALTER TABLE "assistant_session" ALTER COLUMN "blueprint_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_session" ADD COLUMN "owner_id" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_session" ADD COLUMN "mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
UPDATE "assistant_session" SET "mode" = "apply_mode";--> statement-breakpoint
UPDATE "assistant_session" AS s SET "owner_id" = c."owner_id" FROM "blueprint" b JOIN "channel" c ON c."id" = b."channel_id" WHERE b."id" = s."blueprint_id";
