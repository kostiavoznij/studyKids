-- A teacher can report that the student didn't come (`missed` on the lesson).
-- She can't cancel: the admin or the manager decides whether the lesson is
-- cancelled and whether it is paid for. Otherwise teacher_push() is unchanged:
-- done or not, topic, homework, note, the trial report, and each participant's
-- grade and absence.

create or replace function public.teacher_push(records jsonb) returns jsonb
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
    -- «The student didn't come»: only on a lesson still waiting for a decision; whether it is
    -- cancelled, and paid for, stays with the admin and the manager.
    if d ->> 'status' = 'planned' and rec -> 'missed' = 'true'::jsonb then
      d := d || '{"missed": true}'::jsonb;
    else
      d := d - 'missed';
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
