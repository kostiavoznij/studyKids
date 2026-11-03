import { create } from 'zustand';
import { cloudEnabled, useAccount, type Role } from './cloud';
import type { ID } from './types';

/*
 * What the signed-in role may see and do. The server enforces the same rules
 * (supabase/migrations/20261104120000_roles.sql): a teacher's device never even
 * receives prices or other teachers' lessons, a manager's never the finance
 * records. The app only hides what would be empty or refused anyway.
 */

export interface Access {
  role: Role;
  /** the school's money: income per day/week/month, the «Фінанси» tab, taxes, the bank check */
  finance: boolean;
  /** prices of lessons and students, families' payments and balances */
  prices: boolean;
  /** create, move, cancel and delete lessons; edit students, groups, teachers and days off */
  manage: boolean;
  /** delete students and groups for good (others move them to the archive) */
  destroy: boolean;
  /** Налаштування → Доступ: who is an admin or a manager */
  members: boolean;
  /** replace this device's records with a file, or with the demo */
  restore: boolean;
}

const ACCESS: Record<Role, Access> = {
  admin: { role: 'admin', finance: true, prices: true, manage: true, destroy: true, members: true, restore: true },
  manager: { role: 'manager', finance: false, prices: true, manage: true, destroy: false, members: false, restore: false },
  teacher: { role: 'teacher', finance: false, prices: false, manage: false, destroy: false, members: false, restore: false },
};

/**
 * The role this device really has. Sync and the weekly schedule follow it, never
 * the preview below. Without a server (a local build) the device is all hers.
 */
export const currentRole = (): Role => (cloudEnabled ? useAccount.getState().role ?? 'admin' : 'admin');

export const accessFor = (role: Role): Access => ACCESS[role];

/*
 * «Подивитися очима»: an admin looks at the app as a manager or as one of the
 * teachers, a manager as a teacher — without signing out. Only the screens
 * change: the data on the device and the rights on the server stay the real
 * role's, so whatever is changed during a preview is really changed. Ends on
 * reload, on signing out and when the real role changes.
 */

interface Preview {
  role?: Role;
  /** whose eyes, when looking as a teacher */
  teacherId?: ID;
}

export const usePreview = create<Preview>(() => ({}));

const RANK: Record<Role, number> = { admin: 3, manager: 2, teacher: 1 };

/** Only a lower role can be looked at. */
const effective = (real: Role, p: Preview): Role => (p.role && RANK[p.role] < RANK[real] ? p.role : real);

const realRole = (role: Role | undefined): Role => (cloudEnabled ? role ?? 'admin' : 'admin');

export const canPreview = (real: Role, role: Role) => RANK[role] < RANK[real];

export function startPreview(role: Role, teacherId?: ID) {
  usePreview.setState({ role, teacherId: role === 'teacher' ? teacherId : undefined });
}

export const stopPreview = () => usePreview.setState({ role: undefined, teacherId: undefined });

useAccount.subscribe((a, prev) => {
  if (a.email !== prev.email || a.role !== prev.role || a.status !== prev.status) stopPreview();
});

/** What the screens show: the real role's access, or the previewed one's. */
export function useAccess(): Access {
  const role = useAccount((s) => s.role);
  const preview = usePreview();
  return ACCESS[effective(realRole(role), preview)];
}

/** The preview in effect, if any. */
export function usePreviewing(): Required<Pick<Preview, 'role'>> & Preview | null {
  const role = useAccount((s) => s.role);
  const preview = usePreview();
  const real = realRole(role);
  const shown = effective(real, preview);
  return shown === real ? null : { role: shown, teacherId: preview.teacherId };
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'адміністратор', manager: 'менеджер', teacher: 'вчителька' };
