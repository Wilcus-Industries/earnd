import { createAuthClient } from "better-auth/react";

// better-auth React client. Defaults to same-origin `/api/auth/*`, so cookies
// travel with credentials automatically. No baseURL needed on the same host.
export const authClient = createAuthClient();
