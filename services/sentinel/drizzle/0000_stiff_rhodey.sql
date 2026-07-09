CREATE TYPE "public"."sentinel_analysis_source" AS ENUM('harness', 'template');--> statement-breakpoint
CREATE TYPE "public"."sentinel_boardroom_status" AS ENUM('prelaunch', 'active', 'winddown');--> statement-breakpoint
CREATE TYPE "public"."sentinel_channel_type" AS ENUM('telegram', 'twitter');--> statement-breakpoint
CREATE TYPE "public"."sentinel_decode_status" AS ENUM('decoded', 'undecoded');--> statement-breakpoint
CREATE TYPE "public"."sentinel_notification_event" AS ENUM('queued', 'cancelled', 'executed', 'reminder', 'policy-admin');--> statement-breakpoint
CREATE TYPE "public"."sentinel_notification_status" AS ENUM('pending', 'sent', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."sentinel_policy_admin_contract" AS ENUM('registry', 'asset-policy');--> statement-breakpoint
CREATE TYPE "public"."sentinel_queued_action_status" AS ENUM('queued', 'cancelled', 'executed');--> statement-breakpoint
CREATE TYPE "public"."sentinel_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."sentinel_subscription_mode" AS ENUM('holdings', 'explicit');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_calls" (
	"action_id" uuid NOT NULL,
	"call_index" integer NOT NULL,
	"policy" text NOT NULL,
	"target" text NOT NULL,
	"value" numeric(78, 0) NOT NULL,
	"data" text NOT NULL,
	"selector" text NOT NULL,
	"decoded_function" text,
	"decoded_args" jsonb,
	CONSTRAINT "action_calls_action_id_call_index_pk" PRIMARY KEY("action_id","call_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analyses" (
	"chain_id" integer NOT NULL,
	"action_hash" text NOT NULL,
	"harness" text NOT NULL,
	"model" text,
	"summary" text NOT NULL,
	"effects" jsonb NOT NULL,
	"affected_parties" jsonb NOT NULL,
	"severity_rationale" text NOT NULL,
	"source" "sentinel_analysis_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analyses_chain_id_action_hash_pk" PRIMARY KEY("chain_id","action_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boardrooms" (
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"share_token" text NOT NULL,
	"name" text,
	"owner" text NOT NULL,
	"executor" text NOT NULL,
	"governance_delay" bigint NOT NULL,
	"launched" boolean DEFAULT false NOT NULL,
	"status" "sentinel_boardroom_status" DEFAULT 'prelaunch' NOT NULL,
	"created_block" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boardrooms_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "sentinel_channel_type" NOT NULL,
	"telegram_chat_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_telegram_chat_id_unique" UNIQUE("telegram_chat_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cursors" (
	"chain_id" integer NOT NULL,
	"scope" text NOT NULL,
	"block_number" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cursors_chain_id_scope_pk" PRIMARY KEY("chain_id","scope")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"channel_type" "sentinel_channel_type" NOT NULL,
	"channel_id" uuid,
	"user_id" uuid,
	"action_id" uuid NOT NULL,
	"event" "sentinel_notification_event" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "sentinel_notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"external_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_admin_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"contract" "sentinel_policy_admin_contract" NOT NULL,
	"event_name" text NOT NULL,
	"subject" text NOT NULL,
	"enabled" boolean NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_admin_events_chain_tx_log_unique" UNIQUE("chain_id","tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "queued_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"boardroom" text NOT NULL,
	"action_hash" text NOT NULL,
	"queue_tx_hash" text NOT NULL,
	"salt" text NOT NULL,
	"executor" text NOT NULL,
	"eta" timestamp with time zone NOT NULL,
	"queue_block" bigint NOT NULL,
	"status" "sentinel_queued_action_status" DEFAULT 'queued' NOT NULL,
	"cancelled_by" text,
	"executed_by" text,
	"resolved_tx_hash" text,
	"decode_status" "sentinel_decode_status" DEFAULT 'undecoded' NOT NULL,
	"raw_calldata" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queued_actions_chain_boardroom_hash_tx_unique" UNIQUE("chain_id","boardroom","action_hash","queue_tx_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_assessments" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"ruleset_version" integer NOT NULL,
	"severity" "sentinel_severity" NOT NULL,
	"findings" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "share_balances" (
	"chain_id" integer NOT NULL,
	"token" text NOT NULL,
	"holder" text NOT NULL,
	"balance" numeric(78, 0) NOT NULL,
	"updated_block" bigint NOT NULL,
	CONSTRAINT "share_balances_chain_id_token_holder_pk" PRIMARY KEY("chain_id","token","holder")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_boardrooms" (
	"user_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"boardroom" text NOT NULL,
	CONSTRAINT "subscription_boardrooms_user_id_chain_id_boardroom_pk" PRIMARY KEY("user_id","chain_id","boardroom")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"mode" "sentinel_subscription_mode" DEFAULT 'holdings' NOT NULL,
	"min_severity" "sentinel_severity" DEFAULT 'medium' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workos_user_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_workos_user_id_unique" UNIQUE("workos_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_link_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"siwe_message" text NOT NULL,
	CONSTRAINT "wallets_user_id_address_pk" PRIMARY KEY("user_id","address")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "action_calls" ADD CONSTRAINT "action_calls_action_id_queued_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."queued_actions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channels" ADD CONSTRAINT "channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_action_id_queued_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."queued_actions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_action_id_queued_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."queued_actions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_boardrooms" ADD CONSTRAINT "subscription_boardrooms_user_id_subscriptions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."subscriptions"("user_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_link_nonces" ADD CONSTRAINT "wallet_link_nonces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_calls_policy_idx" ON "action_calls" USING btree ("policy");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_calls_selector_idx" ON "action_calls" USING btree ("selector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_calls_target_idx" ON "action_calls" USING btree ("target");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boardrooms_share_token_idx" ON "boardrooms" USING btree ("chain_id","share_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boardrooms_status_idx" ON "boardrooms" USING btree ("chain_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_user_idx" ON "channels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_delivery_idx" ON "notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_action_event_idx" ON "notifications" USING btree ("action_id","event");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_admin_events_subject_idx" ON "policy_admin_events" USING btree ("chain_id","subject");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "queued_actions_boardroom_idx" ON "queued_actions" USING btree ("chain_id","boardroom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "queued_actions_eta_idx" ON "queued_actions" USING btree ("status","eta");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "queued_actions_hash_idx" ON "queued_actions" USING btree ("chain_id","action_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "share_balances_holder_idx" ON "share_balances" USING btree ("holder");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "share_balances_token_balance_idx" ON "share_balances" USING btree ("chain_id","token","balance");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallets_address_idx" ON "wallets" USING btree ("address");