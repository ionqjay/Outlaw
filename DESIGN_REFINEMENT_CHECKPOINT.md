# Design refinement — 2026-11-07

User correction: better design, not stripped-down pages. Improve /#how, /#owners and /login.html; preserve shop application and planned $29.99 monthly copy. Existing static HTML/CSS, fonts and image assets suffice; no new framework or paid resources.

Recovered clean branch design/simple-launch-pages at1945d50. PR10 already OPEN (prior title incorrectly says9.99); do not create duplicate. Remote main89a76fa; Vercel production dpl_7tTVhVG3RyGHTvfYuiTyqWrkk3a6 READY/PROMOTED89a76fa, preview1945d50 STAGED. Composio0.5.0 authenticated; GitHub connector absent, managed gh used for reads. Render service srv-d6lg6f14tr6s73cosdjg remains46594346 / dep-dbhrhjbbc2fs73a4hkbg LIVE; autoDeploy=no, trigger off, healthCheckPath empty, maintenance false. No infrastructure writes replayed.

Visual baseline capture in progress using documented Camofox REST, tab07014893-3030-4e0e-a9ef-d0b88396ad27; static fixture3420 excludes provider config. Captures /workspace/artifacts/smr-refine-before-*.png.

Pending: polish layout/art direction, focused/full CI tests, responsive browser interaction proof, coherent commit/update existing PR, green guarded merge, Vercel exactSHA/bytes/live visuals. No backend deployment in this design scope. Remaining operational gates unchanged: PR9 backend readiness release/health path, approved backup/restore, reviewer/support/policy ownership, isolated hosted auth/storage proof. SMS/Stripe deferred; Stripe attestation remains9900 until separate coordinated2999 setup.

## Refined implementation and local evidence
Implemented illustrated three-step cards, editorial section typography, a contrasting owner decision/fee panel and a photographic split account-access composition (form first on mobile). Existing auth handlers and shop specialties/approval flow unchanged. Corrected the mobile owner grid after actual screenshot inspection. Full isolated npm run check:133/133 pass. No production account writes. Final captures smr-refined-final-{home,pricing,login,registration,recovery}-{desktop,narrow,wide}.png at1440/375/430; capture log /tmp/smr-refined-final.log. Form/menu interactions /tmp/smr-refined-interactions.log. Local auth warning is an intentional unconfigured fixture, not a live outage. Earlier before-local images overlapped editing and are not clean baseline proof; use before-live plus original smr-simple-local artifacts for comparison.

Composio update cache reports0.6.0 available; installed0.5.0 meets requirement. No upgrade/signin performed.
