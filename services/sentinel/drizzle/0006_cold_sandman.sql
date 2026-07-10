LOCK TABLE "wallets", "auth_wallets", "wallet_owners" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		WITH claimed_wallets AS (
			SELECT lower("address") AS "address", "user_id" FROM "wallets"
			UNION
			SELECT lower("address") AS "address", "user_id" FROM "auth_wallets"
		)
		SELECT 1
		FROM claimed_wallets
		GROUP BY "address"
		HAVING count(DISTINCT "user_id") > 1
	) THEN
		RAISE EXCEPTION 'wallet credential migration found an address claimed by multiple users';
	END IF;

	IF EXISTS (
		WITH claimed_wallets AS (
			SELECT lower("address") AS "address", "user_id" FROM "wallets"
			UNION
			SELECT lower("address") AS "address", "user_id" FROM "auth_wallets"
		)
		SELECT 1
		FROM "wallet_owners" AS owners
		JOIN claimed_wallets ON claimed_wallets."address" = lower(owners."address")
		WHERE owners."user_id" IS DISTINCT FROM claimed_wallets."user_id"
	) THEN
		RAISE EXCEPTION 'wallet credential migration found an ownership mismatch';
	END IF;
END
$$;
--> statement-breakpoint
INSERT INTO "wallet_owners" ("address", "user_id")
SELECT claimed_wallets."address", claimed_wallets."user_id"
FROM (
	SELECT lower("address") AS "address", "user_id" FROM "wallets"
	UNION
	SELECT lower("address") AS "address", "user_id" FROM "auth_wallets"
) AS claimed_wallets
ON CONFLICT ("address") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mirror_auth_wallet_to_alerts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	existing_coverage boolean;
BEGIN
	SELECT bool_or("alerts_enabled")
	INTO existing_coverage
	FROM "wallets"
	WHERE "user_id" = NEW."user_id"
		AND lower("address") = lower(NEW."address");

	INSERT INTO "wallets" (
		"user_id",
		"address",
		"chain_id",
		"alerts_enabled",
		"verified_at"
	)
	VALUES (
		NEW."user_id",
		NEW."address",
		NEW."chain_id",
		COALESCE(existing_coverage, TRUE),
		NEW."created_at"
	)
	ON CONFLICT (lower("address"), "chain_id") DO UPDATE
	SET "verified_at" = GREATEST("wallets"."verified_at", EXCLUDED."verified_at");

	RETURN NEW;
END;
$$;
--> statement-breakpoint
INSERT INTO "auth_wallets" (
	"user_id",
	"address",
	"chain_id",
	"is_primary",
	"created_at"
)
SELECT
	coverage."user_id",
	coverage."address",
	coverage."chain_id",
	FALSE,
	coverage."created_at"
FROM "wallets" AS coverage
WHERE NOT EXISTS (
	SELECT 1
	FROM "auth_wallets" AS credential
	WHERE credential."chain_id" = coverage."chain_id"
		AND lower(credential."address") = lower(coverage."address")
);
--> statement-breakpoint
ALTER TABLE "wallets" DROP COLUMN "is_primary";
