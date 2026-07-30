DROP INDEX "boardroom_control_challenges_identity_idx";--> statement-breakpoint
DROP INDEX "boardroom_control_claims_identity_idx";--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ADD COLUMN "boardroom_epoch" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ADD COLUMN "configuration_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ADD COLUMN "facet_set_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ADD COLUMN "boardroom_epoch" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ADD COLUMN "configuration_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ADD COLUMN "facet_set_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "queued_actions" ADD COLUMN "facet_set_hash" text NOT NULL;--> statement-breakpoint
CREATE INDEX "boardroom_control_challenges_identity_idx" ON "boardroom_control_challenges" USING btree ("chain_id","boardroom","facet_set_hash","boardroom_epoch","controller","controller_generation","configuration_hash","configuration_epoch");--> statement-breakpoint
CREATE INDEX "boardroom_control_claims_identity_idx" ON "boardroom_control_claims" USING btree ("chain_id","boardroom","facet_set_hash","boardroom_epoch","controller","controller_generation","configuration_hash","configuration_epoch","created_at");