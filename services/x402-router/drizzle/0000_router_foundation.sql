CREATE TABLE "x402_router_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"action_kind" text NOT NULL,
	"chain_id" integer NOT NULL,
	"payer" text NOT NULL,
	"recipient" text NOT NULL,
	"refund_address" text NOT NULL,
	"target" text NOT NULL,
	"quote" jsonb NOT NULL,
	"payment_identifier_hash" text NOT NULL,
	"payment_network" text NOT NULL,
	"payment_asset" text NOT NULL,
	"payment_amount" numeric(78, 0) NOT NULL,
	"application" text NOT NULL,
	"gateway" text NOT NULL,
	"intent_template_hash" text NOT NULL,
	"payment_requirements" jsonb NOT NULL,
	"intent" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_router_quotes_action_kind_check" CHECK ("action_kind" in ('amm_swap', 'fixed_price_sale')),
	CONSTRAINT "x402_router_quotes_id_length_check" CHECK (length("id") between 1 and 256),
	CONSTRAINT "x402_router_quotes_chain_check" CHECK ("chain_id" = 998),
	CONSTRAINT "x402_router_quotes_party_binding_check" CHECK (
		"payer" = "recipient" AND "payer" = "refund_address"
	),
	CONSTRAINT "x402_router_quotes_payer_check" CHECK (
		"payer" = lower(btrim("payer")) AND "payer" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_quotes_recipient_check" CHECK (
		"recipient" = lower(btrim("recipient")) AND "recipient" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_quotes_refund_address_check" CHECK (
		"refund_address" = lower(btrim("refund_address")) AND "refund_address" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_quotes_target_check" CHECK (
		"target" = lower(btrim("target")) AND "target" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_quotes_gateway_check" CHECK (
		"gateway" = lower(btrim("gateway")) AND "gateway" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_quotes_payment_identifier_hash_check" CHECK (
		"payment_identifier_hash" = lower("payment_identifier_hash")
		AND "payment_identifier_hash" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_quotes_template_hash_check" CHECK (
		"intent_template_hash" = lower("intent_template_hash")
		AND "intent_template_hash" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_quotes_payment_amount_check" CHECK ("payment_amount" > 0),
	CONSTRAINT "x402_router_quotes_json_check" CHECK (
		jsonb_typeof("quote") = 'object'
		AND jsonb_typeof("payment_requirements") = 'object'
		AND jsonb_typeof("intent") = 'object'
	),
	CONSTRAINT "x402_router_quotes_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_quotes_payment_identifier_hash_unique"
	ON "x402_router_quotes" USING btree ("payment_identifier_hash");
--> statement-breakpoint
CREATE INDEX "x402_router_quotes_expires_at_idx"
	ON "x402_router_quotes" USING btree ("expires_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION x402_router_reject_quote_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'x402 router quotes are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "x402_router_quotes_immutable"
	BEFORE UPDATE OR DELETE ON "x402_router_quotes"
	FOR EACH ROW EXECUTE FUNCTION x402_router_reject_quote_mutation();
--> statement-breakpoint
CREATE TABLE "x402_router_inventory_reservations" (
	"quote_id" text NOT NULL,
	"scope" text NOT NULL,
	"network" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_router_inventory_reservations_pk" PRIMARY KEY("quote_id", "scope", "network", "asset"),
	CONSTRAINT "x402_router_inventory_scope_check" CHECK ("scope" in ('destination_execution', 'source_refund')),
	CONSTRAINT "x402_router_inventory_status_check" CHECK ("status" in ('active', 'committed', 'consumed', 'released')),
	CONSTRAINT "x402_router_inventory_network_check" CHECK ("network" = lower(btrim("network"))),
	CONSTRAINT "x402_router_inventory_asset_check" CHECK ("asset" = lower(btrim("asset"))),
	CONSTRAINT "x402_router_inventory_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "x402_router_inventory_revision_check" CHECK ("revision" >= 0),
	CONSTRAINT "x402_router_inventory_expiry_check" CHECK ("expires_at" > "created_at"),
	CONSTRAINT "x402_router_inventory_quote_fk"
		FOREIGN KEY ("quote_id") REFERENCES "public"."x402_router_quotes"("id")
		ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "x402_router_inventory_asset_status_idx"
	ON "x402_router_inventory_reservations" USING btree ("network", "asset", "status", "expires_at");
--> statement-breakpoint
CREATE TABLE "x402_router_intent_payments" (
	"payment_network" text NOT NULL,
	"payment_transaction" text NOT NULL,
	"intent_hash" text NOT NULL,
	"primary_payment" boolean NOT NULL,
	"application" text NOT NULL,
	"gateway" text NOT NULL,
	"quote_id" text NOT NULL,
	"execution_network" text,
	"execution_transaction" text,
	"refund_network" text,
	"refund_transaction" text,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"claim_token" text,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_router_intent_payments_pk" PRIMARY KEY("payment_network", "payment_transaction"),
	CONSTRAINT "x402_router_intent_payment_tx_check" CHECK (
		"payment_transaction" = lower(btrim("payment_transaction"))
	),
	CONSTRAINT "x402_router_intent_hash_check" CHECK (
		"intent_hash" = lower(btrim("intent_hash")) AND "intent_hash" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_intent_gateway_check" CHECK (
		"gateway" = lower(btrim("gateway")) AND "gateway" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_intent_execution_tx_check" CHECK (
		"execution_transaction" IS NULL
		OR "execution_transaction" = lower(btrim("execution_transaction"))
	),
	CONSTRAINT "x402_router_intent_refund_tx_check" CHECK (
		"refund_transaction" IS NULL
		OR "refund_transaction" = lower(btrim("refund_transaction"))
	),
	CONSTRAINT "x402_router_intent_revision_check" CHECK ("revision" >= 0),
	CONSTRAINT "x402_router_intent_status_check" CHECK (
		"status" in (
			'paid',
			'execution_claimed',
			'execution_submitted',
			'executed',
			'execution_failed',
			'refund_pending',
			'refund_claimed',
			'refund_submitted',
			'refunded',
			'refund_failed',
			'manual_intervention'
		)
	),
	CONSTRAINT "x402_router_intent_record_check" CHECK (jsonb_typeof("record") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_intent_primary_unique"
	ON "x402_router_intent_payments" USING btree ("intent_hash")
	WHERE "primary_payment";
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_intent_quote_primary_unique"
	ON "x402_router_intent_payments" USING btree ("application", "gateway", "quote_id")
	WHERE "primary_payment";
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_intent_execution_tx_unique"
	ON "x402_router_intent_payments" USING btree ("execution_network", "execution_transaction")
	WHERE "execution_transaction" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_intent_refund_tx_unique"
	ON "x402_router_intent_payments" USING btree ("refund_network", "refund_transaction")
	WHERE "refund_transaction" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "x402_router_intent_status_idx"
	ON "x402_router_intent_payments" USING btree ("status", "updated_at");
--> statement-breakpoint
CREATE TABLE "x402_router_adapter_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"network" text NOT NULL,
	"signer" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"signer_nonce" numeric(20, 0),
	"payload_ciphertext" text,
	"payload_iv" text,
	"payload_auth_tag" text,
	"transaction_hash" text,
	"receipt" jsonb,
	"failure_code" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_router_adapter_operations_kind_check" CHECK ("kind" in ('payment_settlement', 'execution', 'refund')),
	CONSTRAINT "x402_router_adapter_operations_status_check" CHECK (
		"status" in (
			'claimed',
			'signed',
			'submitted',
			'confirmed_success',
			'confirmed_failure',
			'manual_intervention'
		)
	),
	CONSTRAINT "x402_router_adapter_operations_signer_nonce_check" CHECK (
		"signer_nonce" IS NULL
		OR (
			"signer_nonce" >= 0
			AND "signer_nonce" <= 18446744073709551615
		)
	),
	CONSTRAINT "x402_router_adapter_operations_request_hash_check" CHECK (
		"request_hash" = lower("request_hash") AND "request_hash" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_adapter_operations_signer_check" CHECK (
		"signer" = lower(btrim("signer")) AND "signer" ~ '^0x[0-9a-f]{40}$'
	),
	CONSTRAINT "x402_router_adapter_operations_tx_check" CHECK (
		"transaction_hash" IS NULL
		OR "transaction_hash" = lower(btrim("transaction_hash"))
	),
	CONSTRAINT "x402_router_adapter_operations_revision_check" CHECK ("revision" >= 0),
	CONSTRAINT "x402_router_adapter_operations_encrypted_payload_check" CHECK (
		(
			"payload_ciphertext" IS NULL
			AND "payload_iv" IS NULL
			AND "payload_auth_tag" IS NULL
		)
		OR (
			"payload_ciphertext" IS NOT NULL
			AND "payload_iv" IS NOT NULL
			AND "payload_auth_tag" IS NOT NULL
		)
	),
	CONSTRAINT "x402_router_adapter_operations_signed_fields_check" CHECK (
		"status" = 'claimed' OR "payload_ciphertext" IS NOT NULL
	),
	CONSTRAINT "x402_router_adapter_operations_receipt_check" CHECK (
		"receipt" IS NULL OR jsonb_typeof("receipt") = 'object'
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_adapter_operations_idempotency_unique"
	ON "x402_router_adapter_operations" USING btree ("kind", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_adapter_operations_transaction_unique"
	ON "x402_router_adapter_operations" USING btree ("network", "transaction_hash")
	WHERE "transaction_hash" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_adapter_operations_signer_nonce_unique"
	ON "x402_router_adapter_operations" USING btree ("network", "signer", "signer_nonce")
	WHERE "signer_nonce" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "x402_router_adapter_operations_lease_idx"
	ON "x402_router_adapter_operations" USING btree ("status", "lease_expires_at");
