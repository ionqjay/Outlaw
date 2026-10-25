begin;
alter table public.repair_requests add column if not exists workflow_revision integer not null default 0;
alter table public.repair_requests add column if not exists completion_requested_at timestamptz;
create table if not exists public.repair_transition_events (
 id bigint generated always as identity primary key,
 repair_id bigint not null references public.repair_requests(id) on delete restrict,
 actor_id text not null,action text not null,from_status text not null,to_status text not null,
 created_at timestamptz not null default now()
);
alter table public.repair_transition_events enable row level security;
revoke all on public.repair_transition_events from public,anon,authenticated,service_role;
revoke all on sequence public.repair_transition_events_id_seq from public,anon,authenticated,service_role;
grant select,insert on public.repair_transition_events to service_role;
grant usage,select on sequence public.repair_transition_events_id_seq to service_role;
create or replace function public.transition_repair(p_repair_id bigint,p_actor_id text,p_action text,p_admin boolean default false,p_expected_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.repair_requests; target_status text; requested timestamptz;
begin
 if p_actor_id is null or btrim(p_actor_id)='' or p_admin is null then raise exception 'Unauthorized'; end if;
 select * into r from public.repair_requests where id=p_repair_id for update;
 if not found then raise exception 'Repair not found'; end if;
 if p_action in ('complete','cancel','continue-work') then
  if r.owner_id<>p_actor_id and not p_admin then raise exception 'Unauthorized'; end if;
 elsif p_action in ('start-work','request-completion') then
  if not exists(select 1 from public.bids where request_id=r.id and mechanic_id=p_actor_id and status='accepted') then raise exception 'Unauthorized'; end if;
 else raise exception 'Invalid action'; end if;
 if p_action in ('start-work','request-completion','continue-work') and (p_expected_revision is null or p_expected_revision<>r.workflow_revision) then raise exception 'Stale workflow revision'; end if;
 if p_expected_revision is not null and p_expected_revision<>r.workflow_revision then raise exception 'Stale workflow revision'; end if;
 target_status=r.status; requested=r.completion_requested_at;
 if p_action='start-work' then
  if r.status='in_progress' then return jsonb_build_object('ok',true,'changed',false); end if;
  if r.status<>'accepted' then raise exception 'Invalid transition'; end if;
  target_status='in_progress';
 elsif p_action='request-completion' then
  if r.status<>'in_progress' then raise exception 'Invalid transition'; end if;
  if requested is not null then return jsonb_build_object('ok',true,'changed',false); end if;
  requested=now();
 elsif p_action='continue-work' then
  if r.status<>'in_progress' then raise exception 'Invalid transition'; end if;
  if requested is null then return jsonb_build_object('ok',true,'changed',false); end if;
  requested=null;
 elsif p_action='complete' then
  if r.status='completed' then return jsonb_build_object('ok',true,'changed',false); end if;
  if r.status not in ('accepted','in_progress') then raise exception 'Invalid transition'; end if;
  target_status='completed';
 elsif p_action='cancel' then
  if r.status='cancelled' then return jsonb_build_object('ok',true,'changed',false); end if;
  if r.status<>'open' then raise exception 'Invalid transition'; end if;
  target_status='cancelled';
 end if;
 update public.repair_requests set status=target_status,completion_requested_at=requested,workflow_revision=workflow_revision+1 where id=r.id;
 if p_action='cancel' then update public.bids set status='declined' where request_id=r.id and status='open'; end if;
 insert into public.repair_transition_events(repair_id,actor_id,action,from_status,to_status) values(r.id,p_actor_id,p_action,r.status,target_status);
 return jsonb_build_object('ok',true,'changed',true);
end $$;
revoke all on function public.transition_repair(bigint,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.transition_repair(bigint,text,text,boolean,integer) to service_role;
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
  insert into public.repair_transition_events(repair_id,actor_id,action,from_status,to_status) values(r.id,case when p_admin then 'admin-token' else p_owner_id end,'accept','open','accepted');
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.accept_marketplace_bid(bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.accept_marketplace_bid(bigint,text,boolean) to service_role;


commit;
