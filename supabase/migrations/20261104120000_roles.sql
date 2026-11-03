-- Roles: who sees and changes what.
--
--   admin    everything.
--   manager  runs the school: students, groups, lessons, teachers, days off and
--            families' payments, but never the finance records (taxes, the tax
--            plan, the bank checks) and can't delete students or groups for good.
--   teacher  only her own lessons and the students in them, without any money;
--            marks lessons as done and fills in topics, homework, grades and notes.
--
-- Admins and managers are listed in `members`. A teacher is let in by her teacher
-- card instead (a record of type 'teachers' with her Gmail), so whoever manages
-- the teachers also manages their access. Lessons, students, groups and days off
-- carry the teacher's id in `teacherId`; records without one belong to the teacher
-- 'main', the one who kept the records before there were several teachers.

-- No push may slip in between: revisions must stay in order.
select pg_advisory_xact_lock(hashtext('uroky.push_records'));

/* ---------- members: admins and managers ---------- */

delete from public.members where role not in ('admin', 'manager');
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('admin', 'manager'));

/* ---------- who the signed-in user is ---------- */

-- Teacher cards with the signed-in e-mail that still work (not archived, not deleted).
create function public.my_teacher_ids() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(r.id), '{}')
  from public.records r
  where r.type = 'teachers'
    and not r.deleted
    and coalesce(r.data ->> 'status', 'active') = 'active'
    and coalesce(auth.jwt() ->> 'email', '') <> ''
    and lower(r.data ->> 'email') = lower(auth.jwt() ->> 'email')
$$;

-- 'admin' or 'manager' from the members list, otherwise 'teacher' for a working teacher card, otherwise null.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.role from public.members m where m.email = lower(auth.jwt() ->> 'email')),
    (select 'teacher' where cardinality(public.my_teacher_ids()) > 0)
  )
$$;

/* ---------- reading ---------- */

-- What a manager may read. The finance records (taxes, taxPlans, bankMonths) stay with the admin.
create function public.manager_types() returns text[]
language sql immutable set search_path = '' as $$
  select array['students', 'groups', 'lessons', 'payments', 'daysOff', 'teachers']
$$;

drop policy "the admin reads everything" on public.records;
create policy "the admin reads everything, a manager the school without finance" on public.records
  for select to authenticated
  using (
    (select public.my_role()) = 'admin'
    or ((select public.my_role()) = 'manager' and type = any (public.manager_types()))
  );

-- A teacher never reads the table. teacher_pull() hands her copies with the money taken out.

/* ---------- writing: admins and managers ---------- */

create or replace function public.push_records(records jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who text;
  kind text;
  list jsonb;
  rec jsonb;
  accepted int := 0;
begin
  -- One push at a time, so revisions become visible in order and a pull never skips one.
  perform pg_advisory_xact_lock(hashtext('uroky.push_records'));
  who := public.my_role();
  if who is null or who not in ('admin', 'manager') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for kind, list in select key, value from jsonb_each(records) loop
    continue when kind !~ '^[a-z][A-Za-z0-9]{1,39}$' or jsonb_typeof(list) <> 'array';
    if who = 'manager' and not (kind = any (public.manager_types())) then
      raise exception 'Менеджер не може змінювати записи «%»', kind using errcode = '42501';
    end if;
    for rec in select value from jsonb_array_elements(list) loop
      continue when jsonb_typeof(rec) <> 'object'
        or coalesce(rec ->> 'id', '') = ''
        or coalesce(jsonb_typeof(rec -> 'updatedAt'), '') <> 'number';
      -- A manager moves students and groups to the archive; deleting them for good is the admin's.
      if who = 'manager' and kind in ('students', 'groups') and jsonb_typeof(rec -> 'deletedAt') = 'number'
         and exists (select 1 from public.records r where r.type = kind and r.id = rec ->> 'id' and not r.deleted) then
        raise exception 'Видаляти учнів і групи може лише адміністратор' using errcode = '42501';
      end if;
      insert into public.records as r (type, id, data, updated_at, deleted)
      values (kind, rec ->> 'id', rec, (rec ->> 'updatedAt')::numeric::bigint, coalesce(jsonb_typeof(rec -> 'deletedAt') = 'number', false))
      on conflict (type, id) do update
        set data = excluded.data,
            updated_at = excluded.updated_at,
            deleted = excluded.deleted,
            rev = nextval('public.records_rev')
        where r.updated_at < excluded.updated_at;
      if found then
        accepted := accepted + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('accepted', accepted);
end $$;

/* ---------- teachers ---------- */

-- Copies without money: the price of every participant is 0 and a late cancellation never shows as paid.
create function public.teacher_lesson(data jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select (data - 'participants' - 'cancel')
    || jsonb_build_object('participants', coalesce((
         select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'studentId', p ->> 'studentId', 'price', 0, 'grade', p -> 'grade', 'absent', p -> 'absent')) order by n)
         from jsonb_array_elements(case when jsonb_typeof(data -> 'participants') = 'array' then data -> 'participants' else '[]' end)
           with ordinality as x(p, n)), '[]'::jsonb))
    || case when jsonb_typeof(data -> 'cancel') = 'object'
         then jsonb_build_object('cancel', (data -> 'cancel') || '{"charged": false}'::jsonb)
         else '{}'::jsonb end
$$;

create function public.teacher_student(data jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select (data - 'price' - 'billing' - 'schedule') || jsonb_build_object('price', 0, 'billing', 'after', 'schedule', '[]'::jsonb)
$$;

create function public.teacher_group(data jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select (data - 'price' - 'schedule') || jsonb_build_object('price', 0, 'schedule', '[]'::jsonb)
$$;

-- Everything a teacher sees that changed after revision `since`:
-- her lessons, the students and groups in them, her own card and her days off.
-- `gone` lists lessons that changed but are no longer hers (given to another teacher),
-- so her device can drop them.
create function public.teacher_pull(since bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  mine text[];
  top bigint;
  result jsonb;
begin
  if public.my_role() is distinct from 'teacher' then
    raise exception 'Лише для вчительок' using errcode = '42501';
  end if;
  mine := public.my_teacher_ids();
  select coalesce(max(r.rev), 0) into top from public.records r;

  with lessons as (
    select r.id, r.data, r.rev from public.records r
    where r.type = 'lessons' and coalesce(r.data ->> 'teacherId', 'main') = any (mine)
  ),
  -- students and groups she may see: in her lessons or given to her
  student_ids as (
    select p ->> 'studentId' as id, max(l.rev) as rev
    from lessons l, jsonb_array_elements(case when jsonb_typeof(l.data -> 'participants') = 'array' then l.data -> 'participants' else '[]' end) p
    group by 1
  ),
  group_ids as (
    select l.data ->> 'groupId' as id, max(l.rev) as rev from lessons l where l.data ? 'groupId' group by 1
  ),
  students as (
    select r.data from public.records r
    left join student_ids s on s.id = r.id
    where r.type = 'students'
      and (s.id is not null or coalesce(r.data ->> 'teacherId', 'main') = any (mine))
      -- changed since, or just became hers through a new lesson
      and (r.rev > since or s.rev > since)
  ),
  groups as (
    select r.data from public.records r
    left join group_ids g on g.id = r.id
    where r.type = 'groups'
      and (g.id is not null or coalesce(r.data ->> 'teacherId', 'main') = any (mine))
      and (r.rev > since or g.rev > since)
  )
  select jsonb_build_object(
    'rev', top,
    'records', jsonb_build_object(
      'lessons', coalesce((select jsonb_agg(public.teacher_lesson(l.data)) from lessons l where l.rev > since), '[]'),
      'students', coalesce((select jsonb_agg(public.teacher_student(s.data)) from students s), '[]'),
      'groups', coalesce((select jsonb_agg(public.teacher_group(g.data)) from groups g), '[]'),
      'teachers', coalesce((select jsonb_agg(r.data) from public.records r where r.type = 'teachers' and r.id = any (mine) and r.rev > since), '[]'),
      'daysOff', coalesce((select jsonb_agg(r.data) from public.records r
                           where r.type = 'daysOff' and r.rev > since
                             and (coalesce(r.data ->> 'teacherId', 'main') = any (mine) or r.data ->> 'teacherId' = '*')), '[]')
    ),
    'gone', jsonb_build_object(
      'lessons', case when since = 0 then '[]'::jsonb else coalesce((
        select jsonb_agg(r.id) from public.records r
        where r.type = 'lessons' and r.rev > since and not (coalesce(r.data ->> 'teacherId', 'main') = any (mine))), '[]') end
    )
  ) into result;
  return result;
end $$;

-- What a teacher may change in her own lessons: done or not, topic, homework, note,
-- the trial report, and each participant's grade and absence. Moving, cancelling,
-- prices and everything else stay with the admin and the manager. A change older
-- than the lesson on the server is ignored, like any other edit that lost.
create function public.teacher_push(records jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  mine text[];
  rec jsonb;
  cur jsonb;
  cur_at bigint;
  d jsonb;
  t bigint;
  k text;
  accepted int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('uroky.push_records'));
  if public.my_role() is distinct from 'teacher' then
    raise exception 'Лише для вчительок' using errcode = '42501';
  end if;
  mine := public.my_teacher_ids();
  for rec in select value from jsonb_array_elements(case when jsonb_typeof(records -> 'lessons') = 'array' then records -> 'lessons' else '[]' end) loop
    continue when jsonb_typeof(rec) <> 'object'
      or coalesce(rec ->> 'id', '') = ''
      or coalesce(jsonb_typeof(rec -> 'updatedAt'), '') <> 'number';
    select r.data, r.updated_at into cur, cur_at
    from public.records r where r.type = 'lessons' and r.id = rec ->> 'id' and not r.deleted;
    -- not hers (any more), deleted, or the server already has a newer change
    continue when cur is null
      or not (coalesce(cur ->> 'teacherId', 'main') = any (mine))
      or (rec ->> 'updatedAt')::numeric::bigint <= cur_at;

    d := cur;
    if rec ->> 'status' in ('planned', 'done') and d ->> 'status' in ('planned', 'done') then
      d := d || jsonb_build_object('status', rec ->> 'status');
    end if;
    foreach k in array array['topic', 'homework', 'note'] loop
      if jsonb_typeof(rec -> k) = 'string' then
        d := d || jsonb_build_object(k, left(rec ->> k, 4000));
      end if;
    end loop;
    if d ->> 'kind' = 'trial' and jsonb_typeof(rec -> 'trial') = 'object' then
      d := d || jsonb_build_object('trial', jsonb_strip_nulls(jsonb_build_object(
        'level', left(coalesce(rec -> 'trial' ->> 'level', ''), 200),
        'strengths', left(coalesce(rec -> 'trial' ->> 'strengths', ''), 4000),
        'weaknesses', left(coalesce(rec -> 'trial' ->> 'weaknesses', ''), 4000),
        'plan', left(coalesce(rec -> 'trial' ->> 'plan', ''), 4000),
        'outcome', case when rec -> 'trial' ->> 'outcome' in ('continue', 'thinking', 'declined') then rec -> 'trial' ->> 'outcome' end)));
    end if;
    if jsonb_typeof(rec -> 'participants') = 'array' and jsonb_typeof(d -> 'participants') = 'array' then
      d := d || jsonb_build_object('participants', (
        select coalesce(jsonb_agg(
          case when q.np is null then p
               else (p - 'grade' - 'absent') || jsonb_strip_nulls(jsonb_build_object(
                 'grade', case when jsonb_typeof(q.np -> 'grade') = 'number' and (q.np ->> 'grade')::numeric between 1 and 5
                               then to_jsonb(round((q.np ->> 'grade')::numeric)) end,
                 'absent', case when q.np -> 'absent' = 'true'::jsonb then 'true'::jsonb end))
          end order by x.n), '[]'::jsonb)
        from jsonb_array_elements(d -> 'participants') with ordinality as x(p, n)
        left join lateral (
          select e as np from jsonb_array_elements(rec -> 'participants') e where e ->> 'studentId' = x.p ->> 'studentId' limit 1
        ) q on true));
    end if;

    -- One past her own time, so her device takes the merged lesson back on the next pull.
    t := (rec ->> 'updatedAt')::numeric::bigint + 1;
    update public.records r
      set data = d || jsonb_build_object('updatedAt', t), updated_at = t, rev = nextval('public.records_rev')
      where r.type = 'lessons' and r.id = rec ->> 'id';
    accepted := accepted + 1;
  end loop;
  return jsonb_build_object('accepted', accepted);
end $$;

/* ---------- the members list: admins and managers ---------- */

create or replace function public.set_member(member_email text, member_role text, member_name text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(btrim(coalesce(member_email, '')));
begin
  perform pg_advisory_xact_lock(hashtext('uroky.members'));
  if public.my_role() is distinct from 'admin' then
    raise exception 'Немає прав керувати доступом' using errcode = '42501';
  end if;
  if addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Перевірте пошту: %', addr using errcode = '22023';
  end if;
  if member_role is null or member_role not in ('admin', 'manager') then
    raise exception 'Невідома роль' using errcode = '22023';
  end if;
  if addr = lower((select auth.jwt()) ->> 'email') and member_role <> 'admin' then
    raise exception 'Не можна зняти права адміністратора з себе — це може зробити інший адміністратор' using errcode = '42501';
  end if;
  insert into public.members as m (email, role, name)
  values (addr, member_role, left(btrim(coalesce(member_name, '')), 80))
  on conflict on constraint members_pkey do update
    set role = excluded.role, name = excluded.name;
end $$;

/* ---------- the teacher who kept the records so far ---------- */

-- Her name is set in the app (Учні → Вчительки); the timestamp 1 lets any real edit win.
insert into public.records (type, id, data, updated_at)
values ('teachers', 'main',
        '{"id": "main", "name": "Основна вчителька", "color": "violet", "email": "", "status": "active", "createdAt": 1, "updatedAt": 1}'::jsonb, 1)
on conflict (type, id) do nothing;

/* ---------- grants ---------- */

revoke execute on function public.my_teacher_ids(), public.manager_types(),
  public.teacher_lesson(jsonb), public.teacher_student(jsonb), public.teacher_group(jsonb),
  public.teacher_pull(bigint), public.teacher_push(jsonb) from public, anon;
grant execute on function public.teacher_pull(bigint), public.teacher_push(jsonb) to authenticated;
-- my_role() and the policy call these on behalf of the signed-in user.
grant execute on function public.my_teacher_ids(), public.manager_types() to authenticated;
