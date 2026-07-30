CREATE TABLE "identity_wallet_link_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"siwe_message" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_siwe_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_wallet_link_reconciliations" ADD CONSTRAINT "identity_wallet_link_reconciliations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_wallet_link_reconciliations_address_unique" ON "identity_wallet_link_reconciliations" USING btree (lower("address"));--> statement-breakpoint
CREATE INDEX "identity_wallet_link_reconciliations_subject_idx" ON "identity_wallet_link_reconciliations" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "identity_wallet_link_reconciliations_user_idx" ON "identity_wallet_link_reconciliations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "legacy_siwe_nonces_expires_at_idx" ON "legacy_siwe_nonces" USING btree ("expires_at");