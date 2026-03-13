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

-- service-role backend only for now; enable RLS later once auth is fully live
alter table public.signups disable row level security;
alter table public.owner_requests disable row level security;
alter table public.repair_requests disable row level security;
alter table public.bids disable row level security;
alter table public.feedbacks disable row level security;
