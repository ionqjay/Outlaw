-- Apply after launch_security_and_operations. Existing accounts/quotes are preserved.
-- Existing approvals deliberately do NOT become registered-shop approvals.
begin;
alter table public.provider_verifications add column if not exists business_type text;
alter table public.provider_verifications add column if not exists registration_reference text;
alter table public.provider_verifications add column if not exists business_address text;
alter table public.provider_verifications add column if not exists reviewed_at timestamptz;
alter table public.signups drop constraint if exists signups_type_check;
alter table public.signups add constraint signups_type_check check (type in ('owner','mechanic','shop'));
-- Preserve old clients' records, but close the old service-role write entrypoint.
revoke execute on function public.create_marketplace_bid(jsonb) from service_role;
create or replace function public.create_shop_bid(p_bid jsonb)
returns setof public.bids language plpgsql security invoker set search_path = '' as $$
declare r public.repair_requests;
begin
  select * into r from public.repair_requests where id=(p_bid->>'request_id')::bigint for update;
  if not found or r.status<>'open' or r.created_at<now()-interval '24 hours' then raise exception 'Request closed'; end if;
  -- Service-role possession is not shop eligibility: recheck the actual records.
  if not exists(select 1 from public.provider_verifications v join public.billing_accounts b on b.user_id=v.user_id
    where v.user_id=p_bid->>'mechanic_id' and v.status='approved' and v.business_type='registered_shop'
    and b.subscription_status='active' and nullif(b.stripe_subscription_id,'') is not null
    and b.current_period_end>now() and b.manual_access_override is distinct from 'disabled') then raise exception 'Shop not eligible'; end if;
  if not exists(select 1 from public.request_invites i join auth.users u on lower(u.email)=i.provider_email
    where u.id::text=p_bid->>'mechanic_id' and i.repair_id=r.id and i.provider_type='shop'
    and i.status='pending' and i.expires_at>now()) then raise exception 'Valid shop invitation required'; end if;
  if exists(select 1 from public.banned_accounts ba join auth.users u on lower(u.email)=ba.email
    where u.id::text=p_bid->>'mechanic_id' and ba.active) then raise exception 'Account restricted'; end if;
  if (p_bid->>'amount')::numeric<=0 or (p_bid->>'amount')::numeric>100000 or (p_bid->>'eta_hours')::integer not between 1 and 8760 then raise exception 'Invalid estimate'; end if;
  if exists(select 1 from public.bids where request_id=r.id and mechanic_id=p_bid->>'mechanic_id') then raise exception 'Duplicate estimate'; end if;
  -- Count ALL historical quotes, not just open or metadata-tagged quotes.
  if (select count(*) from public.bids where request_id=r.id)>=3 then raise exception 'Three estimate limit reached'; end if;
  return query insert into public.bids(request_id,mechanic_id,mechanic_name,amount,eta_hours,notes,status)
    values(r.id,p_bid->>'mechanic_id',(select business_name from public.provider_verifications where user_id=p_bid->>'mechanic_id'),
    (p_bid->>'amount')::numeric,(p_bid->>'eta_hours')::integer,p_bid->>'notes','open') returning *;
end $$;
revoke all on function public.create_shop_bid(jsonb) from public,anon,authenticated;
grant execute on function public.create_shop_bid(jsonb) to service_role;
commit;
