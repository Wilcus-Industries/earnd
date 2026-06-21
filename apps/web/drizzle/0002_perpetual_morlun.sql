CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "payouts_enabled_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "advertisers_email_idx" ON "advertisers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_publisher_idx" ON "payout_accounts" USING btree ("publisher_id");