import { KeyRound, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAccess } from '../data/access';
import { listMembers, rememberManagers, removeMember, saveMember, useAccount, type Member, type MemberRole } from '../data/cloud';
import { fmt } from '../lib/dates';
import { Avatar, Segmented } from '../ui/components';
import { ask, useUi } from '../ui/uiStore';

/*
 * Admins and managers (Налаштування → Доступ). The list lives on the server and
 * only an admin can change it; the server itself refuses anything else, and
 * never lets an admin lock themselves out. Teachers are let in by their teacher
 * card (Учні → Вчительки) instead.
 */

const ROLES: { value: MemberRole; label: string }[] = [
  { value: 'manager', label: 'Менеджер' },
  { value: 'admin', label: 'Адміністратор' },
];

const ROLE_LABEL: Record<MemberRole, string> = { admin: 'Адміністратор', manager: 'Менеджер' };

const ROLE_HINT: Record<MemberRole, string> = {
  admin: 'Бачить і змінює все: учнів, уроки, гроші, фінанси, статистику і цей список.',
  manager:
    'Веде школу: учні, групи, уроки, перенесення й скасування, вчительки, оплати сімей. Не бачить фінансів, податків і заробітку, не видаляє учнів назавжди й не керує цим списком.',
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const lastSeen = (m: Member) => (m.lastSignInAt ? `останній вхід ${fmt(m.lastSignInAt, 'd MMM, HH:mm')}` : 'ще не входили');

export function MembersSection() {
  const account = useAccount();
  // Hidden while an admin looks through a manager's or a teacher's eyes, as it is for them.
  const members = useAccess().members;
  if (account.status !== 'in' || account.role !== 'admin' || !members) return null;
  return <Members me={account.email ?? ''} />;
}

function Members({ me }: { me: string }) {
  const [list, setList] = useState<Member[] | null>(null);
  const [error, setError] = useState<string>();
  /** e-mail of the row being edited, or 'new' while adding someone */
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const members = await listMembers();
      setList(members);
      rememberManagers(members);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const done = async () => {
    setOpen(null);
    await load();
  };

  return (
    <section className="section card">
      <h2 className="set-title">
        <KeyRound size={20} /> Доступ
      </h2>
      <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
        Адміністратори й менеджери. Вчительок додають у «Учні → Вчительки»: там вказують їхній Gmail, і вони бачать лише свій розклад. Будь-яка інша пошта після
        входу бачить лише «немає доступу».
      </p>

      {error && (
        <>
          <p className="sync-error" style={{ marginTop: 0 }}>
            Не вдалося завантажити список: {error}
          </p>
          <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={load}>
            <RefreshCw size={17} /> Спробувати ще
          </button>
        </>
      )}

      {!list && !error && (
        <div className="sync-status">
          <RefreshCw size={18} className="spin" />
          <span>Завантажую список…</span>
        </div>
      )}

      {list && (
        <div className="list members">
          {list.map((m) =>
            open === m.email ? (
              <MemberForm key={m.email} member={m} me={me} taken={[]} onDone={done} onCancel={() => setOpen(null)} />
            ) : (
              <button key={m.email} className="list-item" onClick={() => setOpen(m.email)}>
                <Avatar name={m.name || m.email} color={m.role === 'admin' ? 'violet' : 'blue'} size={38} />
                <div className="list-main">
                  <div className="list-title">{m.name || m.email}</div>
                  <div className="list-sub">
                    {m.name ? `${m.email} · ` : ''}
                    {m.email === me ? 'це ви' : lastSeen(m)}
                  </div>
                </div>
                <span className={m.role === 'admin' ? 'badge accent' : 'badge'}>{ROLE_LABEL[m.role]}</span>
              </button>
            ),
          )}
          {open === 'new' && (
            <MemberForm me={me} taken={list.map((m) => m.email)} onDone={done} onCancel={() => setOpen(null)} />
          )}
        </div>
      )}

      {list && open !== 'new' && (
        <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setOpen('new')}>
          <UserPlus size={18} /> Додати пошту
        </button>
      )}
    </section>
  );
}

/** Adding someone (no `member`) or changing an existing entry, right inside the list. */
function MemberForm({
  member,
  me,
  taken,
  onDone,
  onCancel,
}: {
  member?: Member;
  me: string;
  /** e-mails already on the list, so the same one isn't added twice */
  taken: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const notify = useUi((s) => s.notify);
  const [email, setEmail] = useState(member?.email ?? '');
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState<MemberRole>(member?.role ?? 'manager');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const self = member?.email === me;
  const addr = email.trim().toLowerCase();
  const who = name.trim() || addr;
  const changed = !member || name.trim() !== member.name || role !== member.role;

  const save = async () => {
    if (!EMAIL.test(addr)) return setError('Перевірте пошту — має бути щось на зразок name@gmail.com');
    if (!member && taken.includes(addr)) return setError('Ця пошта вже є в списку — натисніть на неї, щоб змінити');
    if (role === 'admin' && member?.role !== 'admin') {
      const yes = await ask({
        title: 'Дати права адміністратора?',
        text: `${who} бачитиме всіх учнів, оплати й фінанси, зможе все змінювати й керувати цим списком.`,
        ok: 'Дати права',
      });
      if (!yes) return;
    }
    if (member?.role === 'admin' && role !== 'admin') {
      const yes = await ask({
        title: 'Зняти права адміністратора?',
        text: `${who} більше не бачитиме фінансів, податків і заробітку й не зможе керувати цим списком.`,
        ok: 'Зняти права',
        danger: true,
      });
      if (!yes) return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await saveMember(addr, role, name.trim());
      notify(member ? 'Зміни збережено' : `${addr} тепер має доступ`);
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!member) return;
    const yes = await ask({
      title: 'Забрати доступ?',
      text: `${who === member.email ? who : `${who} (${member.email})`} більше не зможе входити: наступного разу, коли застосунок відкриється з цією поштою, там буде лише екран входу. Записи акаунта не зміняться.`,
      ok: 'Забрати доступ',
      danger: true,
    });
    if (!yes) return;
    setBusy(true);
    setError(undefined);
    try {
      await removeMember(member.email);
      notify(`${member.email} більше не має доступу`);
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="member-form">
      {member ? (
        <div className="member-form-head">
          <b>{member.email}</b>
          <span className="list-sub">{self ? 'це ви' : lastSeen(member)}</span>
        </div>
      ) : (
        <label className="field">
          <span className="field-label">Пошта Google</span>
          <input
            className="input"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="name@gmail.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(undefined);
            }}
            autoFocus
          />
          <span className="field-hint">Та, з якою людина входитиме через Google.</span>
        </label>
      )}
      <label className="field">
        <span className="field-label">Ім'я (необов'язково)</span>
        <input className="input" value={name} maxLength={80} placeholder="Наприклад, Олена" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span className="field-label">Роль</span>
        {self ? (
          <span className="field-hint">Адміністратор. Свою роль і доступ може змінити лише інший адміністратор — так ніхто випадково не закриє собі вхід.</span>
        ) : (
          <>
            <Segmented label="Роль" value={role} options={ROLES} onChange={setRole} />
            <span className="field-hint">{ROLE_HINT[role]}</span>
          </>
        )}
      </div>
      {error && <p className="sync-error">{error}</p>}
      <div className="set-buttons" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy || !changed || !addr}>
          {busy ? <RefreshCw size={17} className="spin" /> : member ? null : <UserPlus size={17} />}
          {member ? 'Зберегти' : 'Додати'}
        </button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Скасувати
        </button>
        {member && !self && (
          <button className="btn btn-danger-soft" onClick={remove} disabled={busy}>
            <Trash2 size={17} /> Забрати доступ
          </button>
        )}
      </div>
    </div>
  );
}
