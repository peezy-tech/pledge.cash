UPDATE "x402_router_adapter_operations"
SET "signer_nonce" = NULL
WHERE "kind" = 'execution'
	AND "status" = 'claimed'
	AND "transaction_hash" IS NULL
	AND "payload_ciphertext" IS NULL;
--> statement-breakpoint
ALTER TABLE "x402_router_adapter_operations"
	DROP CONSTRAINT "x402_router_adapter_operations_signer_nonce_check";
--> statement-breakpoint
ALTER TABLE "x402_router_adapter_operations"
	ADD CONSTRAINT "x402_router_adapter_operations_signer_nonce_check" CHECK (
		"signer_nonce" IS NULL
		OR (
			"signer_nonce" >= 0
			AND "signer_nonce" <= 9007199254740991
		)
	);
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "x402_router_adapter_operations"
		WHERE "kind" = 'execution'
			AND "status" = 'manual_intervention'
			AND "signer_nonce" IS NOT NULL
			AND "transaction_hash" IS NULL
	) THEN
		RAISE EXCEPTION
			'manual execution operation has a signer nonce without its signed transaction hash; reconcile it before migration';
	END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "x402_router_adapter_operations"
	ADD CONSTRAINT "x402_router_adapter_operations_execution_signed_fields_check" CHECK (
		"kind" <> 'execution'
		OR (
			(
				"status" = 'claimed'
				AND "signer_nonce" IS NULL
				AND "transaction_hash" IS NULL
				AND "payload_ciphertext" IS NULL
			)
			OR (
				"status" = 'manual_intervention'
				AND (
					"signer_nonce" IS NULL
					OR (
						"signer_nonce" IS NOT NULL
						AND "transaction_hash" IS NOT NULL
					)
				)
			)
			OR (
				"status" IN (
					'signed',
					'submitted',
					'confirmed_success',
					'confirmed_failure'
				)
				AND "signer_nonce" IS NOT NULL
				AND "transaction_hash" IS NOT NULL
			)
		)
	);
