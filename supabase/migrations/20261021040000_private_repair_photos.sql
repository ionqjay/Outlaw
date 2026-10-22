begin;
create table if not exists public.repair_photos (
 id uuid primary key,
 repair_id bigint not null references public.repair_requests(id) on delete restrict,
 object_key text not null unique,
 state text not null default 'pending' check(state in ('pending','ready','deleting')),
 created_at timestamptz not null default now()
);
create index if not exists repair_photos_repair on public.repair_photos(repair_id);
alter table public.repair_photos enable row level security;
revoke all on public.repair_photos from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.repair_photos to service_role;
create or replace function public.reserve_repair_photo(p_repair_id bigint,p_owner_id text,p_id uuid)
returns setof public.repair_photos language plpgsql security invoker set search_path='' as $$
declare r public.repair_requests;
begin
 select * into r from public.repair_requests where id=p_repair_id for update;
 if not found or r.owner_id<>p_owner_id then raise exception 'Not authorized'; end if;
 if (select count(*) from public.repair_photos where repair_id=p_repair_id)>=5 then raise exception 'Photo limit reached'; end if;
 return query insert into public.repair_photos(id,repair_id,object_key) values(p_id,p_repair_id,p_id::text||'.jpg') returning *;
end $$;
revoke all on function public.reserve_repair_photo(bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_repair_photo(bigint,text,uuid) to service_role;
commit;
-- Storage bucket provision is a separate approved infrastructure step, NOT executed here.
-- Set REPAIR_PHOTO_BUCKET to a dedicated PRIVATE bucket with no client object policies.
