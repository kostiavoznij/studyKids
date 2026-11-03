import { Eye } from 'lucide-react';
import { canPreview, ROLE_LABEL, startPreview, stopPreview, usePreviewing } from '../data/access';
import { useAccount, type Role } from '../data/cloud';
import { useActiveTeachers, useMe } from '../data/selectors';
import { Avatar } from './components';
import { navigate } from './router';

/*
 * Who the app is showing itself to: in the sidebar, on the «Ще» tab, and — while
 * looking through someone else's eyes — a bar across the top with the way back.
 */

const ROLE_COLOR: Record<Role, string> = { admin: 'violet', manager: 'blue', teacher: 'teal' };

/** The account in the sidebar; opens the settings. */
export function AccountChip() {
  const me = useMe();
  if (!me) return null;
  return (
    <button className="account-chip" data-preview={me.previewing ? '' : undefined} onClick={() => navigate('/settings')}>
      <Avatar name={me.name} color={ROLE_COLOR[me.role]} size={34} />
      <span className="account-chip-text">
        <b>{me.name}</b>
        <span>{me.previewing ? `перегляд · ${ROLE_LABEL[me.role]}` : ROLE_LABEL[me.role]}</span>
      </span>
    </button>
  );
}

/** Small avatar for the «Ще» tab on the phone; null without an account. */
export function MeAvatar() {
  const me = useMe();
  if (!me) return null;
  return (
    <span className="tab-avatar" data-preview={me.previewing ? '' : undefined}>
      <Avatar name={me.name} color={ROLE_COLOR[me.role]} size={24} />
    </span>
  );
}

/** Across the top of every screen while previewing, so it is never mistaken for one's own view. */
export function PreviewBanner() {
  const me = useMe();
  if (!me?.previewing) return null;
  return (
    <div className="preview-banner" role="status">
      <Eye size={18} />
      <span>
        <span className="preview-who">
          Перегляд: <b>{me.role === 'teacher' ? me.name : 'менеджер'}</b>
          {me.role === 'teacher' && ' · вчителька'}
        </span>
        <small>Зміни зберігаються</small>
      </span>
      <button className="btn btn-sm btn-primary" onClick={stopPreview}>
        Повернутися
      </button>
    </div>
  );
}

/** «Подивитися очима» in Налаштування → Акаунт, for admins and managers. */
export function PreviewPicker() {
  const real = useAccount((s) => s.role);
  const preview = usePreviewing();
  const teachers = useActiveTeachers();
  if (!real || real === 'teacher') return null;
  return (
    <div className="field" style={{ marginTop: 16 }}>
      <span className="field-label">Подивитися очима</span>
      <div className="chips">
        {canPreview(real, 'manager') && (
          <button className="chip sm" aria-pressed={preview?.role === 'manager'} onClick={() => startPreview('manager')}>
            Менеджера
          </button>
        )}
        {teachers.map((t) => (
          <button
            key={t.id}
            className="chip sm"
            aria-pressed={preview?.role === 'teacher' && preview.teacherId === t.id}
            onClick={() => startPreview('teacher', t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <span className="field-hint">
        Так видно, що бачить {real === 'admin' ? 'менеджер чи вчителька' : 'вчителька'}, без виходу з акаунта. Ваші права на сервері не змінюються, тож усе, що ви зміните під
        час перегляду, збережеться по-справжньому.
      </span>
    </div>
  );
}
