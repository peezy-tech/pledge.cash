CREATE TYPE "public"."sentinel_governance_operation_kind" AS ENUM('boardroom', 'controller');--> statement-breakpoint
ALTER TYPE "public"."sentinel_boardroom_status" ADD VALUE 'snapshotting';--> statement-breakpoint
ALTER TYPE "public"."sentinel_boardroom_status" ADD VALUE 'redemptions-open';--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "event" SET DATA TYPE text;--> statement-breakpoint
UPDATE "notifications" SET "event" = 'scheduled' WHERE "event" = 'queued';--> statement-breakpoint
DROP TYPE "public"."sentinel_notification_event";--> statement-breakpoint
CREATE TYPE "public"."sentinel_notification_event" AS ENUM('scheduled', 'cancelled', 'executed', 'invalidated', 'reminder', 'policy-admin');--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "event" SET DATA TYPE "public"."sentinel_notification_event" USING "event"::"public"."sentinel_notification_event";--> statement-breakpoint
ALTER TABLE "queued_actions" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "queued_actions" ALTER COLUMN "status" SET DEFAULT 'scheduled'::text;--> statement-breakpoint
UPDATE "queued_actions" SET "status" = 'scheduled' WHERE "status" = 'queued';--> statement-breakpoint
DROP TYPE "public"."sentinel_queued_action_status";--> statement-breakpoint
CREATE TYPE "public"."sentinel_queued_action_status" AS ENUM('scheduled', 'cancelled', 'executed', 'invalidated');--> statement-breakpoint
ALTER TABLE "queued_actions" ALTER COLUMN "status" SET DEFAULT 'scheduled'::"public"."sentinel_queued_action_status";--> statement-breakpoint
ALTER TABLE "queued_actions" ALTER COLUMN "status" SET DATA TYPE "public"."sentinel_queued_action_status" USING "status"::"public"."sentinel_queued_action_status";--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "proposer" text DEFAULT '0x0000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "controller_generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "configuration_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "grace_period" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "wind_down_delay" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "queued_actions" ADD COLUMN "proposer" text DEFAULT '0x0000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "queued_actions" ADD COLUMN "operation_kind" "sentinel_governance_operation_kind" DEFAULT 'boardroom' NOT NULL;--> statement-breakpoint
ALTER TABLE "queued_actions" ADD COLUMN "controller_generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "queued_actions" ADD COLUMN "configuration_epoch" bigint DEFAULT 0 NOT NULL;
