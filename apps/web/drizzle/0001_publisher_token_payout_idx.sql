ALTER TABLE "publishers" ADD COLUMN "dashboard_token" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_transfer_idx" ON "payouts" USING btree ("stripe_transfer_id");