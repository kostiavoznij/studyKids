-- «Уроки»: who may use the app and the records it keeps.
--
-- Every record of the app (a student, lesson, payment, tax…) is one row: its
-- type, id and the whole record as JSON, the same shape the app keeps on the
-- device. Syncing stays what it was with the Google Sheet: devices push the
-- records they changed and pull everything newer than the last revision seen.

-- Who may use the app. A Google sign-in alone gives nothing: the e-mail must be listed here.
create table public.members (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin', 'teacher')),
  name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;

-- Role of the signed-in user; null when the e-mail isn't a member.
create function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.members m where m.email = lower(auth.jwt() ->> 'email')
$$;

create policy "members see themselves, the admin sees everyone" on public.members
  for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.my_role() = 'admin');

create sequence public.records_rev;

create table public.records (
  type text not null check (type ~ '^[a-z][A-Za-z0-9]{1,39}$'),
  id text not null check (id <> ''),
  data jsonb not null,
  -- when the app last changed the record, ms since epoch: the newer change wins
  updated_at bigint not null,
  deleted boolean not null default false,
  -- order in which changes reached the server; devices pull everything after the last one they saw
  rev bigint not null default nextval('public.records_rev'),
  primary key (type, id)
);

create index records_rev_idx on public.records (rev);

alter table public.records enable row level security;

-- Only the admin reads records directly. Teachers will get their own narrow
-- functions later (their lessons without any money), never the table itself.
create policy "the admin reads everything" on public.records
  for select to authenticated
  using (public.my_role() = 'admin');

-- Writes go only through push_records(), which keeps the newer change of each record.
-- `records` is the app's batch: { "students": [ {...}, ... ], "lessons": [...], ... }.
create function public.push_records(records jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  kind text;
  list jsonb;
  rec jsonb;
  accepted int := 0;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- One push at a time, so revisions become visible in order and a pull never skips one.
  perform pg_advisory_xact_lock(hashtext('uroky.push_records'));
  for kind, list in select key, value from jsonb_each(records) loop
    continue when kind !~ '^[a-z][A-Za-z0-9]{1,39}$' or jsonb_typeof(list) <> 'array';
    for rec in select value from jsonb_array_elements(list) loop
      continue when jsonb_typeof(rec) <> 'object'
        or coalesce(rec ->> 'id', '') = ''
        or coalesce(jsonb_typeof(rec -> 'updatedAt'), '') <> 'number';
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

-- How many live records of each type the server holds, to show after moving data over.
create function public.record_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.type, c.n), '{}'::jsonb)
  from (
    select r.type, count(*) as n from public.records r
    where not r.deleted and public.my_role() = 'admin'
    group by r.type
  ) c
$$;

-- Nothing is reachable without signing in, and signed-in users only get what the policies allow.
revoke all on public.members, public.records from anon, authenticated;
grant select on public.members, public.records to authenticated;
revoke all on sequence public.records_rev from anon, authenticated;
revoke execute on function public.my_role(), public.push_records(jsonb), public.record_counts() from public, anon;
grant execute on function public.my_role(), public.push_records(jsonb), public.record_counts() to authenticated;
