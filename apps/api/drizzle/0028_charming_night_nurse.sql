CREATE TABLE "package_import" (
	"id" text PRIMARY KEY NOT NULL,
	"blueprint_id" text NOT NULL,
	"blueprint_version_id" text NOT NULL,
	"package_id" text NOT NULL,
	"package_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"author_fingerprint" text,
	"based_on" jsonb,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "package_import" ADD CONSTRAINT "package_import_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_import" ADD CONSTRAINT "package_import_blueprint_version_id_blueprint_version_id_fk" FOREIGN KEY ("blueprint_version_id") REFERENCES "public"."blueprint_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_import_package_id_idx" ON "package_import" USING btree ("package_id");