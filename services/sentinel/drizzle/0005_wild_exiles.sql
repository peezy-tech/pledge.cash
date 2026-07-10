DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "users" LIMIT 1) THEN
		RAISE EXCEPTION 'wallet-first auth migration requires an empty users table';
	END IF;
END
$$;
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_provider_account_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_user_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "wallet_owners" (
	"address" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_workos_user_id_unique";--> statement-breakpoint
DROP INDEX "wallets_address_idx";--> statement-breakpoint
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_user_id_address_pk";--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "siwe_message" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "chain_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "alerts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_wallets" ADD CONSTRAINT "auth_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_owners" ADD CONSTRAINT "wallet_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_wallets_address_chain_unique" ON "auth_wallets" USING btree (lower("address"),"chain_id");--> statement-breakpoint
CREATE INDEX "auth_wallets_address_idx" ON "auth_wallets" USING btree (lower("address"));--> statement-breakpoint
CREATE INDEX "auth_wallets_user_idx" ON "auth_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_invitations_email_idx" ON "organization_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "organization_invitations_organization_idx" ON "organization_invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_members_organization_idx" ON "organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_owners_user_idx" ON "wallet_owners" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_address_chain_unique" ON "wallets" USING btree (lower("address"),"chain_id");--> statement-breakpoint
CREATE INDEX "wallets_user_idx" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallets_address_idx" ON "wallets" USING btree (lower("address"));--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "workos_user_id";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_wallet_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	owned_by uuid;
BEGIN
	INSERT INTO "wallet_owners" ("address", "user_id")
	VALUES (lower(NEW."address"), NEW."user_id")
	ON CONFLICT ("address") DO NOTHING;

	SELECT "user_id"
	INTO owned_by
	FROM "wallet_owners"
	WHERE "address" = lower(NEW."address")
	FOR UPDATE;

	IF owned_by IS DISTINCT FROM NEW."user_id" THEN
		RAISE EXCEPTION 'wallet address is already owned by another user'
			USING ERRCODE = '23505';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_wallets_enforce_owner
BEFORE INSERT OR UPDATE OF "address", "user_id" ON "auth_wallets"
FOR EACH ROW
EXECUTE FUNCTION enforce_wallet_owner();--> statement-breakpoint
CREATE TRIGGER wallets_enforce_owner
BEFORE INSERT OR UPDATE OF "address", "user_id" ON "wallets"
FOR EACH ROW
EXECUTE FUNCTION enforce_wallet_owner();--> statement-breakpoint
CREATE OR REPLACE FUNCTION mirror_auth_wallet_to_alerts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "wallets" (
		"user_id",
		"address",
		"chain_id",
		"is_primary",
		"alerts_enabled",
		"verified_at"
	)
	VALUES (
		NEW."user_id",
		NEW."address",
		NEW."chain_id",
		NEW."is_primary",
		TRUE,
		NEW."created_at"
	)
	ON CONFLICT (lower("address"), "chain_id") DO UPDATE
	SET "is_primary" = "wallets"."is_primary" OR EXCLUDED."is_primary",
		"alerts_enabled" = TRUE,
		"verified_at" = GREATEST("wallets"."verified_at", EXCLUDED."verified_at");

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_wallets_mirror_alert_coverage
AFTER INSERT ON "auth_wallets"
FOR EACH ROW
EXECUTE FUNCTION mirror_auth_wallet_to_alerts();
