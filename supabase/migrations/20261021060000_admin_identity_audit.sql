begin;
create table if not exists public.admin_memberships (
 user_id uuid primary key references auth.users(id) on delete restrict,
 active boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.admin_audit_events (
 id bigint generated always as identity primary key,
 actor_id text not null,
 action text not null check(length(action) between 1 and 180),
 target_hash text not null check(target_hash ~ '^[a-f0-9]{64}$'),
 correlation_id uuid not null,
 outcome text not null check(outcome in ('attempt','success','failure')),
 decision text check(decision in ('approved','rejected','active','disabled','clear')),
 http_status integer,
 created_at timestamptz not null default now()
);
create index if not exists admin_audit_correlation on public.admin_audit_events(correlation_id,created_at);
alter table public.admin_memberships enable row level security;
alter table public.admin_audit_events enable row level security;
revoke all on public.admin_memberships,public.admin_audit_events from public,anon,authenticated,service_role;
revoke all on sequence public.admin_audit_events_id_seq from public,anon,authenticated,service_role;
grant select on public.admin_memberships to service_role;
grant select,insert on public.admin_audit_events to service_role;
grant usage,select on sequence public.admin_audit_events_id_seq to service_role;
-- Intentionally provisions NO users. Database owner must approve a verified Auth UUID separately.
create or replace function public.accept_marketplace_bid(p_bid_id bigint, p_owner_id text, p_admin boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.bids; r public.repair_requests;
begin
  select * into b from public.bids where id=p_bid_id;
  if not found then raise exception 'Estimate not found'; end if;
  select * into r from public.repair_requests where id=b.request_id for update;
  if p_admin is null or (not p_admin and (p_owner_id is null or r.owner_id<>p_owner_id)) then raise exception 'Unauthorized'; end if;
  if r.status='accepted' and exists(select 1 from public.bids where id=p_bid_id and status='accepted') then return jsonb_build_object('ok',true); end if;
  if r.status<>'open' then raise exception 'Request is no longer open'; end if;
  update public.bids set status=case when id=p_bid_id then 'accepted' else 'declined' end where request_id=b.request_id;
  update public.repair_requests set status='accepted' where id=r.id;
  insert into public.repair_transition_events(repair_id,actor_id,action,from_status,to_status) values(r.id,p_owner_id,'accept','open','accepted');
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.accept_marketplace_bid(bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.accept_marketplace_bid(bigint,text,boolean) to service_role;



commit;
