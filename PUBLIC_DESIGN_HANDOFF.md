# Public design foundation — 2026-10-28

## Scope and baseline

First bounded design batch, not a production-ready declaration. Started from clean working tree; fetched origin/main at ab18373 (PR #6 availability timeout), then created design/public-production-foundation. No backend, database, environment, billing, admin privileges or production deployment changes. No push.

Existing solution preflight: retained the repository's static HTML, CSS variables, Inter/Space Grotesk fonts, existing hero asset, navigation and auth scripts, and the already-installed jsdom for focused checks. No UI framework, dependency or paid resource needed.

## Delivered

- Shared public-only visual layer for homepage, shop pricing, account access/registration and password recovery. Dark navy information panels, stronger hierarchy, consistent cards, quieter launch notices, responsive spacing and unified footer.
- Simplified main navigation; visible keyboard focus, skip links, named landmarks, reduced-motion behavior and improved form hints/checkbox targets.
- Navigation Escape closes only an open menu and restores the correct accessible label; it no longer steals focus when the menu was closed.
- Kept existing authentication field IDs, handlers, endpoints, role selection and availability fail-closed behavior. No accounts submitted.
- Owner platform use remains free, repair work separately paid. Shop price remains planned $99/month with checkout closed. No invented coverage, testimonials or repair guarantees.

## Current evidence (not historical claims)

- Public beta API /api/availability returned billingMode=disabled and newQuotesAvailable=false on 2026-10-28. The www frontend uses the beta API via config.js; www/api/availability itself is not an API route (404), which is not evidence the configured beta endpoint is broken.
- Six focused public-design tests pass: landmarks, duplicate IDs, labels, local assets, keyboard menu behavior, prelaunch copy and auth DOM contracts.
- Syntax check for navigation.js and git diff --check pass.
- Captured and inspected live baseline and local redesigned homepage, pricing, owner login and shop registration at desktop/mobile widths. All four redesigned views had scrollWidth equal to clientWidth (1428 desktop, 378 mobile, excluding scrollbar); mobile media queries were active at the narrow width. Fixed an intrinsic hero-image height regression found in the screenshot pass and recaptured the homepage. Artifacts: /home/openclaw/.openclaw/workspace/artifacts/smr-{before,after}-{home,pricing,login,registration}-{desktop,mobile}.png. Local screenshots are static frontend previews, not proof of production auth or backend functionality. Local config intentionally uses dev auth; no local login/signup submitted.

## Production release gates — unresolved or not reverified in this batch

1. **Auth:** dedicated staging owner/shop signup, confirmation delivery, redirects, sign-in/out, recovery, session expiry and authorization isolation. Current auth providers/settings and email reliability not established by a screenshot.
2. **Marketplace workflows:** end-to-end owner/shop/history/messages/photos/status flows and failure recovery with authorized synthetic accounts. Full suite and broad QA deliberately deferred from this visual batch.
3. **Billing:** keep checkout closed. Operator decision and separate test-mode lifecycle/webhook/entitlement/reconciliation proof before activation. Disabled app does not stop existing Stripe charges; assess existing subscribers and a monitored support route.
4. **Database/storage:** current migration/grants/private-bucket evidence, backup ownership, restore rehearsal, retention/deletion handling and durable photo cleanup. Older project handoffs are historical, not current production proof.
5. **Operations:** monitored health/error/uptime checks, incident owner, logs without sensitive data, alert routing, rollback and deployment-trigger verification. Free-tier sleep behavior and support hours need explicit decisions.
6. **Shop verification/geography:** authoritative service boundary, business evidence requirements, reviewer ownership, review/rejection/escalation procedure. A registered-shop claim is not a repair-quality or insurance guarantee.
7. **Support and policy:** approved contact route, terms/privacy notices, data retention/deletion, complaints/disputes and refund process. No policy or placeholder contact was fabricated; footer links only to existing pages. These are launch blockers, not decorative follow-ups.
8. **Remaining design:** authenticated owner/shop dashboards and admin surfaces were intentionally not redesigned here. Review this batch before extending shared patterns to functional workflows.
9. **Release approval:** parent reviews local diff and screenshots before any push/deployment. Then coordinate scoped next batch and explicit production release proof. A polished public site does not open the marketplace.

## Visual capture method

Used the installed Camofox plugin's documented localhost REST routes, without cookies or telemetry changes. Navigation used /navigate because the tab-scoped navigation response stalled. Viewport updates physically applied but responses stalled; bounded those waits and verified clientWidth, scrollWidth and matchMedia rather than relying on anti-fingerprinting innerWidth. Requested screenshots: 1440px desktop and 390px mobile.

## Tooling caveat

Memory search was unavailable: index built for fts-only, configured model text-embedding-3-small. No index rebuild or provider spend performed. Used repository docs and supplied task constraints instead. Composio CLI 0.5.0 was present and signed in; no external write performed.

## Authorized release refinement — 2026-10-28

User subsequently authorized refinement, mobile confirmation and upload. Supersedes the initial hold on publication, not the marketplace launch gates above. Refined mobile spacing and readable helper/footer text; 16px input text; two-column shop specialties with 52px targets; clearer account instructions; consistent free-account CTA; recovery font, spacing, full-width action and status treatment. No auth handlers or backend contracts changed.

Inspected 15 rendered final previews: home/pricing/login/shop registration/recovery at 1440, 375 and 430px. All scrollWidth == clientWidth. Safe local interactions verified 48px mobile menu links, Escape focus return, link closure, shop checkbox selection, owner-role specialty hiding, and empty sign-in/signup/recovery feedback without account submission. Screenshots and logs: workspace/artifacts/smr-final-*.png, smr-final-measurements.log, smr-final-interactions.log. Preview availability/auth warnings are expected without a local backend and are not production failures. Six targeted tests pass; required repository CI remains intact.

Composio 0.5.0 authenticated; no GitHub connection exposed, so used managed gh fallback. Vercel read access through Composio verified project outlaw links main to public/ production. GitHub main reports no branch protection and no active rulesets; no protections were removed or bypassed. PR checks will still be awaited before the authorized merge.
