-- ShopMyRepair core schema (MVP)

create extension if not exists pgcrypto;

create table if not exists public.signups (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  phone text not null,
  zip text not null,
  repair_address text,
  borough text not null,
  type text not null check (type in ('owner','mechanic')),
  experience text,
  has_shop text,
  hero_variant text,
  utm jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_signups_email on public.signups (email);
create index if not exists idx_signups_type on public.signups (type);
create index if not exists idx_signups_created_at on public.signups (created_at desc);

create table if not exists public.owner_requests (
  id bigint generated always as identity primary key,
  full_name text not null,
  email text not null,
  mobile text not null,
  vehicle_year text not null,
  vehicle_make text not null,
  vehicle_model text not null,
  issue_category text not null,
  issue_details text not null,
  service_address text not null,
  city text not null,
  state text not null,
  zip text not null,
  urgency text not null default 'Standard',
  created_at timestamptz not null default now()
);

create index if not exists idx_owner_requests_email on public.owner_requests (email);
create index if not exists idx_owner_requests_created_at on public.owner_requests (created_at desc);

-- service-role backend only for now; enable RLS later once auth is live
create table if not exists public.repair_requests (
  id bigint generated always as identity primary key,
  owner_id text not null,
  title text not null,
  issue_category text not null,
  issue_details text not null,
  vehicle_year text not null,
  vehicle_make text not null,
  vehicle_model text not null,
  city text not null,
  state text not null,
  zip text not null,
  urgency text not null default 'Standard',
  status text not null default 'open' check (status in ('open','accepted','in_progress','completed','cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_repair_requests_owner on public.repair_requests(owner_id);
create index if not exists idx_repair_requests_status on public.repair_requests(status);
create index if not exists idx_repair_requests_created_at on public.repair_requests(created_at desc);

create table if not exists public.bids (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.repair_requests(id) on delete cascade,
  mechanic_id text not null,
  mechanic_name text not null,
  amount numeric(10,2) not null,
  eta_hours int not null,
  notes text,
  status text not null default 'open' check (status in ('open','accepted','declined')),
  created_at timestamptz not null default now()
);

create index if not exists idx_bids_request_id on public.bids(request_id);
create index if not exists idx_bids_mechanic_id on public.bids(mechanic_id);
create index if not exists idx_bids_status on public.bids(status);

create table if not exists public.feedbacks (
  id bigint generated always as identity primary key,
  request_id bigint not null,
  bid_id bigint not null,
  mechanic_id text not null,
  owner_id text,
  rating int not null check (rating between 1 and 5),
  text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(request_id)
);

create index if not exists idx_feedbacks_mechanic_id on public.feedbacks(mechanic_id);
create index if not exists idx_feedbacks_request_id on public.feedbacks(request_id);

create table if not exists public.billing_accounts (
  id bigint generated always as identity primary key,
  user_id text not null unique,
  email text,
  role text,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  subscription_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  manual_access_override text check (manual_access_override in ('active','disabled') or manual_access_override is null),
  manual_access_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_accounts_subscription_status on public.billing_accounts(subscription_status);

create table if not exists public.request_invites (
  id bigint generated always as identity primary key,
  repair_id bigint not null references public.repair_requests(id) on delete cascade,
  provider_email text not null,
  provider_type text not null check (provider_type in ('mechanic','shop')),
  status text not null default 'pending' check (status in ('pending','submitted','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  expired_at timestamptz,
  replaced_from text,
  escalation_wave int,
  auto_backfill boolean default false
);

create index if not exists idx_request_invites_repair_id on public.request_invites(repair_id);
create index if not exists idx_request_invites_provider on public.request_invites(provider_email, provider_type);
create index if not exists idx_request_invites_status on public.request_invites(status);
create unique index if not exists idx_request_invites_unique_provider
  on public.request_invites(repair_id, provider_email, provider_type);

-- Production installs should apply 002_enable_rls.sql immediately after this baseline.
alter table public.signups enable row level security;
alter table public.owner_requests enable row level security;
alter table public.repair_requests enable row level security;
alter table public.bids enable row level security;
alter table public.feedbacks enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.request_invites enable row level security;

-- All marketplace access goes through the authenticated API. Clients use
-- Supabase Auth, but cannot bypass billing/invite checks through the Data API.
do $$
declare p record; t text;
begin
  for p in select tablename,policyname from pg_policies where schemaname='public'
    and tablename in ('signups','owner_requests','repair_requests','bids','feedbacks','billing_accounts','request_invites') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
  foreach t in array array['signups','owner_requests','repair_requests','bids','feedbacks','billing_accounts','request_invites'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
create or replace function public.is_admin() returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt()->'app_metadata'->>'role','') = 'admin';
$$;

alter table public.billing_accounts
  add column if not exists stripe_checkout_session_id text,
  add column if not exists manual_access_override text,
  add column if not exists manual_access_reason text;
alter table public.repair_requests add column if not exists client_request_id text;
create unique index if not exists repair_owner_client_id on public.repair_requests(owner_id,client_request_id)
  where client_request_id is not null;

create table if not exists public.banned_accounts (
  email text primary key, active boolean not null default true, reason text, category text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  event_key text not null unique, user_id text not null, title text not null, body text not null,
  href text not null, read_at timestamptz, created_at timestamptz default now()
);
create index if not exists notifications_user_time on public.notifications(user_id,created_at desc);
create table if not exists public.opportunity_events (
  id bigint generated always as identity primary key,
  repair_id bigint not null, provider_email text not null, created_at timestamptz not null default now(),
  unique(repair_id,provider_email)
);
create table if not exists public.refund_requests (
  id bigint generated always as identity primary key, user_id text not null,
  invoice_id text not null unique, amount_paid bigint not null, currency text not null,
  period_start timestamptz not null, period_end timestamptz not null,
  opportunity_count integer not null, status text not null default 'pending'
    check (status in ('pending','approved','rejected','refunded')),
  review_note text, stripe_refund_id text, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists public.provider_verifications (
  user_id text primary key, status text not null default 'pending' check (status in ('pending','approved','rejected')),
  business_name text not null, license_reference text not null, insurance_reference text not null,
  review_note text, created_at timestamptz default now(), updated_at timestamptz default now()
);
do $$
declare t text;
begin
  foreach t in array array['banned_accounts','notifications','opportunity_events','refund_requests','provider_verifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;

-- Lock the repair row so two accepted quotes cannot race each other.
create or replace function public.accept_marketplace_bid(p_bid_id bigint, p_owner_id text, p_admin boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.bids; r public.repair_requests;
begin
  select * into b from public.bids where id=p_bid_id;
  if not found then raise exception 'Estimate not found'; end if;
  select * into r from public.repair_requests where id=b.request_id for update;
  if not p_admin and r.owner_id<>p_owner_id then raise exception 'Unauthorized'; end if;
  if r.status='accepted' and exists(select 1 from public.bids where id=p_bid_id and status='accepted') then return jsonb_build_object('ok',true); end if;
  if r.status<>'open' then raise exception 'Request is no longer open'; end if;
  update public.bids set status=case when id=p_bid_id then 'accepted' else 'declined' end where request_id=b.request_id;
  update public.repair_requests set status='accepted' where id=r.id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.accept_marketplace_bid(bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.accept_marketplace_bid(bigint,text,boolean) to service_role;

create or replace function public.create_marketplace_bid(p_bid jsonb)
returns setof public.bids language plpgsql security invoker set search_path = '' as $$
declare r public.repair_requests;
begin
  select * into r from public.repair_requests where id=(p_bid->>'request_id')::bigint for update;
  if not found or r.status<>'open' or r.created_at<now()-interval '24 hours' then raise exception 'Request is closed'; end if;
  if (p_bid->>'amount')::numeric<=0 or (p_bid->>'eta_hours')::integer<=0 then raise exception 'Invalid amount or availability'; end if;
  if exists(select 1 from public.bids where request_id=r.id and mechanic_id=p_bid->>'mechanic_id' and status<>'declined') then raise exception 'Estimate already submitted'; end if;
  if (select count(*) from public.bids where request_id=r.id and status='open') >=5 then raise exception 'Estimate limit reached'; end if;
  return query insert into public.bids(request_id,mechanic_id,mechanic_name,amount,eta_hours,notes,status)
    values(r.id,p_bid->>'mechanic_id',p_bid->>'mechanic_name',(p_bid->>'amount')::numeric,(p_bid->>'eta_hours')::integer,p_bid->>'notes','open') returning *;
end $$;
revoke all on function public.create_marketplace_bid(jsonb) from public,anon,authenticated;
grant execute on function public.create_marketplace_bid(jsonb) to service_role;
