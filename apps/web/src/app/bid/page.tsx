import type { Metadata } from "next";
import { BidForm } from "./BidForm";
import { stripeLiveMode } from "@/lib/stripe";
import { getSessionUser } from "@/lib/sessionAuth";
import { noindexMetadata } from "@/lib/seo";

export const metadata: Metadata = noindexMetadata("Place a bid");

// Server wrapper: reads the Stripe mode server-side (the client form can't see
// process.env.STRIPE_SECRET_KEY) and the advertiser session, and passes both
// down. The test-card hint only shows in test mode — never telling live
// advertisers to use card 4242. The form is gated on a signed-in user.
export default async function BidPage() {
  const user = await getSessionUser();
  return (
    <BidForm
      liveMode={stripeLiveMode()}
      user={user ? { name: user.name, email: user.email } : null}
    />
  );
}
