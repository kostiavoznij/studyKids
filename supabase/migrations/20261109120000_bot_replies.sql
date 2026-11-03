-- Telegram bot, step 4: replies from families.
--
-- An admin or a manager connects their own Telegram to the bot as an inbox
-- (Налаштування → Telegram-бот → «Відповіді батьків»). Whatever a connected
-- family writes to the bot is passed on to every inbox, with who wrote and about
-- which student; replying to it in Telegram sends the answer back to that family.
-- bot_relay remembers which passed-on message belongs to which family.

alter table public.bot_messages drop constraint bot_messages_status_check;
alter table public.bot_messages add constraint bot_messages_status_check check (status in ('sent', 'blocked', 'failed', 'received'));

-- the link code of each person's inbox, by e-mail
create table public.bot_inbox_codes (
  email text primary key,
  code text not null unique check (code ~ '^[A-Za-z0-9]{16,64}$'),
  created_at timestamptz not null default now()
);

create table public.bot_inbox (
  chat_id bigint primary key,
  email text not null,
  name text not null default '',
  username text not null default '',
  linked_at timestamptz not null default now()
);

create table public.bot_relay (
  inbox_chat bigint not null,
  inbox_message bigint not null,
  family_chat bigint not null,
  created_at timestamptz not null default now(),
  primary key (inbox_chat, inbox_message)
);

alter table public.bot_inbox_codes enable row level security;
alter table public.bot_inbox enable row level security;
alter table public.bot_relay enable row level security;
revoke all on public.bot_inbox_codes, public.bot_inbox, public.bot_relay from anon, authenticated;

/* ---------- for the app: admins and managers ---------- */

-- The caller's own inbox link code; renew makes a new one.
create function public.bot_inbox_code(renew boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  result text;
begin
  perform public.bot_check();
  insert into public.bot_inbox_codes as c (email, code)
  values (me, replace(gen_random_uuid()::text, '-', ''))
  on conflict (email) do update
    set code = case when renew then excluded.code else c.code end,
        created_at = case when renew then now() else c.created_at end
  returning c.code into result;
  return result;
end $$;

create function public.bot_inbox_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.bot_check();
  return coalesce((
    select jsonb_agg(jsonb_build_object('chatId', i.chat_id, 'email', i.email, 'name', i.name, 'username', i.username, 'linkedAt', i.linked_at)
           order by i.linked_at)
    from public.bot_inbox i
  ), '[]'::jsonb);
end $$;

create function public.bot_inbox_unlink(chat bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.bot_check();
  delete from public.bot_inbox i where i.chat_id = chat;
end $$;

/* ---------- for the bot's webhook only ---------- */

-- «Почати» with an inbox code: this chat now receives the families' replies. Returns the e-mail, or null.
create function public.bot_link_inbox(p_code text, p_chat bigint, p_name text, p_username text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  who text;
begin
  select c.email into who from public.bot_inbox_codes c where c.code = p_code;
  if who is null then
    return null;
  end if;
  -- only while that person still has access
  if not exists (select 1 from public.members m where m.email = who and m.role in ('admin', 'manager')) then
    return null;
  end if;
  insert into public.bot_inbox as i (chat_id, email, name, username)
  values (p_chat, who, left(coalesce(p_name, ''), 120), left(coalesce(p_username, ''), 64))
  on conflict (chat_id) do update set email = excluded.email, name = excluded.name, username = excluded.username;
  return who;
end $$;

-- Who a chat is: the students it follows, whether it is an inbox, and where replies go.
create function public.bot_chat_info(p_chat bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'students', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.data ->> 'name') order by r.data ->> 'name')
      from public.bot_chats c join public.records r on r.type = 'students' and r.id = c.student_id and not r.deleted
      where c.chat_id = p_chat and not c.blocked
    ), '[]'::jsonb),
    'inbox', exists (
      select 1 from public.bot_inbox i join public.members m on m.email = i.email and m.role in ('admin', 'manager')
      where i.chat_id = p_chat
    ),
    'inboxEmail', (select i.email from public.bot_inbox i where i.chat_id = p_chat),
    'receivers', coalesce((
      select jsonb_agg(i.chat_id)
      from public.bot_inbox i join public.members m on m.email = i.email and m.role in ('admin', 'manager')
    ), '[]'::jsonb)
  )
$$;

create function public.bot_relay_put(entries jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
begin
  for e in select value from jsonb_array_elements(case when jsonb_typeof(entries) = 'array' then entries else '[]' end) loop
    insert into public.bot_relay (inbox_chat, inbox_message, family_chat)
    values ((e ->> 'inboxChat')::bigint, (e ->> 'inboxMessage')::bigint, (e ->> 'familyChat')::bigint)
    on conflict do nothing;
  end loop;
end $$;

create function public.bot_relay_get(p_inbox_chat bigint, p_message bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select r.family_chat from public.bot_relay r where r.inbox_chat = p_inbox_chat and r.inbox_message = p_message
$$;

-- /stop: the chat leaves every student and stops being an inbox. Returns how many it left.
create or replace function public.bot_stop(p_chat bigint) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  m integer;
begin
  delete from public.bot_chats c where c.chat_id = p_chat;
  get diagnostics n = row_count;
  delete from public.bot_inbox i where i.chat_id = p_chat;
  get diagnostics m = row_count;
  return n + m;
end $$;

-- What the server logs by itself: reminders, families' messages, answers from the inbox.
create or replace function public.bot_log_auto(entries jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
begin
  for e in select value from jsonb_array_elements(case when jsonb_typeof(entries) = 'array' then entries else '[]' end) loop
    insert into public.bot_messages (sent_by, kind, student_id, chat_id, text, status, error)
    values (left(coalesce(e ->> 'by', 'автоматично'), 120), left(coalesce(e ->> 'kind', 'reminder'), 20), coalesce(e ->> 'studentId', ''),
            (e ->> 'chatId')::bigint, left(coalesce(e ->> 'text', ''), 4096), e ->> 'status', left(coalesce(e ->> 'error', ''), 300));
    if e ->> 'status' = 'blocked' then
      update public.bot_chats set blocked = true where chat_id = (e ->> 'chatId')::bigint;
    end if;
  end loop;
end $$;

-- Who answered whom is kept a month.
select cron.schedule('uroky-bot-relay-cleanup', '27 3 * * *', $cmd$delete from public.bot_relay where created_at < now() - interval '30 days'$cmd$);

/* ---------- grants ---------- */

revoke execute on function
  public.bot_inbox_code(boolean), public.bot_inbox_list(), public.bot_inbox_unlink(bigint),
  public.bot_link_inbox(text, bigint, text, text), public.bot_chat_info(bigint),
  public.bot_relay_put(jsonb), public.bot_relay_get(bigint, bigint)
from public, anon, authenticated;
grant execute on function public.bot_inbox_code(boolean), public.bot_inbox_list(), public.bot_inbox_unlink(bigint) to authenticated;
grant execute on function public.bot_link_inbox(text, bigint, text, text), public.bot_chat_info(bigint),
  public.bot_relay_put(jsonb), public.bot_relay_get(bigint, bigint) to service_role;
