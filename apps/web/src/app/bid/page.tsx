import { BidForm } from "./BidForm";
import { stripeLiveMode } from "@/lib/stripe";

// Server wrapper: reads the Stripe mode server-side (the client form can't see
// process.env.STRIPE_SECRET_KEY) and passes it down so the test-card hint only
// shows in test mode — never telling live advertisers to use card 4242.
export default function BidPage() {
  return <BidForm liveMode={stripeLiveMode()} />;
}
