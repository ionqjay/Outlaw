-- ShopMyRepair MVP security hardening.
-- Run after supabase/schema.sql.

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
      or coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'admin';
$$;

alter table public.billing_accounts
  add column if not exists stripe_checkout_session_id text,
  add column if not exists manual_access_override text check (manual_access_override in ('active','disabled') or manual_access_override is null),
  add column if not exists manual_access_reason text;

alter table public.signups enable row level security;
alter table public.owner_requests enable row level security;
alter table public.repair_requests enable row level security;
alter table public.bids enable row level security;
alter table public.feedbacks enable row level security;
alter table public.billing_accounts enable row level security;

drop policy if exists "admins manage signups" on public.signups;
create policy "admins manage signups"
  on public.signups
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public can create launch signups" on public.signups;
create policy "public can create launch signups"
  on public.signups
  for insert
  with check (true);

drop policy if exists "admins manage owner requests" on public.owner_requests;
create policy "admins manage owner requests"
  on public.owner_requests
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "public can create legacy owner requests" on public.owner_requests;
create policy "public can create legacy owner requests"
  on public.owner_requests
  for insert
  with check (true);

drop policy if exists "owners manage own repair requests" on public.repair_requests;
create policy "owners manage own repair requests"
  on public.repair_requests
  for all
  using (owner_id = auth.uid()::text or public.is_admin())
  with check (owner_id = auth.uid()::text or public.is_admin());

drop policy if exists "providers read own bids" on public.bids;
create policy "providers read own bids"
  on public.bids
  for select
  using (mechanic_id = auth.uid()::text or public.is_admin());

drop policy if exists "owners read bids on own repairs" on public.bids;
create policy "owners read bids on own repairs"
  on public.bids
  for select
  using (
    public.is_admin()
    or exists (
      select 1
      from public.repair_requests rr
      where rr.id = bids.request_id
        and rr.owner_id = auth.uid()::text
    )
  );

drop policy if exists "providers manage own bids" on public.bids;
create policy "providers manage own bids"
  on public.bids
  for insert
  with check (
    mechanic_id = auth.uid()::text
    and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') in ('mechanic','shop')
  );

drop policy if exists "admins update bids" on public.bids;
create policy "admins update bids"
  on public.bids
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "owners and providers read relevant feedback" on public.feedbacks;
create policy "owners and providers read relevant feedback"
  on public.feedbacks
  for select
  using (
    public.is_admin()
    or mechanic_id = auth.uid()::text
    or exists (
      select 1
      from public.repair_requests rr
      where rr.id = feedbacks.request_id
        and rr.owner_id = auth.uid()::text
    )
  );

drop policy if exists "owners create feedback for own repairs" on public.feedbacks;
create policy "owners create feedback for own repairs"
  on public.feedbacks
  for insert
  with check (
    exists (
      select 1
      from public.repair_requests rr
      where rr.id = feedbacks.request_id
        and rr.owner_id = auth.uid()::text
        and rr.status = 'completed'
    )
  );

drop policy if exists "owners update feedback for own repairs" on public.feedbacks;
create policy "owners update feedback for own repairs"
  on public.feedbacks
  for update
  using (
    exists (
      select 1
      from public.repair_requests rr
      where rr.id = feedbacks.request_id
        and rr.owner_id = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1
      from public.repair_requests rr
      where rr.id = feedbacks.request_id
        and rr.owner_id = auth.uid()::text
    )
  );

drop policy if exists "users read own billing account" on public.billing_accounts;
create policy "users read own billing account"
  on public.billing_accounts
  for select
  using (user_id = auth.uid()::text or public.is_admin());

drop policy if exists "admins manage billing accounts" on public.billing_accounts;
create policy "admins manage billing accounts"
  on public.billing_accounts
  for all
  using (public.is_admin())
  with check (public.is_admin());
