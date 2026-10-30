# Public launch simplification — 2026-10-30

## Release scope
Homepage #how and #owners (not separate pages) are now a concise three-step journey plus owner questions. Removed repetitive trust panels, decorative quote preview, redundant hero actions and repeated top status banner. Kept an inline fail-closed availability notice, free-owner/paid-repair distinction, and separate repair-shop entry. Sign-in defaults to email/password only; existing owner/shop registration links open the separate account-creation mode. Shop specialties and manual-approval contract remain intact. No new dependencies, auth provider, live account submissions, or backend settings.

Displayed shop pricing is now **$29.99/month** across pricing metadata, plan card and dashboard copy. Checkout remains closed, no subscription starts today. Historical release documentation is not rewritten. IMPORTANT for deferred Stripe setup: lib/stripe-entitlement.js still attests the previous9900-cent configured plan. This UI-only release intentionally does not mutate price objects or entitlements. Before enabling billing, align the approved Stripe price and exact backend attestation/tests to2999 cents together; never just enable billing against the old plan.

## Recovery reconciliation
PR9 already merged89a76fac4e95d07b29e347fe04cd6a36a8d764e9. Vercel dpl_7tTVhVG3RyGHTvfYuiTyqWrkk3a6 READY/PROMOTED that SHA. Render remains46594346/dep-dbhrhjbbc2fs73a4hkbg, auto-deploy OFF, health path empty. No health deployment/config write was replayed in this design batch. Parent must finish the previously authorized bounded health-release proof separately.

## Actual verification
Original and revised Camofox full-page captures at1440/375/430: homepage (including both anchors), pricing, sign-in, shop registration and recovery. Revised widths matched scroll widths1428/363/418 excluding scrollbar; no overflow. Artifact prefix workspace/artifacts/smr-{before-simple,simple-local}-*.png. Local fixture3420 serves only static repository assets and synthetic billing-disabled availability, with provider config removed; local auth warning is expected, not a production outage. Mode tests cover signup/signin visibility, password autocomplete, Enter routing, mode-switch focus and password clearing; existing SDK adapter tests preserve confirmation/redirect behavior.

## Finite non-SMS/non-Stripe operational gates (not claimed complete)
1. Finish already approved Render readiness release and verify exact backend SHA, live bounded health behavior, then separately authorized health path; retain auto-deploy OFF.
2. Approve protected backup destination/custodian/retention/recovery objectives and isolated restore target, then authorize export/restore proof. Free Supabase backup listing was empty; docs are not backups.
3. Identify existing authorized shop reviewer and approve evidence/rejection policy; identify support/incident owner and approve privacy/retention/terms decisions before publishing claims/contact details. No invented policy or new privileges.
4. Designate isolated nonproduction target for remaining hosted auth/storage enforcement proof; do not reuse live customers or repurpose unrelated inactive projects. Local workflow tests/browser evidence are not hosted restoration/auth certification.

Parent owns these operational follow-ups. SMS and Stripe setup remain intentionally deferred.
