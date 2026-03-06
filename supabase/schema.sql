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
alter table public.signups disable row level security;
alter table public.owner_requests disable row level security;
