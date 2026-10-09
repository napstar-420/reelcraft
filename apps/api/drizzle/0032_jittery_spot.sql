CREATE TABLE "push_subscription" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"recipient_id" text DEFAULT 'local' NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
