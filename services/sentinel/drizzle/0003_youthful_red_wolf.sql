ALTER TYPE "public"."sentinel_notification_event" ADD VALUE 'reminder' BEFORE 'policy-admin';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "harness_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" uuid NOT NULL,
	"harness" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "harness_runs_action_id_unique" UNIQUE("action_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_action_id_queued_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."queued_actions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "harness_runs_started_at_idx" ON "harness_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "queued_actions_public_feed_idx" ON "queued_actions" USING btree ("queue_block","id");