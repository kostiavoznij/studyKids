import { Check, Cloud, CloudOff, Copy, Link2, RefreshCw, TriangleAlert, Unplug } from 'lucide-react';
import { useState } from 'react';
import { useData } from '../data/store';
import { checkConnection, connect, connectionCode, disconnect, parseConnection, syncNow, useSync, type RemoteInfo } from '../data/sync';
import { fmt } from '../lib/dates';
import { LESSONS, nPlural, STUDENTS } from '../lib/format';
import { ask, useUi } from '../ui/uiStore';

const GUIDE = 'https://github.com/kostiavoznij/studyKids/blob/main/docs/SYNC_SETUP.md';

export function SyncSection() {
  const sync = useSync();
  return (
    <section className="section card">
      <h2 className="set-title">
        <Cloud size={20} /> Синхронізація
      </h2>
      {sync.configured ? <Connected /> : <ConnectForm />}
    </section>
  );
}

function Connected() {
  const sync = useSync();
  const notify = useUi((s) => s.notify);
  const [copied, setCopied] = useState(false);

  const status =
    sync.status === 'syncing'
      ? { icon: <RefreshCw size={18} className="spin" />, text: 'Синхронізація…', tone: '' }
      : sync.status === 'offline'
        ? { icon: <CloudOff size={18} />, text: 'Немає інтернету — зміни збережено тут і відправляться пізніше', tone: 'warn' }
        : sync.status === 'error'
          ? { icon: <TriangleAlert size={18} />, text: sync.error ?? 'Помилка', tone: 'bad' }
          : { icon: <Check size={18} />, text: sync.lastSyncAt ? `Синхронізовано о ${fmt(new Date(sync.lastSyncAt), 'HH:mm')}` : 'Підключено', tone: 'good' };

  const copy = async () => {
    const code = connectionCode();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      notify('Не вдалося скопіювати — код є в таблиці на вкладці «Підключення»');
    }
  };

  const off = async () => {
    const ok = await ask({
      title: 'Відключити синхронізацію?',
      text: 'Дані на цьому пристрої залишаться, але перестануть оновлюватися з таблицею. Таблицю це не змінить.',
      ok: 'Відключити',
      danger: true,
    });
    if (ok) disconnect();
  };

  return (
    <>
      <div className={`sync-status ${status.tone}`}>
        {status.icon}
        <span>{status.text}</span>
      </div>
      {sync.pending > 0 && sync.status !== 'syncing' && (
        <p className="field-hint" style={{ marginTop: 6 }}>
          Ще не відправлено змін: {sync.pending}
        </p>
      )}
      <div className="set-buttons" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={() => syncNow()} disabled={sync.status === 'syncing'}>
          <RefreshCw size={17} /> Синхронізувати зараз
        </button>
        <button className="btn btn-ghost" onClick={copy}>
          {copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Скопійовано' : 'Код для іншого пристрою'}
        </button>
        <button className="btn btn-danger-soft" onClick={off}>
          <Unplug size={17} /> Відключити
        </button>
      </div>
      <p className="field-hint" style={{ marginTop: 12 }}>
        Щоб підключити телефон: на ньому відкрийте Google Таблиці → таблиця «Уроки» → вкладка «Підключення» → скопіюйте код і вставте тут, на телефоні.
      </p>
    </>
  );
}

function ConnectForm() {
  const seeded = useData((s) => s.seeded);
  const localCount = useData((s) => Object.keys(s.students).length + Object.keys(s.lessons).length);
  const notify = useUi((s) => s.notify);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remote, setRemote] = useState<(RemoteInfo & { url: string; key: string }) | null>(null);

  const check = async () => {
    const parsed = parseConnection(text);
    if (!parsed) {
      setError('Не бачу адреси (…/exec) і коду доступу (XXXX-XXXX-XXXX-XXXX). Вставте обидва.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const info = await checkConnection(parsed.url, parsed.key);
      setRemote({ ...info, ...parsed });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const go = async (mode: 'replace' | 'merge') => {
    if (!remote) return;
    setBusy(true);
    try {
      await connect(remote.url, remote.key, mode);
      notify('Синхронізацію підключено');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (remote) {
    const remoteEmpty = remote.counts.students + remote.counts.lessons === 0;
    const localReal = seeded === 'clean' && localCount > 0;
    return (
      <>
        <div className="sync-status good">
          <Link2 size={18} />
          <span>
            Таблицю знайдено:{' '}
            {remoteEmpty ? 'поки порожня' : `${nPlural(remote.counts.students, STUDENTS)}, ${nPlural(remote.counts.lessons, LESSONS)}`}
          </span>
        </div>
        <div className="sync-choices">
          {remoteEmpty && localReal && (
            <Choice title="Відправити мої дані в таблицю" hint="Усе, що вже внесено на цьому пристрої, з'явиться в таблиці" onClick={() => go('merge')} busy={busy} primary />
          )}
          {remoteEmpty && !localReal && (
            <Choice
              title="Почати з чистого аркуша"
              hint={seeded === 'demo' ? 'Демо-учні зникнуть, далі — тільки ваші дані' : 'Підключити порожню таблицю'}
              onClick={() => go('replace')}
              busy={busy}
              primary
            />
          )}
          {!remoteEmpty && (
            <Choice
              title="Завантажити дані з таблиці"
              hint={localReal ? 'Те, що є на цьому пристрої, буде замінено даними з таблиці' : 'Цей пристрій покаже все, що вже є в таблиці'}
              onClick={async () => {
                if (localReal) {
                  const ok = await ask({ title: 'Замінити дані на цьому пристрої?', text: 'Поточні учні й уроки на цьому пристрої буде замінено даними з таблиці.', ok: 'Замінити', danger: true });
                  if (!ok) return;
                }
                go('replace');
              }}
              busy={busy}
              primary={!localReal}
            />
          )}
          {!remoteEmpty && localReal && (
            <Choice title="Об'єднати" hint="Записи з обох місць зберігаються; якщо один і той самий змінено двічі — лишається новіша зміна" onClick={() => go('merge')} busy={busy} primary />
          )}
        </div>
        <button className="link-btn" style={{ marginTop: 12 }} onClick={() => setRemote(null)}>
          Назад
        </button>
        {error && <p className="sync-error">{error}</p>}
      </>
    );
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 14 }}>
        Підключіть Google Таблицю — тоді ноутбук і телефон бачитимуть одне й те саме, а таблиця буде ще й резервною копією. Налаштування один раз, хвилин
        15: <a href={GUIDE} target="_blank" rel="noreferrer">покрокова інструкція</a>.
      </p>
      <label className="field" style={{ marginTop: 14 }}>
        <span className="field-label">Адреса та код доступу</span>
        <textarea
          className="textarea"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://script.google.com/macros/s/…/exec  XXXX-XXXX-XXXX-XXXX"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <span className="field-hint">Можна вставити обидва разом — з вкладки «Підключення» у таблиці.</span>
      </label>
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy || !text.trim()} onClick={check}>
        {busy ? <RefreshCw size={17} className="spin" /> : <Link2 size={17} />} Перевірити
      </button>
      {error && <p className="sync-error">{error}</p>}
    </>
  );
}

function Choice({ title, hint, onClick, busy, primary }: { title: string; hint: string; onClick: () => void; busy: boolean; primary?: boolean }) {
  return (
    <button className={`sync-choice${primary ? ' primary' : ''}`} onClick={onClick} disabled={busy}>
      <b>{title}</b>
      <span>{hint}</span>
    </button>
  );
}

/** Small cloud in the corner that tells whether everything reached the table. */
export function SyncBadge() {
  const sync = useSync();
  if (!sync.configured) return null;
  const label =
    sync.status === 'syncing' ? 'Синхронізація…' : sync.status === 'offline' ? 'Без інтернету' : sync.status === 'error' ? 'Помилка синхронізації' : 'Синхронізовано';
  return (
    <a className="sync-badge" data-status={sync.status} href="#/settings" title={label} aria-label={label}>
      {sync.status === 'syncing' ? (
        <RefreshCw size={17} className="spin" />
      ) : sync.status === 'offline' ? (
        <CloudOff size={18} />
      ) : sync.status === 'error' ? (
        <TriangleAlert size={18} />
      ) : (
        <Cloud size={18} />
      )}
      {sync.pending > 0 && sync.status !== 'syncing' && <i />}
    </a>
  );
}
