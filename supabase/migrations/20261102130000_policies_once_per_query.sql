-- The policies asked for the role once per row; wrapped in a select, Postgres
-- works it out once per query, which matters once there are thousands of lessons.
--
-- my_role(), push_records() and record_counts() stay SECURITY DEFINER on purpose:
-- each checks the caller's role itself, and that is the only way in for writes.

drop policy "members see themselves, the admin sees everyone" on public.members;
create policy "members see themselves, the admin sees everyone" on public.members
  for select to authenticated
  using (email = lower((select auth.jwt()) ->> 'email') or (select public.my_role()) = 'admin');

drop policy "the admin reads everything" on public.records;
create policy "the admin reads everything" on public.records
  for select to authenticated
  using ((select public.my_role()) = 'admin');
