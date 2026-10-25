begin;
create table if not exists public.repair_messages (
 id bigint generated always as identity primary key,
 bid_id bigint not null references public.bids(id) on delete cascade,
 sender_id text not null,
 sender_role text not null check(sender_role in ('owner','provider')),
 body text not null check(length(btrim(body)) between 1 and 2000),
 client_message_id text not null check(client_message_id ~ '^[a-zA-Z0-9_-]{16,80}$'),
 created_at timestamptz not null default now(),
 unique(bid_id,sender_id,client_message_id)
);
create index if not exists repair_messages_thread_page on public.repair_messages(bid_id,id desc);
alter table public.repair_messages enable row level security;
revoke all on public.repair_messages from public,anon,authenticated,service_role;
revoke all on sequence public.repair_messages_id_seq from public,anon,authenticated,service_role;
grant select,insert on public.repair_messages to service_role;
grant usage,select on sequence public.repair_messages_id_seq to service_role;
commit;
