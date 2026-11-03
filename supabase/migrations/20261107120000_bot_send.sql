-- Telegram bot, step 2: messages to families.
--
-- The app writes each family's text (from the templates, records of type
-- botTemplates) and hands them to the bot function, which sends them to the
-- chats connected to the student and logs every attempt here. Both the
-- lookup and the log run with the sender's own sign-in, so only admins and
-- managers can send, and the log says who sent what.

-- Managers send cancellations too, so they read and edit the templates.
create or replace function public.manager_types() returns text[]
language sql immutable set search_path = '' as $$
  select array['students', 'groups', 'lessons', 'payments', 'daysOff', 'teachers', 'botTemplates']
$$;

create table public.bot_messages (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- who sent it from the app
  sent_by text not null default '',
  -- 'cancel', 'cancelMany', 'free', later 'reminder'
  kind text not null,
  student_id text not null,
  chat_id bigint not null,
  text text not null,
  -- 'sent'; 'blocked' — the person blocked the bot; 'failed' — anything else
  status text not null check (status in ('sent', 'blocked', 'failed')),
  error text not null default ''
);

create index bot_messages_student on public.bot_messages (student_id, created_at desc);

alter table public.bot_messages enable row level security;
revoke all on public.bot_messages from anon, authenticated;

-- The chats that can receive messages about these students.
create function public.bot_targets(students text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.bot_check();
  return coalesce((
    select jsonb_agg(jsonb_build_object('studentId', c.student_id, 'chatId', c.chat_id))
    from public.bot_chats c
    where c.student_id = any (students) and not c.blocked
  ), '[]'::jsonb);
end $$;

-- Logs what the bot function sent; a chat that turned out blocked stops getting messages.
create function public.bot_log(entries jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  e jsonb;
begin
  perform public.bot_check();
  for e in select value from jsonb_array_elements(case when jsonb_typeof(entries) = 'array' then entries else '[]' end) loop
    insert into public.bot_messages (sent_by, kind, student_id, chat_id, text, status, error)
    values (
      who,
      left(coalesce(e ->> 'kind', ''), 20),
      coalesce(e ->> 'studentId', ''),
      (e ->> 'chatId')::bigint,
      left(coalesce(e ->> 'text', ''), 4096),
      e ->> 'status',
      left(coalesce(e ->> 'error', ''), 300)
    );
    if e ->> 'status' = 'blocked' then
      update public.bot_chats set blocked = true where chat_id = (e ->> 'chatId')::bigint;
    end if;
  end loop;
end $$;

-- The latest messages about one student, for the student card.
create function public.bot_history(student text, max_rows integer default 10) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.bot_check();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'at', m.created_at,
             'kind', m.kind,
             'chatId', m.chat_id,
             'text', m.text,
             'status', m.status,
             'error', m.error,
             'sentBy', m.sent_by
           ) order by m.created_at desc)
    from (
      select * from public.bot_messages
      where student_id = student
      order by created_at desc
      limit least(greatest(coalesce(max_rows, 10), 1), 50)
    ) m
  ), '[]'::jsonb);
end $$;

revoke execute on function public.bot_targets(text[]), public.bot_log(jsonb), public.bot_history(text, integer) from public, anon, authenticated;
grant execute on function public.bot_targets(text[]), public.bot_log(jsonb), public.bot_history(text, integer) to authenticated;
