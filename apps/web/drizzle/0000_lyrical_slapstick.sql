CREATE TYPE "public"."bid_status" AS ENUM('active', 'paused', 'depleted');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('advertiser_balance', 'publisher_escrow', 'platform_revenue', 'external');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TYPE "public"."ledger_reason" AS ENUM('topup', 'impression_charge', 'impression_accrual', 'platform_fee', 'payout', 'refund', 'clawback');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'in_transit', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."surface_kind" AS ENUM('shell', 'tmux', 'vim');--> statement-breakpoint
CREATE TABLE "ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"line" text NOT NULL,
	"display_url" text NOT NULL,
	"target_url" text NOT NULL,
	"icon" text,
	"moderation" "moderation_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertisers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"cpm_millicents" bigint NOT NULL,
	"clearing_cpm_millicents" bigint,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"max_cpm_millicents" bigint NOT NULL,
	"budget_millicents" bigint NOT NULL,
	"daily_cap_millicents" bigint,
	"status" "bid_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_id" uuid NOT NULL,
	"impression_id" uuid,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"os" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce" text NOT NULL,
	"device_id" uuid NOT NULL,
	"publisher_id" uuid NOT NULL,
	"ad_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"surface" "surface_kind" NOT NULL,
	"clearing_cpm_millicents" bigint NOT NULL,
	"charge_millicents" bigint NOT NULL,
	"dwell_seconds" integer NOT NULL,
	"validation" text DEFAULT 'valid' NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"account" "ledger_account" NOT NULL,
	"owner_id" uuid,
	"direction" "ledger_direction" NOT NULL,
	"amount_millicents" bigint NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher_id" uuid NOT NULL,
	"amount_millicents" bigint NOT NULL,
	"stripe_transfer_id" text,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fraud_score" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_history" ADD CONSTRAINT "bid_history_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_impression_id_impressions_id_fk" FOREIGN KEY ("impression_id") REFERENCES "public"."impressions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ads_campaign_idx" ON "ads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "bid_history_at_idx" ON "bid_history" USING btree ("at");--> statement-breakpoint
CREATE INDEX "bids_active_idx" ON "bids" USING btree ("status","advertiser_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clicks_dedupe_idx" ON "clicks" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_pubkey_idx" ON "devices" USING btree ("public_key");--> statement-breakpoint
CREATE UNIQUE INDEX "impressions_nonce_idx" ON "impressions" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "impressions_advertiser_idx" ON "impressions" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "impressions_publisher_idx" ON "impressions" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX "impressions_redeemed_idx" ON "impressions" USING btree ("redeemed_at");--> statement-breakpoint
CREATE INDEX "ledger_account_owner_idx" ON "ledger_entries" USING btree ("account","owner_id");--> statement-breakpoint
CREATE INDEX "ledger_group_idx" ON "ledger_entries" USING btree ("group_id");