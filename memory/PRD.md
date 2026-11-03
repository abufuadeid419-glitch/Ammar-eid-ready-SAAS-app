
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

## Iteration 2026-11 (e) — Final document numbers offline (reserved ranges)
- convex/numbering.ts: POST /api/numbers/reserve {device_id, kinds} atomically reserves contiguous blocks from the company counter (counters table) per user+device+kind (sizes: sale/col 40, ret/pay 10, wret 5); idempotent (returns outstanding blocks, new block only when < half a block unused). GET /api/numbers/blocks audit (owner/accountant). Table number_blocks (used[] list).
- lib.allocDocNo: create mutations (sales, collections, sales-returns, payment-vouchers, warehouse-returns) accept doc_no; validated (prefix, in user's block, not used) and kept; else nextNo. Id idempotency runs first.
- Client src/docNumbers.ts: persistent per-user pool, mutex, persist-before-use, refill on login/reconnect/after sync; offlineActions stamp final numbers (no more "مؤقت").

## Iteration 2026-11 (f) — Unified print/send popup for all documents
- src/components/DocDoneSheet.tsx: global showDocDone(kind, doc) + DocDoneHost at app root (same design as the sale popup): sale, sales return, collection (all entry points), payment voucher, warehouse return, purchase, purchase return, supplier payment. Pending docs printable (final numbers), swaps to synced server copy.
- receipts.purchaseReceipt added; purchases now get purchase_no (PUR-xxxxx) + created_by_name.

## Iteration 2026-11 (g) — SaaS subscriptions restructure (on top of existing billing, no parallel system)
- Plans Free/Pro/VIP dynamic (draft→publish), now with `limits` (catalog resources e.g. products, invoices_month, custom) and `org_ids` (private/custom plans). VIP plan created+published (60 USD/mo, 600/yr).
- convex/subscription.ts: catalog (app_settings.billing_catalog: features+resources, dev-only edit), GET /subscription (owner: plan, status, start/end, meters used/max/%, last request), GET /subscription/quote (price, upgrade credit/proration, due, yearly saving), dev ledger, dev subscriptions list, dev actions freeze/unfreeze/suspend/reactivate/extend (audited + owner notified).
- billing.ts: proration credit on upgrade to higher tier (unused share of paid_price), transfer_date, duplicate payment_ref blocked at submit + approve, billing_ledger rows on approve/renew/refund, org gets limits/started_at/paid_price/period_days.
- Backend enforcement: products & monthly invoices (assertLimit), customers/employees (existing).
- UI: owner SubscriptionOverview + UsageAlerts (plans page + dashboard), yearly saving, current-plan badge, quote in checkout, transfer date; Dev tabs: الاشتراكات, السجل المالي, المميزات والموارد, plan editor PlanExtras.

## Iteration 2026-11 (h) — Owner-defined employee names + SaaS fixes
- Invite requires name (2–60). Activation (EMP- code / QR) sets user.name = invite name + name_locked; /auth/name rejects employees ("اسم الموظف يحدده المالك فقط"). Login/homeFor never ask unactivated users or employees for a name (owners still asked after activating).
- PATCH /api/employees/:id/name (OWNER, audited) edits employee or pending-invite name; UI rename icon + sheet in team list.
- SaaS fixes: require(..., {billing:true}) lets frozen/suspended/expired owners view plan & pay; promo price must be < regular price; yearly saving uses 12 months.
