import { ConvexReactClient } from "convex/react";

// Convex client for the self-managed external deployment.
// URL comes from EXPO_PUBLIC_CONVEX_URL (.env.local / .env), written by `npx convex dev`.
const url = process.env.EXPO_PUBLIC_CONVEX_URL as string;

export const convex = new ConvexReactClient(url, {
  // RN has no "unsaved changes" concept; keep the client quiet.
  unsavedChangesWarning: false,
});
