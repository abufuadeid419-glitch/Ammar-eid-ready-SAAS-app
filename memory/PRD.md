
## Iteration 2026-11 — Clone into new workspace + Dark Premium redesign
- Repo cloned from smart-system-ios-android-can-publish; same Convex deployment (fearless-ostrich-878); EXPO_PUBLIC_CONVEX_URL / _SITE_URL in frontend/.env.
- Dark Premium Luxe palette (charcoal + champagne gold + emerald, navy logo kept); dark is default theme.
- Login rebuilt to match user reference (warehouse photo hero, logo, 3 feature pills, dark card, gold-bordered Pro trial, gold CTA, terms links → /legal).
- Toasts now render above every Modal/Sheet/Select/tour (global toast store + per-modal ToastHost via AppModal).
- Arabic-Indic/Persian digits converted to Latin in numeric/phone fields, passwords, OTP, search.
- Sun/moon quick theme toggle (theme-quick-toggle) in every Header.
- Tests: iterations 1–2 passed.

## Backlog
- P1: Store Convex deploy key securely (secret card) before any backend redeploy.
- P2: Theme toggle on login screen; restyle remaining screens' details in light theme.
