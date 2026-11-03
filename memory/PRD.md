
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

## Iteration 2026-11 (b) — Dashboard Pro/VIP pricing
- src/components/PlanPricing.tsx on owner home: live published paid plans (GET /plans), monthly/yearly toggle, promo logic shared via pro.ts (priceFor/promoOn, YYYY/MM/DD dates normalized), "upgrade" deep-links /upgrade?plan=&billing= which auto-opens checkout; VIP "request a quote" card when no VIP plan is published.
- Plans page strikethrough only when promo < regular price. Light-theme gold darkened (#8C6A28) for contrast.
- Tests: iterations 3–4 passed.
## Backlog
- Data: Pro plan promo price (199) > regular price (25) — developer should fix in plan editor.
- P2: ProBanner "yearly is best value" copy should use the same check.

## Iteration 2026-11 (c) — Plan expiry SMS reminders
- convex/billing.ts: daily cron 08:30 UTC → sendExpiryReminders (action). Paid (LICENSE, not SUSPENDED) orgs get in-app + SMS to owner at reminder_days (1–30, default 7), 3, 1 days left and on expiry; once per expiry date (org.expiry_reminders keys). SMS includes renew link <CONVEX_SITE_URL>/renew.
- convex/http.ts: GET /renew — Arabic dark page that opens smartsystem://upgrade (works in installed builds, not Expo Go).
- Convex deployed with CONVEX_DEPLOY_KEY (backend secret). Tests: iterations 5–6 passed.

## Iteration 2026-11 (d) — Sale payment choice + print/send popup
- NewSale: required payment choice نقدي / آجل / دفعة جزئية (partial amount 0<x<total, inline error), live paid/remaining summary; after save a bottom sheet (sale-done-sheet) with totals + WhatsApp PDF / PDF / print / SMS; swaps to synced invoice number automatically. Tests: iterations 7–8 passed.
