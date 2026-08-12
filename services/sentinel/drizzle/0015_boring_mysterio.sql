DO $$
DECLARE
  nonce_count bigint;
BEGIN
  SELECT count(*) INTO nonce_count FROM "wallet_link_nonces";

  IF nonce_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Refusing to remove standalone wallet-link nonce storage because it contains data',
      DETAIL = format('wallet_link_nonces=%s', nonce_count),
      HINT = 'Inspect and explicitly expire or delete standalone wallet-link nonces before retrying this migration.';
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE "wallet_link_nonces";
