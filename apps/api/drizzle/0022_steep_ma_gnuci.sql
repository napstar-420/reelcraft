CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"secret" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
