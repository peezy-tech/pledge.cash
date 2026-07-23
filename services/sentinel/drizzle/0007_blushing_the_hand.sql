CREATE TYPE "public"."boardroom_control_destination" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TABLE "boardroom_control_challenges" (
	"nonce" text PRIMARY KEY NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"destination_type" "boardroom_control_destination" NOT NULL,
	"destination_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"chain_id" integer NOT NULL,
	"boardroom" text NOT NULL,
	"controller" text NOT NULL,
	"controller_generation" bigint NOT NULL,
	"configuration_epoch" bigint NOT NULL,
	"issued_block" bigint NOT NULL,
	"issued_block_hash" text NOT NULL,
	"audience" text NOT NULL,
	"domain" text NOT NULL,
	"message" text NOT NULL,
	"message_hash" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boardroom_control_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_nonce" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"destination_type" "boardroom_control_destination" NOT NULL,
	"destination_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"chain_id" integer NOT NULL,
	"boardroom" text NOT NULL,
	"controller" text NOT NULL,
	"controller_generation" bigint NOT NULL,
	"configuration_epoch" bigint NOT NULL,
	"verified_block" bigint NOT NULL,
	"verified_block_hash" text NOT NULL,
	"message_hash" text NOT NULL,
	"signature_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boardroom_control_claims_challenge_nonce_unique" UNIQUE("challenge_nonce")
);
--> statement-breakpoint
ALTER TABLE "boardroom_control_challenges" ADD CONSTRAINT "boardroom_control_challenges_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ADD CONSTRAINT "boardroom_control_claims_challenge_nonce_boardroom_control_challenges_nonce_fk" FOREIGN KEY ("challenge_nonce") REFERENCES "public"."boardroom_control_challenges"("nonce") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boardroom_control_claims" ADD CONSTRAINT "boardroom_control_claims_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boardroom_control_challenges_destination_idx" ON "boardroom_control_challenges" USING btree ("destination_type","destination_id","created_at");--> statement-breakpoint
CREATE INDEX "boardroom_control_challenges_identity_idx" ON "boardroom_control_challenges" USING btree ("chain_id","boardroom","controller","controller_generation","configuration_epoch");--> statement-breakpoint
CREATE INDEX "boardroom_control_challenges_requester_idx" ON "boardroom_control_challenges" USING btree ("requested_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "boardroom_control_claims_destination_idx" ON "boardroom_control_claims" USING btree ("destination_type","destination_id","created_at");--> statement-breakpoint
CREATE INDEX "boardroom_control_claims_identity_idx" ON "boardroom_control_claims" USING btree ("chain_id","boardroom","controller","controller_generation","configuration_epoch","created_at");