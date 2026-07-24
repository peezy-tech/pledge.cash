ALTER TABLE "x402_router_quotes"
	DROP CONSTRAINT "x402_router_quotes_action_kind_check";
--> statement-breakpoint
ALTER TABLE "x402_router_quotes"
	ADD CONSTRAINT "x402_router_quotes_action_kind_check"
	CHECK ("action_kind" in ('amm_swap', 'fixed_price_sale', 'recurring_support'));
--> statement-breakpoint
CREATE TABLE "x402_router_support_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"boardroom" text NOT NULL,
	"chain_id" integer NOT NULL,
	"authority_mode" text,
	"authority" text,
	"controller_generation" numeric(78, 0) NOT NULL,
	"configuration_epoch" numeric(78, 0) NOT NULL,
	"plan_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"message" text NOT NULL,
	"issued_block" numeric(78, 0) NOT NULL,
	"issued_block_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"signature_hash" text,
	"verified_block" numeric(78, 0),
	"verified_block_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "x402_router_support_challenges_action_check" CHECK (
		"action" in (
			'plan_create',
			'plan_retire',
			'subscription_create',
			'subscription_cancel'
		)
	),
	CONSTRAINT "x402_router_support_challenges_authority_mode_check" CHECK (
		"authority_mode" IS NULL
		OR "authority_mode" in ('prelaunch_owner', 'launched_controller')
	),
	CONSTRAINT "x402_router_support_challenges_authority_check" CHECK (
		(
			"action" in ('plan_create', 'plan_retire')
			AND "authority_mode" IS NOT NULL
			AND "authority" IS NOT NULL
			AND "authority" = lower(btrim("authority"))
			AND "authority" ~ '^0x[0-9a-f]{40}$'
		)
		OR (
			"action" in ('subscription_create', 'subscription_cancel')
			AND "authority_mode" IS NULL
			AND "authority" IS NULL
		)
	),
	CONSTRAINT "x402_router_support_challenges_actor_check" CHECK (
		"actor" = lower(btrim("actor")) AND "actor" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_support_challenges_boardroom_check" CHECK (
		"boardroom" = lower(btrim("boardroom")) AND "boardroom" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_support_challenges_chain_check" CHECK ("chain_id" = 998),
	CONSTRAINT "x402_router_support_challenges_generation_check" CHECK (
		"controller_generation" >= 0 AND "configuration_epoch" >= 0
	),
	CONSTRAINT "x402_router_support_challenges_payload_check" CHECK (
		jsonb_typeof("payload") = 'object'
	),
	CONSTRAINT "x402_router_support_challenges_payload_hash_check" CHECK (
		"payload_hash" = lower("payload_hash")
		AND "payload_hash" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_support_challenges_issued_block_check" CHECK (
		"issued_block" >= 0
		AND "issued_block_hash" = lower("issued_block_hash")
		AND "issued_block_hash" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_support_challenges_expiry_check" CHECK (
		"expires_at" > "created_at"
	),
	CONSTRAINT "x402_router_support_challenges_consumed_check" CHECK (
		(
			"consumed_at" IS NULL
			AND "signature_hash" IS NULL
			AND "verified_block" IS NULL
			AND "verified_block_hash" IS NULL
		)
		OR (
			"consumed_at" IS NOT NULL
			AND "signature_hash" IS NOT NULL
			AND "signature_hash" ~ '^0x[0-9a-f]{64}$'
			AND "verified_block" IS NOT NULL
			AND "verified_block" >= 0
			AND "verified_block_hash" IS NOT NULL
			AND "verified_block_hash" ~ '^0x[0-9a-f]{64}$'
		)
	)
);
--> statement-breakpoint
CREATE INDEX "x402_router_support_challenges_expiry_idx"
	ON "x402_router_support_challenges" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE "x402_router_support_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"boardroom" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"cadence" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"terms_hash" text NOT NULL,
	"status" text NOT NULL,
	"authority_mode" text NOT NULL,
	"authority" text NOT NULL,
	"controller_generation" numeric(78, 0) NOT NULL,
	"configuration_epoch" numeric(78, 0) NOT NULL,
	"verified_block" numeric(78, 0) NOT NULL,
	"verified_block_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "x402_router_support_plans_chain_check" CHECK ("chain_id" = 998),
	CONSTRAINT "x402_router_support_plans_boardroom_check" CHECK (
		"boardroom" = lower(btrim("boardroom")) AND "boardroom" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_support_plans_asset_check" CHECK (
		"asset" = lower(btrim("asset")) AND "asset" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_support_plans_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "x402_router_support_plans_cadence_check" CHECK ("cadence" = 'monthly'),
	CONSTRAINT "x402_router_support_plans_title_check" CHECK (
		length("title") BETWEEN 1 AND 80 AND "title" = btrim("title")
	),
	CONSTRAINT "x402_router_support_plans_description_check" CHECK (
		length("description") BETWEEN 1 AND 280 AND "description" = btrim("description")
	),
	CONSTRAINT "x402_router_support_plans_terms_hash_check" CHECK (
		"terms_hash" = lower("terms_hash") AND "terms_hash" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_support_plans_status_check" CHECK (
		"status" in ('active', 'retired')
	),
	CONSTRAINT "x402_router_support_plans_authority_mode_check" CHECK (
		"authority_mode" in ('prelaunch_owner', 'launched_controller')
	),
	CONSTRAINT "x402_router_support_plans_authority_check" CHECK (
		"authority" = lower(btrim("authority")) AND "authority" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_support_plans_generation_check" CHECK (
		"controller_generation" >= 0 AND "configuration_epoch" >= 0
	),
	CONSTRAINT "x402_router_support_plans_verified_block_hash_check" CHECK (
		"verified_block" >= 0
		AND "verified_block_hash" = lower("verified_block_hash")
		AND "verified_block_hash" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_support_plans_retired_check" CHECK (
		("status" = 'active' AND "retired_at" IS NULL)
		OR ("status" = 'retired' AND "retired_at" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_support_plans_terms_hash_unique"
	ON "x402_router_support_plans" USING btree ("terms_hash");
--> statement-breakpoint
CREATE INDEX "x402_router_support_plans_boardroom_status_idx"
	ON "x402_router_support_plans" USING btree ("chain_id", "boardroom", "status", "created_at");
--> statement-breakpoint
CREATE TABLE "x402_router_support_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"payer" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "x402_router_support_subscriptions_plan_fk"
		FOREIGN KEY ("plan_id") REFERENCES "public"."x402_router_support_plans"("id")
		ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "x402_router_support_subscriptions_payer_check" CHECK (
		"payer" = lower(btrim("payer")) AND "payer" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_support_subscriptions_status_check" CHECK (
		"status" in ('active', 'cancelled')
	),
	CONSTRAINT "x402_router_support_subscriptions_cancelled_check" CHECK (
		("status" = 'active' AND "cancelled_at" IS NULL)
		OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_support_subscriptions_active_payer_unique"
	ON "x402_router_support_subscriptions" USING btree ("plan_id", "payer")
	WHERE "status" = 'active';
--> statement-breakpoint
CREATE TABLE "x402_router_support_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"active_quote_id" text,
	"period_index" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"payer" text NOT NULL,
	"boardroom" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "x402_router_support_invoices_subscription_fk"
		FOREIGN KEY ("subscription_id") REFERENCES "public"."x402_router_support_subscriptions"("id")
		ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "x402_router_support_invoices_plan_fk"
		FOREIGN KEY ("plan_id") REFERENCES "public"."x402_router_support_plans"("id")
		ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "x402_router_support_invoices_active_quote_fk"
		FOREIGN KEY ("active_quote_id") REFERENCES "public"."x402_router_quotes"("id")
		ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "x402_router_support_invoices_period_check" CHECK (
		"period_index" >= 0
		AND "period_end" > "period_start"
		AND "due_at" = "period_start"
	),
	CONSTRAINT "x402_router_support_invoices_payer_check" CHECK (
		"payer" = lower(btrim("payer")) AND "payer" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_support_invoices_boardroom_check" CHECK (
		"boardroom" = lower(btrim("boardroom")) AND "boardroom" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_support_invoices_asset_check" CHECK (
		"asset" = lower(btrim("asset")) AND "asset" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_support_invoices_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "x402_router_support_invoices_status_check" CHECK (
		"status" in ('open', 'cancelled')
	),
	CONSTRAINT "x402_router_support_invoices_cancelled_check" CHECK (
		("status" = 'open' AND "cancelled_at" IS NULL)
		OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_support_invoices_subscription_period_unique"
	ON "x402_router_support_invoices" USING btree ("subscription_id", "period_index");
--> statement-breakpoint
CREATE TABLE "x402_router_support_invoice_quotes" (
	"invoice_id" uuid NOT NULL,
	"quote_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "x402_router_support_invoice_quotes_pk" PRIMARY KEY ("invoice_id", "quote_id"),
	CONSTRAINT "x402_router_support_invoice_quotes_invoice_fk"
		FOREIGN KEY ("invoice_id") REFERENCES "public"."x402_router_support_invoices"("id")
		ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "x402_router_support_invoice_quotes_quote_fk"
		FOREIGN KEY ("quote_id") REFERENCES "public"."x402_router_quotes"("id")
		ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_support_invoice_quotes_quote_unique"
	ON "x402_router_support_invoice_quotes" USING btree ("quote_id");
--> statement-breakpoint
CREATE INDEX "x402_router_support_invoice_quotes_invoice_created_idx"
	ON "x402_router_support_invoice_quotes" USING btree ("invoice_id", "created_at");
