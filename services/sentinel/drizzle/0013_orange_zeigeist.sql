DROP TABLE "action_calls" CASCADE;--> statement-breakpoint
DROP TABLE "analyses" CASCADE;--> statement-breakpoint
DROP TABLE "boardroom_control_challenges" CASCADE;--> statement-breakpoint
DROP TABLE "boardroom_control_claims" CASCADE;--> statement-breakpoint
DROP TABLE "boardrooms" CASCADE;--> statement-breakpoint
DROP TABLE "channels" CASCADE;--> statement-breakpoint
DROP TABLE "cursors" CASCADE;--> statement-breakpoint
DROP TABLE "harness_runs" CASCADE;--> statement-breakpoint
DROP TABLE "market_lifecycle_events" CASCADE;--> statement-breakpoint
DROP TABLE "notifications" CASCADE;--> statement-breakpoint
DROP TABLE "policy_admin_events" CASCADE;--> statement-breakpoint
DROP TABLE "risk_assessments" CASCADE;--> statement-breakpoint
DROP TABLE "queued_actions" CASCADE;--> statement-breakpoint
DROP TABLE "share_balances" CASCADE;--> statement-breakpoint
DROP TABLE "subscription_boardrooms" CASCADE;--> statement-breakpoint
DROP TABLE "subscriptions" CASCADE;--> statement-breakpoint
DROP TABLE "telegram_link_codes" CASCADE;--> statement-breakpoint
DROP TRIGGER "auth_wallets_mirror_alert_coverage" ON "auth_wallets";--> statement-breakpoint
DROP FUNCTION "mirror_auth_wallet_to_alerts"();--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "alerts_enabled";--> statement-breakpoint
CREATE FUNCTION mirror_auth_wallet_to_wallets()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "wallets" (
		"user_id",
		"address",
		"chain_id",
		"verified_at"
	)
	VALUES (
		NEW."user_id",
		NEW."address",
		NEW."chain_id",
		NEW."created_at"
	)
	ON CONFLICT (lower("address"), "chain_id") DO UPDATE
	SET "verified_at" = GREATEST("wallets"."verified_at", EXCLUDED."verified_at");

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_wallets_mirror_wallet_link
AFTER INSERT ON "auth_wallets"
FOR EACH ROW
EXECUTE FUNCTION mirror_auth_wallet_to_wallets();--> statement-breakpoint
DROP TYPE "public"."sentinel_analysis_source";--> statement-breakpoint
DROP TYPE "public"."boardroom_control_destination";--> statement-breakpoint
DROP TYPE "public"."sentinel_boardroom_status";--> statement-breakpoint
DROP TYPE "public"."sentinel_channel_type";--> statement-breakpoint
DROP TYPE "public"."sentinel_decode_status";--> statement-breakpoint
DROP TYPE "public"."sentinel_governance_operation_kind";--> statement-breakpoint
DROP TYPE "public"."sentinel_market_lifecycle_source";--> statement-breakpoint
DROP TYPE "public"."sentinel_notification_event";--> statement-breakpoint
DROP TYPE "public"."sentinel_notification_status";--> statement-breakpoint
DROP TYPE "public"."sentinel_policy_admin_contract";--> statement-breakpoint
DROP TYPE "public"."sentinel_queued_action_status";--> statement-breakpoint
DROP TYPE "public"."sentinel_severity";--> statement-breakpoint
DROP TYPE "public"."sentinel_subscription_mode";
