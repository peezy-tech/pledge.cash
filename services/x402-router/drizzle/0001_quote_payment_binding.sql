CREATE TABLE "x402_router_quote_payment_bindings" (
	"quote_id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"payment_payload_hash" text NOT NULL,
	"payment_requirements_hash" text NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x402_router_quote_payment_bindings_quote_fk"
		FOREIGN KEY ("quote_id") REFERENCES "public"."x402_router_quotes"("id")
		ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "x402_router_quote_payment_bindings_attempt_check" CHECK (
		"attempt_id" = lower("attempt_id")
		AND "attempt_id" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_quote_payment_bindings_payload_hash_check" CHECK (
		"payment_payload_hash" = lower("payment_payload_hash")
		AND "payment_payload_hash" ~ '^0x[0-9a-f]{64}$'
	),
	CONSTRAINT "x402_router_quote_payment_bindings_requirements_hash_check" CHECK (
		"payment_requirements_hash" = lower("payment_requirements_hash")
		AND "payment_requirements_hash" ~ '^0x[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_quote_payment_bindings_attempt_unique"
	ON "x402_router_quote_payment_bindings" USING btree ("attempt_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_router_quote_payment_bindings_payload_unique"
	ON "x402_router_quote_payment_bindings" USING btree ("payment_payload_hash");
