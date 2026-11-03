-- Telegram bot, step 3: reminders before lessons.
--
-- Every minute the database calls the function supabase/functions/remind, which
-- finds the reminders that are due (by the 'reminder' template: how long before,
-- or the evening before, and to whom) and sends them. Each reminder is claimed
-- here before it goes, so it goes once even if two runs overlap; its key holds
-- the lesson's start, so a moved lesson is reminded again at its new time.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.bot_reminders (
  lesson_id text not null,
  -- '60@2026-11-05T16:00', 'eve19:00@2026-11-05T16:00'
  slot text not null,
  chat_id bigint not null,
  sent_at timestamptz not null default now(),
  primary key (lesson_id, slot, chat_id)
);

alter table public.bot_reminders enable row level security;
revoke all on public.bot_reminders from anon, authenticated;

/* ---------- for the remind function only ---------- */

-- Claims reminders; returns only those that weren't claimed before.
create function public.bot_claim(entries jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  n integer;
  claimed jsonb := '[]'::jsonb;
begin
  for e in select value from jsonb_array_elements(case when jsonb_typeof(entries) = 'array' then entries else '[]' end) loop
    insert into public.bot_reminders (lesson_id, slot, chat_id)
    values (e ->> 'lessonId', e ->> 'slot', (e ->> 'chatId')::bigint)
    on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      claimed := claimed || jsonb_build_array(e);
    end if;
  end loop;
  return claimed;
end $$;

-- Logs what the server sent by itself.
create function public.bot_log_auto(entries jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
begin
  for e in select value from jsonb_array_elements(case when jsonb_typeof(entries) = 'array' then entries else '[]' end) loop
    insert into public.bot_messages (sent_by, kind, student_id, chat_id, text, status, error)
    values ('автоматично', 'reminder', coalesce(e ->> 'studentId', ''), (e ->> 'chatId')::bigint,
            left(coalesce(e ->> 'text', ''), 4096), e ->> 'status', left(coalesce(e ->> 'error', ''), 300));
    if e ->> 'status' = 'blocked' then
      update public.bot_chats set blocked = true where chat_id = (e ->> 'chatId')::bigint;
    end if;
  end loop;
end $$;

/* ---------- for the admin: the schedule ---------- */

-- Called by the bot function when the admin connects the bot: (re)starts the
-- minute-by-minute call of the remind function, and a daily clean-up.
create function public.bot_schedule(p_url text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Підключати бота може лише адміністратор' using errcode = '42501';
  end if;
  if p_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/remind$' or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'bad schedule' using errcode = '22023';
  end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname in ('uroky-bot-remind', 'uroky-bot-cleanup');
  perform cron.schedule('uroky-bot-remind', '* * * * *', format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('content-type', 'application/json', 'x-cron-key', %L), body := '{}'::jsonb, timeout_milliseconds := 30000)$cmd$,
    p_url, p_key));
  -- pg_cron keeps a line per run (1440 a day); reminders older than two months are no use either.
  perform cron.schedule('uroky-bot-cleanup', '17 3 * * *', $cmd$
    delete from cron.job_run_details where end_time < now() - interval '3 days';
    delete from public.bot_reminders where sent_at < now() - interval '60 days';
  $cmd$);
end $$;

-- Whether reminders are being checked, for Налаштування → Telegram-бот.
create function public.bot_cron_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.bot_check();
  return jsonb_build_object(
    'scheduled', exists (select 1 from cron.job j where j.jobname = 'uroky-bot-remind' and j.active),
    'lastRun', (select max(d.start_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'uroky-bot-remind'),
    'lastStatus', (select d.status from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                   where j.jobname = 'uroky-bot-remind' order by d.start_time desc limit 1)
  );
end $$;

/* ---------- grants ---------- */

revoke execute on function public.bot_claim(jsonb), public.bot_log_auto(jsonb), public.bot_schedule(text, text), public.bot_cron_status()
from public, anon, authenticated;
grant execute on function public.bot_claim(jsonb), public.bot_log_auto(jsonb) to service_role;
grant execute on function public.bot_schedule(text, text), public.bot_cron_status() to authenticated;
