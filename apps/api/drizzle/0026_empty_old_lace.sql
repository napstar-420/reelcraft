CREATE TABLE "package_trusted_author" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"trusted_at" timestamp with time zone DEFAULT now() NOT NULL
);
