-- Who may use the app is managed from the app itself (Налаштування → Доступ).
--
-- The members table stays closed for direct writes; an admin changes it only
-- through these functions. None of them can leave the app without an admin:
-- an admin can neither remove themselves nor take away their own admin role,
-- and changes run one at a time, so two admins can't remove each other at once.

-- Everyone with access and when they last signed in, so the admin sees that an invitation worked.
create function public.list_members() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Немає прав керувати доступом' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'email', m.email,
             'role', m.role,
             'name', m.name,
             'createdAt', m.created_at,
             'lastSignInAt', (select max(u.last_sign_in_at) from auth.users u where lower(u.email) = m.email)
           ) order by m.created_at, m.email)
    from public.members m
  ), '[]'::jsonb);
end $$;

-- Gives an e-mail access with a role, or changes the role and name of someone already listed.
create function public.set_member(member_email text, member_role text, member_name text default '') returns void
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
  if member_role is null or member_role not in ('admin', 'teacher') then
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

-- Takes access away. The person's devices find out the next time they open the app.
create function public.remove_member(member_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(btrim(coalesce(member_email, '')));
begin
  perform pg_advisory_xact_lock(hashtext('uroky.members'));
  if public.my_role() is distinct from 'admin' then
    raise exception 'Немає прав керувати доступом' using errcode = '42501';
  end if;
  if addr = lower((select auth.jwt()) ->> 'email') then
    raise exception 'Не можна забрати доступ у себе — це може зробити інший адміністратор' using errcode = '42501';
  end if;
  delete from public.members m where m.email = addr;
end $$;

revoke execute on function public.list_members(), public.set_member(text, text, text), public.remove_member(text) from public, anon;
grant execute on function public.list_members(), public.set_member(text, text, text), public.remove_member(text) to authenticated;
