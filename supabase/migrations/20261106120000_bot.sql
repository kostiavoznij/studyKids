-- Telegram bot, step 1: families connect to it.
--
-- A bot can't write to anyone first. So every student gets a personal link
-- t.me/<bot>?start=<code>; a parent (or an older student) opens it and presses
-- «Почати», and from then on that chat is linked to the student. Both parents
-- can join, and one parent can join for each of their children.
--
-- The tables stay closed to the app. Admins and managers read and change them
-- through the bot_* functions below; the bot's webhook
-- (supabase/functions/telegram) through the service-only ones at the end.

create table public.bot_invites (
  student_id text primary key,
  code text not null unique check (code ~ '^[A-Za-z0-9]{16,64}$'),
  created_at timestamptz not null default now()
);

create table public.bot_chats (
  student_id text not null,
  chat_id bigint not null,
  -- who joined, as Telegram shows them, so she can tell a parent from a stranger
  name text not null default '',
  username text not null default '',
  linked_at timestamptz not null default now(),
  -- the person blocked the bot: messages to them would only fail
  blocked boolean not null default false,
  primary key (student_id, chat_id)
);

create index bot_chats_chat on public.bot_chats (chat_id);

alter table public.bot_invites enable row level security;
alter table public.bot_chats enable row level security;
revoke all on public.bot_invites, public.bot_chats from anon, authenticated;

/* ---------- for the app: admins and managers ---------- */

create function public.bot_check() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.my_role() is null or public.my_role() not in ('admin', 'manager') then
    raise exception 'Немає прав керувати ботом' using errcode = '42501';
  end if;
end $$;

-- The code of the student's link. With renew a new one: the old link stops
-- working, the families already connected stay connected.
create function public.bot_invite(student text, renew boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  fresh text := replace(gen_random_uuid()::text, '-', '');
  result text;
begin
  perform public.bot_check();
  if not exists (select 1 from public.records r where r.type = 'students' and r.id = student and not r.deleted) then
    raise exception 'Цього учня ще немає на сервері — дочекайтеся синхронізації й спробуйте ще раз' using errcode = '22023';
  end if;
  insert into public.bot_invites as i (student_id, code)
  values (student, fresh)
  on conflict (student_id) do update
    set code = case when renew then excluded.code else i.code end,
        created_at = case when renew then now() else i.created_at end
  returning i.code into result;
  return result;
end $$;

-- Every connected chat, for the student cards.
create function public.bot_chats_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.bot_check();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'studentId', c.student_id,
             'chatId', c.chat_id,
             'name', c.name,
             'username', c.username,
             'linkedAt', c.linked_at,
             'blocked', c.blocked
           ) order by c.linked_at)
    from public.bot_chats c
  ), '[]'::jsonb);
end $$;

-- Disconnects one chat from one student (the chat stays with the other children it follows).
create function public.bot_unlink(student text, chat bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.bot_check();
  delete from public.bot_chats c where c.student_id = student and c.chat_id = chat;
end $$;

/* ---------- for the bot's webhook only ---------- */

-- Someone pressed «Почати» with a link code. Returns the student's name, or null
-- when the code is unknown (a renewed link) or the student was deleted.
create function public.bot_link(p_code text, p_chat bigint, p_name text, p_username text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  sid text;
  sname text;
begin
  select i.student_id into sid from public.bot_invites i where i.code = p_code;
  if sid is null then
    return null;
  end if;
  select r.data ->> 'name' into sname from public.records r where r.type = 'students' and r.id = sid and not r.deleted;
  if sname is null then
    return null;
  end if;
  insert into public.bot_chats as c (student_id, chat_id, name, username)
  values (sid, p_chat, left(coalesce(p_name, ''), 120), left(coalesce(p_username, ''), 64))
  on conflict (student_id, chat_id) do update
    set name = excluded.name, username = excluded.username, blocked = false;
  return sname;
end $$;

-- /stop: the chat leaves every student it followed. Returns how many it left.
create function public.bot_stop(p_chat bigint) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  delete from public.bot_chats c where c.chat_id = p_chat;
  get diagnostics n = row_count;
  return n;
end $$;

-- The person blocked the bot, or unblocked it.
create function public.bot_blocked(p_chat bigint, p_blocked boolean) returns void
language sql security definer set search_path = '' as $$
  update public.bot_chats set blocked = p_blocked where chat_id = p_chat;
$$;

/* ---------- grants ---------- */

revoke execute on function
  public.bot_check(),
  public.bot_invite(text, boolean),
  public.bot_chats_list(),
  public.bot_unlink(text, bigint),
  public.bot_link(text, bigint, text, text),
  public.bot_stop(bigint),
  public.bot_blocked(bigint, boolean)
from public, anon, authenticated;

grant execute on function public.bot_invite(text, boolean), public.bot_chats_list(), public.bot_unlink(text, bigint) to authenticated;
grant execute on function public.bot_link(text, bigint, text, text), public.bot_stop(bigint), public.bot_blocked(bigint, boolean) to service_role;
