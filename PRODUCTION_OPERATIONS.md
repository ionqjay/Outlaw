# Production operations — local readiness, 2026-10-29

Status: NOT approved for deployment. This document supersedes obsolete email-onboarding targets and deployment instructions in older handoffs. No hosted configuration, export, migration, messages or deployment performed by this batch.

## Auth requirement and release scope
- User intends **phone-number/SMS authentication**. Existing email/password Supabase login is retained until a deliberate migration is approved; do not break existing users or interpret the legacy disabled /api/send-otp stub as verification.
- Existing Twilio environment placeholders/sendSms helper do not establish an approved SMS provider, verified phone identity, consent, delivery or recovery. Local dev headers and email SDK mocks do not prove SMS.
- SMS work separately requires provider/configuration authorization and controlled test numbers + authorization to send. Account identity/ban checks, invitation matching and notification addressing currently depend on email in places: map these to stable user IDs before claiming phone-only accounts work. Preserve account linking/recovery and anti-enumeration; test expired/replayed codes, resend throttling, number changes, sign-out and refresh. No guessed provider or auth rewrite here.
- Stripe remains separate. Keep the approved billing-disabled release scope; disabling app billing does not cancel provider subscriptions. Do not enable paid/new-marketplace flows to demonstrate readiness.

## Implemented local safeguards
- All API route casing now gets no-store; limiter rejections receive privacy/security headers too. Express accepts mixed-case routes, so the earlier case-sensitive header check was insufficient.
- /api/health previously triggered 15 database reads plus a bucket lookup for every anonymous request. Dependency checks now share one in-flight execution per process and cache true/false for five seconds. Configuration is checked each request. Dependency calls retain 10s deadlines; sequential groups can take about 30s. This is not a global rate limiter or an SMS/Stripe delivery proof.
- Existing Node tests, isolated file fixtures and native Render health-check configuration are reused, not a new paid monitoring stack. No dependency/infrastructure added.

## Predeployment gate (operator-authorized execution only)
1. Record backend and frontend deployment IDs/commit SHAs, configured origins, Node version and environment key NAMES (never values). Earlier checkpoint reported production design commit 6f7b50d; re-read live deployment records before relying on it. Review the entire local diff from that deployed commit, not just this batch.
2. Identify a disposable nonproduction Supabase + app origin. Earlier discovery found active Shopmyrepair, not a designated isolated staging target. Do not use unrelated inactive projects or assume production is disposable.
3. Compare hosted migration history/schema with supabase/migrations and reviewed SQL. Old schema.sql/002_enable_rls.sql are historical and MUST NOT be blindly replayed. Validate backend-only grants, trusted admin membership, atomic bid/workflow RPCs, message access, private photo bucket and storage/metadata consistency. No migration applied by this runbook.
4. On approved staging: install from lockfile, npm run check, then controlled owner/shop application + request/estimate/message/photo/completion flow; verify persistence, isolation and actual intended SMS auth. Fixtures are not hosted security/delivery evidence.
5. Record backup/restore drill evidence below. Review support/shop-review decisions. Receive release authorization before push/deploy. Preserve production secrets and BILLING_MODE; no new reviewer grants.
6. Deploy a compatible backend before frontend, verify /api/health and /api/availability, unauthorized API denial, mixed-case no-store, and controlled session/history. No live request, payment or SMS smoke without specific authorization.

## Backup + restore runbook (NOT executed; requires data/export authorization)
- Inventory: PostgreSQL application tables/RPCs/grants/migration history; Auth identities/config; private Storage photo bytes AND repair_photos metadata; deployment/environment configuration and secret recovery locations. A database dump alone does not back up Storage bytes. Do not presume Auth or secrets are covered by a project database restore.
- Inspect actual provider backup availability/retention and free-tier limits first. No PITR/automatic-backup guarantee is established. Use existing provider restore/download tooling or PostgreSQL tools only after verifying what they include; do not buy a plan implicitly.
- Operator must approve backup custodian, encrypted destination/access, retention and acceptable data-loss/recovery windows. No customer data export to this repository/artifacts/chat/third party. Record backup timestamp, source project, schema version, counts and checksum manifest without customer contents/secrets.
- Obtain an application-consistent snapshot: coordinate a write freeze or proven consistent database + object snapshot strategy. Account for concurrent photo upload/delete and pending/deleting rows; never delete ambiguous pending objects merely to make counts match.
- Restore into an explicitly disposable isolated target with outbound SMS/email/payment actions disabled and no production DNS. Restore schema/data and private objects through supported provider procedures; separately re-establish verified Auth/config/grants without making buckets public. Never restore over production as a test.
- Verify counts/foreign keys, migration history, denied direct anonymous/authenticated table access, object checksum/metadata agreement, owner/shop isolation, historical messages/photos and actual session handling. Measure elapsed recovery time and latest recoverable timestamp. Store a redacted drill report; a successful export alone is not recovery proof.
- Production disaster recovery requires explicit incident approval, source backup choice and data-loss acceptance. Retain the damaged state for investigation; do not overwrite/delete blindly. Reconcile records created since the snapshot before reopening writes.

## Monitoring readiness (use existing free surfaces; NOT configured)
- render.yaml already selects /api/health. Confirm deployed service actually uses it, health timeout tolerates bounded probes/cold starts, and native logs/metrics access exists. Free service sleep/cold starts are not an uptime SLA.
- Health 200 + ok/databaseReady true means required configuration/schema/private bucket checks passed recently (up to 5s cached). It does NOT mean SMS sends, auth recovery, backup restoration, reviewer availability, Stripe webhooks or every write work. /api/availability independently reports the billing/new-work gate.
- Suggested UNAPPROVED signal thresholds: repeated 503/network failures across two checks separated by at least 60s; sustained 5xx; unexpected 429 increase; pending photos older than 10min; failed dispatch/notification reconciliation; storage usage approaching actual free quota. Review against cold-start behavior before alerting. No scheduler or outbound alert was created.
- Assign an incident owner and authorized private alert destination before enabling any free native alerts. Do not put tokens, phone numbers, emails, photo content or request bodies in monitors. Prefer status, route template, duration and generic error category. Global request-error logs now use application route templates and allowlisted error categories instead of caller paths/arbitrary error names. Other provider/native logs still require review/redaction before external forwarding.
- Triage: check deployment/config change timeline, health fields, provider status and generic logs. Do not weaken authorization/CORS/RLS or turn on file fallback to make health green. Rate limits are per-process, reset at restart; trusted proxy CIDRs need actual host topology verification, never arbitrary trust-all or hop count.

## Rollback
- Trigger: regression in health, login/session, authorization, core persistence or unexpected billing/new-work behavior. Stop rollout and preserve redacted incident evidence; do not automatically retry uncertain mutations.
- Revert frontend to its recorded compatible release, then backend to its recorded compatible release when both artifacts are schema-compatible; coordinate rather than mix unsupported API contracts. Verify health, availability and authorized history again.
- This batch has no schema changes, so its application rollback does not need a DB rollback. For combined earlier work, compatibility must be checked first. Never run historical/down SQL or restore a backup as an ordinary app rollback. Schema incompatibility needs an approved forward fix or separately approved restore plan.
- If credential exposure caused the incident, an app rollback is insufficient: authorized operator rotates affected secrets and verifies clients. No secrets in incident reports.

## Business decisions — UNAPPROVED, not public policy
- Support: identify a real monitored contact/channel, responsible person, escalation and account-access dispute procedure. No invented support address or response-time promise.
- Shop review: identify an existing authorized reviewer; decide acceptable registration/license/insurance evidence, jurisdiction checks, expiration/re-review rules, rejection/resubmission and appeal handling. Do not confer admin membership to satisfy testing.
- Privacy/legal: approve actual data purposes (including SMS), consent/opt-out where applicable, retention/deletion/access handling, photo visibility, backup retention and incident handling with appropriate review. Do not publish invented legal commitments or certification/insurance guarantees.

## Finite release blockers
1. Authorized isolated staging target plus controlled SMS provider/test-number/send approval (SMS work separate; no email-test-inbox decision required).
2. Authorization for hosted migration-history/storage/access assessment and any resulting changes, backed by approved backup destination + restore drill and recovery objectives.
3. Named existing reviewer, real support/incident ownership and approved evidence/privacy/retention decisions.
4. Combined-change release risk review and explicit push/deployment approval after staging evidence. Stripe remains a separate closed workstream, not something this batch enables.
