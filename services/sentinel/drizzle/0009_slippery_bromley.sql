CREATE TYPE "public"."sentinel_market_lifecycle_source" AS ENUM('boardroom', 'bonding-curve', 'liquidity-factory', 'liquidity-locker');--> statement-breakpoint
CREATE TABLE "market_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"boardroom" text NOT NULL,
	"source" "sentinel_market_lifecycle_source" NOT NULL,
	"kind" text NOT NULL,
	"contract_address" text NOT NULL,
	"actor" text,
	"metadata" jsonb NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_lifecycle_events_chain_tx_log_unique" UNIQUE("chain_id","tx_hash","log_index")
);
--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "primary_market_mode" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "bonding_curve" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "primary_market_quote_asset" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "bonding_curve_phase" integer;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "bonding_curve_settlement_reason" integer;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "bonding_curve_phase_ends_at" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_status" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_locker" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_pool" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_quote_asset" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_reservation_curve" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_reservation_expected_locker" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_reservation_expected_pool" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_reservation_pair_key" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_reservation_salt" text;--> statement-breakpoint
ALTER TABLE "boardrooms" ADD COLUMN "liquidity_reservation_expires_at" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "market_lifecycle_events_boardroom_idx" ON "market_lifecycle_events" USING btree ("chain_id","boardroom","block_number");--> statement-breakpoint
CREATE INDEX "market_lifecycle_events_contract_idx" ON "market_lifecycle_events" USING btree ("chain_id","contract_address","block_number");--> statement-breakpoint
CREATE INDEX "boardrooms_bonding_curve_idx" ON "boardrooms" USING btree ("chain_id","bonding_curve");--> statement-breakpoint
CREATE INDEX "boardrooms_liquidity_locker_idx" ON "boardrooms" USING btree ("chain_id","liquidity_locker");