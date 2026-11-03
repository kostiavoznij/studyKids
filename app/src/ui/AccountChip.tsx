import { Check, ChevronsUpDown, Eye, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { canPreview, ROLE_COLOR, ROLE_LABEL, startPreview, stopPreview, usePreviewing } from '../data/access';
import { cloudEnabled, useAccount } from '../data/cloud';
import { useActiveTeachers, useMe } from '../data/selectors';
import { Avatar } from './components';
import { navigate } from './router';

/*
 * Who the app is showing itself to: in the sidebar, on the «Ще» tab, and — while
 * looking through someone else's eyes — a bar across the top with the way back.
 * An admin or a manager switches whose eyes in one click from the sidebar, or
 * at the top of «Ще» on the phone.
 */

interface View {
  key: string;
  name: string;
  sub: string;
  color: string;
  active: boolean;
  pick: () => void;
}

/** Whose eyes an admin or a manager can look through, their own first; empty for a teacher. */
function useViews(): View[] {
  const account = useAccount();
  const preview = usePreviewing();
  const teachers = useActiveTeachers();
  const real = account.role;
  if (!cloudEnabled || account.status !== 'in' || !real || real === 'teacher') return [];
  const views: View[] = [
    { key: 'me', name: account.name || account.email || 'Я', sub: ROLE_LABEL[real], color: ROLE_COLOR[real], active: !preview, pick: stopPreview },
  ];
  if (canPreview(real, 'manager')) {
    views.push({
      key: 'manager',
      name: 'Менеджер',
      sub: 'без фінансів і доступу',
      color: ROLE_COLOR.manager,
      active: preview?.role === 'manager',
      pick: () => startPreview('manager'),
    });
  }
  for (const t of teachers) {
    views.push({
      key: t.id,
      name: t.name,
      sub: 'вчителька',
      color: t.color,
      active: preview?.role === 'teacher' && preview.teacherId === t.id,
      pick: () => startPreview('teacher', t.id),
    });
  }
  return views;
}

/** The account in the sidebar: opens «Дивитися як», or the settings for a teacher. */
export function AccountChip() {
  const me = useMe();
  const views = useViews();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!me) return null;
  const menu = views.length > 1;
  return (
    <div className="account-box" ref={box}>
      {open && (
        <div className="account-menu" role="menu" aria-label="Дивитися як">
          <div className="account-menu-title">Дивитися як</div>
          {views.map((v) => (
            <button
              key={v.key}
              role="menuitemradio"
              aria-checked={v.active}
              className="account-menu-item"
              onClick={() => {
                v.pick();
                setOpen(false);
              }}
            >
              <Avatar name={v.name} color={v.color} size={30} />
              <span className="account-chip-text">
                <b>{v.name}</b>
                <span>{v.sub}</span>
              </span>
              {v.active && <Check size={18} className="account-menu-check" />}
            </button>
          ))}
          <div className="account-menu-sep" />
          <button
            role="menuitem"
            className="account-menu-item"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
          >
            <Settings size={18} /> Налаштування
          </button>
        </div>
      )}
      <button
        className="account-chip"
        data-preview={me.previewing ? '' : undefined}
        aria-haspopup={menu ? 'menu' : undefined}
        aria-expanded={menu ? open : undefined}
        onClick={() => (menu ? setOpen((o) => !o) : navigate('/settings'))}
      >
        <Avatar name={me.name} color={me.color} size={34} />
        <span className="account-chip-text">
          <b>{me.name}</b>
          <span>{me.previewing ? `перегляд · ${ROLE_LABEL[me.role]}` : ROLE_LABEL[me.role]}</span>
        </span>
        {menu && <ChevronsUpDown size={16} className="account-chip-caret" />}
      </button>
    </div>
  );
}

/** Small avatar for the «Ще» tab on the phone; null without an account. */
export function MeAvatar() {
  const me = useMe();
  if (!me) return null;
  return (
    <span className="tab-avatar" data-preview={me.previewing ? '' : undefined}>
      <Avatar name={me.name} color={me.color} size={24} />
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

/** First thing in the settings (the «Ще» tab on the phone): who is signed in, and whose eyes to look through. */
export function WhoCard() {
  const account = useAccount();
  const views = useViews();
  if (views.length < 2) return null;
  const me = views[0];
  const email = account.email ?? '';
  return (
    <section className="section card who-card">
      <div className="who-head">
        <Avatar name={me.name} color={me.color} size={44} />
        <span className="account-chip-text">
          <b>{me.name}</b>
          <span>{me.name === email ? me.sub : `${email} · ${ROLE_LABEL[account.role ?? 'admin']}`}</span>
        </span>
      </div>
      <span className="field-label">Дивитися як</span>
      <div className="chips">
        {views.map((v) => (
          <button key={v.key} className="chip sm" aria-pressed={v.active} onClick={v.pick}>
            {v.key === 'me' ? 'Я' : v.name}
          </button>
        ))}
      </div>
      <span className="field-hint">
        Ті самі екрани, що в них, без виходу з акаунта. Зміни під час перегляду зберігаються по-справжньому.
      </span>
    </section>
  );
}
