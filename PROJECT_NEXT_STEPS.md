# Project Next Steps (Execution Plan)

Updated: 2026-03-17

## 1) Stabilize Admin Account Management (Highest Priority)

Goal: ensure admin operations are reliable before adding scope.

### Critical smoke checks
- [ ] Admin billing/accounts screen loads without console errors
- [ ] Merged auth + billing list renders correctly (no duplicate/missing users)
- [ ] Ban/unban updates account behavior immediately
- [ ] Manual access override states work exactly:
  - [ ] `active` grants access
  - [ ] `disabled` blocks access
  - [ ] `null` falls back to normal billing
- [ ] Table actions still work after sorting/filtering/search

### API checks
- [ ] `/api/admin/billing` returns expected fields for UI
- [ ] `/api/admin/billing/:userId/manual-access` writes and persists state
- [ ] Admin token gate works (401 when missing/wrong token)

---

## 2) Close Invite Lifecycle Edge Cases

Goal: prevent provider invite dead-ends and support churn.

### Core lifecycle checks
- [ ] New invite gets `expires_at` window based on urgency
- [ ] Countdown displays correctly in UI
- [ ] Expired pending invites are marked expired and replacements are generated
- [ ] No duplicate replacements for same provider/type
- [ ] If request itself is expired, no new invites are created

### Edge-case scenarios
- [ ] Invite expires while provider is viewing request
- [ ] Provider tries to accept just after expiry (correct rejection)
- [ ] Two near-simultaneous replacement paths do not create duplicate active invites
- [ ] Timezone display remains user-friendly while server uses ISO timestamps

---

## 3) Repo Hygiene (Done in this pass)

Goal: keep commits reviewable and avoid accidental noise.

### Completed now
- [x] Expanded `.gitignore` to exclude local assistant/workspace artifacts and temp exports.

### Follow-up
- [ ] Optionally move scratch analysis files into a dedicated `scratch/` folder (ignored)
- [ ] Keep production-relevant docs/code tracked; keep generated data untracked

---

## Suggested order for tomorrow
1. Admin smoke checks + fix regressions
2. Invite lifecycle scenario testing + fixes
3. Final cleanup + deploy candidate branch cut
