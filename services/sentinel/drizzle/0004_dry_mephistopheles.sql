ALTER TYPE "public"."sentinel_notification_event" ADD VALUE 'invalidated' BEFORE 'reminder';--> statement-breakpoint
ALTER TYPE "public"."sentinel_queued_action_status" ADD VALUE 'invalidated';--> statement-breakpoint
ALTER TABLE "queued_actions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "queued_actions" ADD COLUMN "epoch" bigint;--> statement-breakpoint
ALTER TABLE "queued_actions" ADD COLUMN "invalidated_by_epoch" bigint;