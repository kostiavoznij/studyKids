import { LogIn, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ROLE_LABEL } from '../data/access';
import { retryAccount, serverCounts, signIn, signOut, useAccount, type Role } from '../data/cloud';
import { useData, type DataState } from '../data/store';
import { disconnect, moveToCloud, syncNow, useSync } from '../data/sync';
import { LESSONS, nPlural, STUDENTS } from '../lib/format';
import { ask, useUi } from '../ui/uiStore';
import { Choice, SyncStatusLine } from './SyncSection';

/** What is compared between this device and the account after moving over. */
const KINDS: { type: 'students' | 'lessons' | 'payments' | 'daysOff' | 'taxes' | 'bankMonths'; label: string }[] = [
  { type: 'students', label: 'Учні' },
  { type: 'lessons', label: 'Уроки' },
  { type: 'payments', label: 'Оплати' },
  { type: 'daysOff', label: 'Дні без уроків' },
  { type: 'taxes', label: 'Податки' },
  { type: 'bankMonths', label: 'Звірки з банком' },
];

const liveCount = (s: DataState, type: (typeof KINDS)[number]['type']) =>
  Object.values(s[type] as Record<string, { deletedAt?: number }>).filter((r) => !r.deletedAt).length;

export function AccountSection() {
  const account = useAccount();
  const mode = useSync((s) => s.mode);
  const notify = useUi((s) => s.notify);
  if (account.status === 'off') return null;

  const login = async () => {
    try {
      await signIn();
    } catch (e) {
      notify(`Не вдалося почати вхід: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  let body;
  if (account.status === 'loading') {
    body = (
      <div className="sync-status">
        <RefreshCw size={18} className="spin" />
        <span>Перевіряю вхід…</span>
      </div>
    );
  } else if (account.status === 'out') {
    body = (
      <>
        {mode === 'cloud' ? (
          <p className="sync-error" style={{ marginTop: 0 }}>
            Цей пристрій працює з акаунтом, але вхід закінчився. Увійдіть ще раз, щоб зміни знову відправлялися.
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 14 }}>
            Увійдіть через Google — тоді всі записи зберігатимуться в акаунті, і на будь-якому пристрої після входу буде те саме.
            {mode === 'sheet' &&
              ' Зараз дані синхронізуються через Google Таблицю: після входу все з цього пристрою перейде в акаунт, а таблицю буде відключено (вона лишиться як архів).'}
          </p>
        )}
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={login}>
          <LogIn size={18} /> Увійти через Google
        </button>
      </>
    );
  } else if (account.status === 'denied') {
    body = (
      <>
        <p className="sync-error" style={{ marginTop: 0 }}>
          Пошта {account.email} не має доступу до «Уроків». Якщо це помилка — попросіть адміністратора додати її.
        </p>
        <div className="set-buttons" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => retryAccount()}>
            <RefreshCw size={17} /> Перевірити ще раз
          </button>
          <button className="btn btn-ghost" onClick={() => signOut()}>
            <LogOut size={17} /> Вийти
          </button>
        </div>
      </>
    );
  } else if (account.status === 'error') {
    body = (
      <>
        <p className="sync-error" style={{ marginTop: 0 }}>
          Не вдалося перевірити доступ{account.error ? `: ${account.error}` : ''}.
        </p>
        <div className="set-buttons" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={() => retryAccount()}>
            <RefreshCw size={17} /> Спробувати ще
          </button>
          <button className="btn btn-ghost" onClick={() => signOut()}>
            <LogOut size={17} /> Вийти
          </button>
        </div>
      </>
    );
  } else {
    body = <SignedIn email={account.email ?? ''} name={account.name ?? ''} role={account.role ?? 'admin'} />;
  }

  return (
    <section className="section card">
      <h2 className="set-title">
        <UserRound size={20} /> Акаунт
      </h2>
      {body}
    </section>
  );
}

function SignedIn({ email, name, role }: { email: string; name: string; role: Role }) {
  const sync = useSync();
  const local = useData();
  const clearAll = useData((s) => s.clearAll);
  const notify = useUi((s) => s.notify);
  const [server, setServer] = useState<Record<string, number> | null>(null);

  // Compare with the server after every sync, so moving over can be checked by eye (only the admin sees all of it).
  useEffect(() => {
    if (sync.status !== 'idle' || role !== 'admin') return;
    serverCounts()
      .then(setServer)
      .catch(() => setServer(null));
  }, [sync.status, sync.lastSyncAt, role]);

  const logout = async () => {
    const unsent = sync.pending > 0;
    const yes = await ask({
      title: 'Вийти з акаунта?',
      text: unsent
        ? `На цьому пристрої є ще не відправлені зміни (${sync.pending}). Якщо вийти зараз, вони пропадуть. Краще спершу підключитися до інтернету й дочекатися синхронізації.`
        : 'Записи на цьому пристрої буде прибрано. Вони лишаються в акаунті й повернуться після входу.',
      ok: unsent ? 'Однаково вийти' : 'Вийти',
      danger: true,
    });
    if (!yes) return;
    await signOut();
    disconnect();
    clearAll();
    notify('Ви вийшли з акаунта');
  };

  if (sync.choosing) return <MoveChoice email={email} />;

  return (
    <>
      <p className="muted" style={{ fontSize: 14, marginBottom: 10 }}>
        Ви увійшли як <b>{name ? `${name} (${email})` : email}</b> · {ROLE_LABEL[role]}
      </p>
      {role === 'teacher' && (
        <p className="muted" style={{ fontSize: 14, marginBottom: 10 }}>
          Ви бачите свій розклад, своїх учнів, теми й нотатки. Відмічайте проведені уроки й записуйте теми — адміністратор і менеджер побачать це одразу.
        </p>
      )}
      <SyncStatusLine />
      {role === 'admin' && <table className="account-counts">
        <thead>
          <tr>
            <th />
            <th>На пристрої</th>
            <th>В акаунті</th>
          </tr>
        </thead>
        <tbody>
          {KINDS.map((k) => {
            const here = liveCount(local, k.type);
            const there = server?.[k.type] ?? 0;
            return (
              <tr key={k.type}>
                <td>{k.label}</td>
                <td>{here}</td>
                <td className={server && here !== there ? 'warn' : undefined}>{server ? there : '…'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>}
      <div className="set-buttons" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={() => syncNow()} disabled={sync.status === 'syncing'}>
          <RefreshCw size={17} /> Синхронізувати зараз
        </button>
        <button className="btn btn-danger-soft" onClick={logout}>
          <LogOut size={17} /> Вийти
        </button>
      </div>
    </>
  );
}

/** First sign-in on a device that already has records: send them up or leave them out. */
function MoveChoice({ email }: { email: string }) {
  const local = useData();
  const [busy, setBusy] = useState(false);
  const go = async (mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      const yes = await ask({
        title: 'Не переносити записи цього пристрою?',
        text: 'Їх буде прибрано з цього пристрою, а показано лише те, що є в акаунті.',
        ok: 'Не переносити',
        danger: true,
      });
      if (!yes) return;
    }
    setBusy(true);
    await moveToCloud(mode);
    setBusy(false);
  };
  return (
    <>
      <p className="muted" style={{ fontSize: 14 }}>
        Ви увійшли як <b>{email}</b>. На цьому пристрої вже є записи: {nPlural(liveCount(local, 'students'), STUDENTS)},{' '}
        {nPlural(liveCount(local, 'lessons'), LESSONS)}, оплат — {liveCount(local, 'payments')}. Що з ними зробити?
      </p>
      <div className="sync-choices">
        <Choice
          title="Перенести в акаунт"
          hint="Записи цього пристрою додадуться до акаунта. Якщо той самий запис змінено в обох місцях — лишиться новіша зміна. Так переносять дані і з ПК, і з телефона."
          onClick={() => go('merge')}
          busy={busy}
          primary
        />
        <Choice title="Не переносити" hint="Записи цього пристрою буде прибрано, а показано лише те, що є в акаунті." onClick={() => go('replace')} busy={busy} />
      </div>
    </>
  );
}
