# Launch execution board

Initial baseline: 2026-11-10, f083f87f2c4ec2f70b6fcac9f1f705475fdcc987. Final application candidate **62b14ef71d6d3325dd9ee5dc7c3caa6ece7b5cfe: local release-candidate PASS; operational launch NO-GO**. Preserve this application SHA even after the docs-only commit changes HEAD. This is a finite assignment plan, not an authorization to mutate production. Charter defines role paths and gates.

## Initial discovery work packages (historical plan; superseded for implementation below)
| ID / priority | Owner / dependency | Bounded deliverable | Measurable completion evidence |
|---|---|---|---|
| OPS-01 / P0 | Ops; none | Read-only refresh of Supabase state, Render deploy SHA/status/health path/auto-deploy and frontend promoted SHA; identify reason for 503 without customer data reads | UTC/provider IDs + redacted state, exact command preflight/version/auth result, read-only health/availability statuses; distinguish LIVE deployment from healthy app. No reactivation |
| ENG-01 / P0 | Engineering; none | Fresh code/test baseline and focused investigation of readiness, billing-disabled guards and planned-price mismatch. Fix only a reproduced local runtime defect within assigned scope; otherwise report no fix needed | Isolated npm run check log/count/exit, focused readiness and billing tests; exact changed paths/diff; explicit confirmation checkout remains closed and no 2999 activation |
| DES-01 / P0 | Design; none | Browser audit of current public/account/application UX against truthful prelaunch scope. Fix only demonstrated UI defect after parent assigns exact paths | Desktop/375/430 screenshots and width measurements, keyboard/form/menu/recovery interactions; no unsupported live-marketplace/SMS/certification claims; design/auth-mode test results |
| QA-01 / P0 | Independent QA; baseline may run immediately, final run after ENG-01/DES-01 freeze | Independent local acceptance and defect severity report, using existing test/fixture stack with no provider credentials | Fresh candidate npm run check; browser request/estimate/message/photo/completion/review/retry/isolation evidence with synthetic records, plus separate disabled-mode rejection/history tests. List unexercised cases; no hosted-ready claim |
| OPS-02 / P1 | Ops; OPS-01 | Narrow operator decision packet: project reactivation prerequisites, staging designation, recoverability gaps, existing incident/reviewer/support ownership, monitoring-path decision | Exact resource IDs/current settings, cost/restore ambiguity, separate approvals needed, compatible release/rollback sequence; no exports/restore/new resources/config |
| ENG-02 / P1 | Engineering; QA-01 defects + parent assignment | One bounded remediation batch for reproducible blocking defects, coordinated with Design for UI-owned paths | Regression test first where practical; before/after result and minimal diff; no speculative auth/billing rewrite. If no blocking defect, close as not needed |
| QA-02 / P1 | Independent QA; ENG-02 + final Design/Engineering freeze | Final local regression and release gate report for exact candidate | Independent pass/fail/blocked per G0–G6; verify fixes did not weaken guards. No implementation author self-approval |
| OPS-03 / BLOCKED | Ops; explicit reactivation + hosted test/recovery approvals, then OPS-02 | After a separately authorized scope: hosted recovery verification, isolated Auth/storage/workflow proof, restore drill and reviewed release evidence | Healthy dependency + exact deployment parity, authorized hosted access/isolation, DB/Auth/object recovery measurements, approved ownership/policy and rollback. Each external mutation has distinct scope and readback |
| CEO-01 / final | Launch lead; specialist reports and QA-02; OPS-03 for hosted acceptance | Synthesize one truthful milestone verdict and smallest next decision | Gate matrix with evidence references and unresolved items; operational launch stays NO-GO until all operational gates pass and operator approves opening |

## Initial execution order (superseded by sole-writer remediation below)
1. Parent may assign OPS-01, ENG-01, DES-01 and QA-01 baseline in parallel with explicit path locks. QA observations may run concurrently but final acceptance must use a frozen candidate.
2. Parent collects specialist reports; deduplicate findings into one defect list. Engineering owns runtime defects, Design owns public UI. Do not send workers into the same files.
3. Run at most one bounded ENG-02/design remediation cycle before independent QA-02; additional defects become a clearly scoped next batch, not an endless agent loop.
4. OPS-02 runs without production writes. Work blocked on operator decisions remains blocked while safe local tasks proceed.
5. CEO-01 reports local readiness separately from hosted prelaunch and operational marketplace readiness. Production release/opening is never automatic.

## Initial evidence ledger
- CEO inspection: initial git status --short and git diff --stat empty; actual HEAD/merge history verified. docs/launch-team did not exist before this assignment; no existing files overwritten.
- Source review: billing-mode defaults enabled if unset; explicit disabled gates new work; pricing metadata/card $29.99; backend Stripe attestation 9900 cents. Existing fixture uses synthetic enabled mode and strips provider credentials; it is not production availability proof.
- Historical reports: design checkpoint says 133 tests and prior browser artifacts; CORE_WORKFLOW_CHECKPOINT says 126 at earlier deadline revision. Neither is counted as a fresh independent QA pass.
- Fresh CEO bounded baseline: node --test test/release-smoke.test.js test/health-deadline.test.js test/billing-disabled.test.js — 11/11 passed, zero failed/skipped, exit 0 (2026-11-10). Hung-dependency actual handler test completed in about 3.106s. This supports planning only, not independent release acceptance. Documentation whitespace checks produced no findings (git diff --no-index exits 1 for newly added file differences, not a test failure). At the initial CEO check only docs/ was untracked; no tracked application changes.
- Initial hosted statuses were handoff only. Fresh Ops and QA reports have now been relayed by the parent and are recorded below; no external-app operations were performed by CEO.

## Exact blocked decisions for parent to relay
**First / pending:** “May we resume the existing paused Supabase project ntlsefkfbdnriknukjzl using the supported SUPABASE_RESTORE_PROJECT operation? Ops confirms this is paused-project resumption, with no inherent paid upgrade. This does not authorize backup/data restore, import, new resources, exports, accounts/admin grants or SMS/Stripe; stop if the operation presents different or paid implications.” Explicit approval remains outstanding.

**Milestone clarification:** “While SMS and Stripe stay deferred, should we target a healthy, honest prelaunch with applications/manual review and new repairs/quotes/subscriptions closed? Operational marketplace launch needs a separate authorized plan to address its current billing/new-work coupling and intended authentication.” Recommend prelaunch recovery first; do not imply full launch is already possible.

Later separate decisions: designate disposable isolated hosted app/Supabase target and authorized controlled test identities/actions; approve protected backup destination/custodian/retention/recovery objectives, export and isolated restore separately; name real support/incident owner and already-authorized reviewer plus review/privacy policies; approve any new deployment scope after QA evidence. The existing Render health-path approval is already granted conditionally on healthy service; do not request duplicate approval or execute while health is 503. No generic credentials request and no implied spend approval.


## Discovery specialist synthesis — 2026-11-10 (historical baseline)
Parent reports all four discovery lanes returned. Treat findings as specialist evidence, not new CEO executions:
- QA independently passed **133/133** on clean f083f87f. This baseline does not cover the five newly reproduced gaps and is NOT acceptance of the upcoming patch.
- Engineering identified two P1 and three P2 defects below; duplicate auth submission produced **two SDK calls**. README still contains obsolete Stripe $99 / RLS setup instructions.
- Ops refreshed Supabase **INACTIVE**, Free tier, health **503**; Render **LIVE f083f87f**, auto-deploy OFF, health path empty; backups **[]**, PITR off. No accessible recovery proof. LIVE is deployment state, not application health.
- SUPABASE_RESTORE_PROJECT is supported paused-project resume, not inherently paid. User approval is pending. Render health-path approval already exists but its healthy-service condition is unmet.

## Completed implementation assignment — Engineering sole writer
This section supersedes the initial parallel writer plan. Parent dispatches Engineering; CEO sends no worker messages. Engineering alone edits necessary app/tests and README.md / PRODUCTION_OPERATIONS.md. Design is advisory only; QA does not fix implementation/tests. CEO owns only CHARTER.md / BOARD.md. The original assignment prohibited commits; parent subsequently authorized implementation commits and now the explicit-path CEO docs-only commit. No push, deployment, migrations, provider/config changes or new dependencies are authorized by this finalization.

Order: **FIX-01 and FIX-02 first**, then FIX-03–05, then DOC-01, candidate freeze and independent QA. All five fixes are required for this bounded patch; P2 is not silently waived.

| Package / priority | Concrete scope | Finite acceptance and required regression proof |
|---|---|---|
| FIX-01 / P1 | public/availability.js and index.html availability assurances, related tests | When health is 503, network fails, or readiness is unknown, page must not assert accounts/history are operational. /api/availability is only a business gate, not readiness proof. Prefer truthful non-assuring wording over adding a polling system. Test business-disabled + health-unavailable/unknown and healthy cases as applicable to chosen implementation; initial/static markup must also be truthful before JS or on fetch failure. Preserve coming-soon/new-work closure and usable navigation; do not infer authenticated history access merely from health 200. |
| FIX-02 / P1 | public/auth.js pending-operation handling, auth regression tests | Reproduce rapid click/click and Enter/click for both sign-in and sign-up with a deliberately pending SDK promise; **exactly one SDK call** until settlement. Mode switches cannot change the in-flight operation or permit a second call. Capture submitted mode/data coherently. On success, rejection and thrown error, pending state clears appropriately, errors remain visible, and explicit retry works once without automatic uncertain-write replay. Verify keyboard behavior and existing confirmation/recovery behavior remain intact. |
| FIX-03 / P2 | Owner/shop profile field markup and associated tests | All **6 owner and 10 shop reported fields** have visible descriptive labels programmatically associated with controls; placeholders alone do not count. Regression enumerates the affected fields and verifies label/control linkage and accessible names. Browser check at desktop/375/430 confirms no clipping/overflow and preserved values/validation/tab navigation. |
| FIX-04 / P2 | Feedback dialog and rating interaction, associated tests | Dialog has accessible role/name/modal semantics (native or equivalent), moves focus inside on open, contains Tab/Shift+Tab focus while modal, closes with Escape and restores focus to opener. Rating exposes selected value programmatically with appropriate keyboard semantics; visible selected state remains distinct. Verify blank rating rejection, chosen rating submit, reopen/update and close/reopen without duplicate handlers/submissions. Real keyboard browser check supplements DOM tests. |
| FIX-05 / P2 | public/app-auth.js hosted/local profile precedence, associated tests | Successfully loaded authoritative hosted values win over stale localStorage, including explicit empty/null/cleared values; falsy fallbacks must not resurrect deleted data. Distinguish missing data/fetch failure from deliberate clears. Test stale local vs newer hosted, hosted clears, save-clear-reload, and separate users/sign-out so cache cannot populate another identity. Preserve documented local-fixture behavior without silently presenting stale fallback as fresh hosted state. No hosted writes needed. |
| DOC-01 / P2 | README.md and PRODUCTION_OPERATIONS.md corrections only | Establish current f083f87f baseline and dated Ops evidence; label earlier healthy/deployment/test claims historical. State planned $29.99/manual review with checkout closed and legacy 9900 attestation deferred; remove operational instructions to blindly enable old $99 pricing or replay obsolete RLS SQL. Point to reviewed migration-history/isolated-test process; no migrations executed. Record SMS/Stripe deferred, resume approval pending, existing conditional Render health-path approval, and missing backup proof. Do not call 133 existing tests proof of these new regressions or invent support/reviewer/restore evidence. |

## Frozen-patch handoff and independent gate
1. Engineering returns base SHA, full changed-path list and diff (or patch digest), per-FIX before/after reproduction, test commands/counts/exit codes, syntax and whitespace results, and any browser evidence. Run isolated npm run check with no production credentials. Existing assertions must not be weakened merely to turn the suite green.
2. Parent freezes candidate and hands the same diff to independent QA. QA confirms candidate identity before and after testing; any intervening implementation change invalidates affected acceptance and requires rerun. No test-edit or app-fix authority for QA.
3. QA independently reproduces FIX-01–05 acceptance, checks DOC-01 accuracy, runs full isolated suite, and verifies disabled billing/new-work/security contracts and responsive/keyboard interaction. Record PASS/FAIL/BLOCKED for each row with exact evidence; unsupported hosted tests remain BLOCKED, not synthetic passes.
4. CEO gate for **local patch acceptance**: all six rows pass independent review, full suite green with no unexplained skips, no unrelated/auth-provider/billing activation/config change, and frozen identity established. An engineering pass alone is insufficient. Failed row returns one narrowly scoped correction through parent, not parallel overlapping edits.
5. CEO gate for **hosted/operational launch** remains **NO-GO** even after local acceptance: last observed Nov 10 health 503 (not freshly rechecked); resume approval pending; staging/controlled hosted identity and storage proof, existing reviewer/evidence policy, support/incident ownership, protected backup/export/isolated restore decisions and measured recovery still unresolved. SMS/Stripe remain intentionally deferred, and current billing-disabled behavior closes new requests/quotes. No release or marketplace-opening authorization follows from this board.

## Current board status
- Discovery OPS-01 / ENG-01 / DES-01 / QA-01: reports returned via parent; baseline is not patch acceptance.
- FIX-01–05 / DOC-01: **completed and locally accepted**, implementation 86132f6 plus corrective 62b14ef; independent QA feedback loop below.
- QA-02: **PASS on application 62b14ef71d6d3325dd9ee5dc7c3caa6ece7b5cfe**, fresh 157/157 and independent edge verification.
- Supabase resume: **blocked on explicit user approval**.
- Render health-path execution: **already conditionally approved, blocked on healthy prerequisite/proof**; auto-deploy remains OFF.
- Hosted recovery/testing and operational launch: **blocked** as above. CEO bounded local gate is complete, PASS with evidence limitations below; not launch-certified.


## Final CEO decision and completed feedback loop
| Stage | Result / evidence | Gate consequence |
|---|---|---|
| Engineering five-fix implementation + docs | Commit 86132f6 | Implementation complete; not self-approved |
| Independent QA first pass | 150 tests passed; discovered P2 recovery-result uncertainty and null state becoming NY | Acceptance held pending correction despite green suite |
| Engineering correction | Commit 62b14ef71d6d3325dd9ee5dc7c3caa6ece7b5cfe | Recovery communicates uncertainty without automatic retry; explicit null state stays blank |
| Independent QA corrected candidate | Fresh 157/157, 0 failed/skipped; original edge reproductions closed | Bounded local release candidate PASS |
| CEO finalization | Inspected actual git history and saved check/edge logs; only launch-team docs edited | Local acceptance recorded; no launch certification/push/deploy/live operation |

Evidence locations: /tmp/smr-corrections-qa-ejhGG3/{check.log,independent-edges.log,independent-edges.mjs}. Observed edge output: pending recovery one call, mode frozen; rejected/uncertain outcome explicitly warns an email may already have been sent, no automatic retry, controls re-enabled; both owner and mechanic canonical null state display empty. QA report is independently produced; CEO log inspection is not another independent implementation test.

Browser evidence boundary: workspace/artifacts/smr-team-* screenshots at actual 1440/375/430 were inspected for the prior patch. Final corrective logic was exercised with JSDOM/independent checks, not a new real-browser pass. Do not relabel prior screenshots as final-SHA browser proof. Hosted production Auth/private-storage behavior and recovery remain unproved by these local checks.

### Executive recommendation / next operator approval
Accept this **local candidate** and keep production/new-work activation closed. Ask only the next actionable decision: **“May we resume the existing paused Supabase project ntlsefkfbdnriknukjzl with SUPABASE_RESTORE_PROJECT, without a paid upgrade, new resources, import or backup/data restore?”** Approval is still pending; once granted, parent must recheck current state/operation before executing and stop if implications differ. Last known INACTIVE/Free/503/backups[]/PITR-off evidence is from Nov 10, not a new live check.

Existing Render health-path approval remains conditional on healthy service/proof and does not need to be asked again. Staging/controlled hosted tests, backup destination/custodian/retention/export/isolated restore approval, reviewer/support/incident ownership and policies remain unresolved separate gates. SMS and Stripe remain deferred; planned price $29.99 and legacy backend 9900 attestation must **not** be activated as-is.

Team roles persist as kept sessions under parent coordination, not an always-running/configured autonomous company. No new assignments/fanout/background execution are created by this final gate.
