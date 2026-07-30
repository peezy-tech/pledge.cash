ALTER TABLE "x402_router_support_challenges" ADD COLUMN "facet_set_hash" text DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "x402_router_support_plans" ADD COLUMN "facet_set_hash" text DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "x402_router_support_challenges" ALTER COLUMN "facet_set_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "x402_router_support_plans" ALTER COLUMN "facet_set_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "x402_router_support_challenges" ADD CONSTRAINT "x402_router_support_challenges_facet_set_hash_check" CHECK ("x402_router_support_challenges"."facet_set_hash" = lower("x402_router_support_challenges"."facet_set_hash")
        and "x402_router_support_challenges"."facet_set_hash" ~ '^0x[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "x402_router_support_plans" ADD CONSTRAINT "x402_router_support_plans_facet_set_hash_check" CHECK ("x402_router_support_plans"."facet_set_hash" = lower("x402_router_support_plans"."facet_set_hash")
        and "x402_router_support_plans"."facet_set_hash" ~ '^0x[0-9a-f]{64}$');
