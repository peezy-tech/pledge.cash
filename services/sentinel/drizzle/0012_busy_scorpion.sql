DROP INDEX "boardroom_control_challenges_identity_idx";--> statement-breakpoint
DROP INDEX "boardroom_control_claims_identity_idx";--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ADD COLUMN "boardroom_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ADD COLUMN "configuration_hash" text DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ADD COLUMN "facet_set_hash" text DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ADD COLUMN "boardroom_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ADD COLUMN "configuration_hash" text DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ADD COLUMN "facet_set_hash" text DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "queued_actions" ADD COLUMN "facet_set_hash" text DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
UPDATE "queued_actions" SET "status" = 'invalidated', "updated_at" = now() WHERE "status" = 'scheduled';--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ALTER COLUMN "boardroom_epoch" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ALTER COLUMN "configuration_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ALTER COLUMN "facet_set_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ALTER COLUMN "boardroom_epoch" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ALTER COLUMN "configuration_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ALTER COLUMN "facet_set_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "queued_actions" ALTER COLUMN "facet_set_hash" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "boardroom_control_challenges_identity_idx" ON "boardroom_control_challenges" USING btree ("chain_id","boardroom","facet_set_hash","boardroom_epoch","controller","controller_generation","configuration_hash","configuration_epoch");--> statement-breakpoint
CREATE INDEX "boardroom_control_claims_identity_idx" ON "boardroom_control_claims" USING btree ("chain_id","boardroom","facet_set_hash","boardroom_epoch","controller","controller_generation","configuration_hash","configuration_epoch","created_at");
