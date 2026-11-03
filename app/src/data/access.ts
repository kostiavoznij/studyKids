import { cloudEnabled, useAccount, type Role } from './cloud';

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

/** Without a server (a local build) the device is all hers, as it always was. */
export const currentRole = (): Role => (cloudEnabled ? useAccount.getState().role ?? 'admin' : 'admin');

export const accessFor = (role: Role): Access => ACCESS[role];

export function useAccess(): Access {
  const role = useAccount((s) => s.role);
  return ACCESS[cloudEnabled ? role ?? 'admin' : 'admin'];
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'адміністратор', manager: 'менеджер', teacher: 'вчителька' };
