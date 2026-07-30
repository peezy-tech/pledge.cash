CREATE TABLE "identity_quota_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "identity_quota_events_scope_consumed_at_idx" ON "identity_quota_events" USING btree ("scope","consumed_at");