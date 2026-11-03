import { CircleCheck, ExternalLink, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useAccess } from '../data/access';
import { refreshBot, setupBot, useBot } from '../data/bot';
import { useLiveStudents } from '../data/selectors';
import { useUi } from '../ui/uiStore';

/*
 * Налаштування → Telegram-бот, for the admin. Shows up only once the server has
 * a bot token (docs/BOT.md), so on an account without a bot there is nothing to
 * wonder about.
 */
export function BotSection() {
  const { status, chats, loading } = useBot();
  const admin = useAccess().role === 'admin';
  const students = useLiveStudents();
  const notify = useUi((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  if (!admin || !status?.configured) return null;

  const live = new Set(students.filter((s) => s.status !== 'archived').map((s) => s.id));
  const families = new Set(chats.filter((c) => !c.blocked && live.has(c.studentId)).map((c) => c.studentId)).size;

  const connect = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      await setupBot();
      notify('Бота підключено');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section card">
      <h2 className="set-title">
        <Send size={20} /> Telegram-бот
      </h2>

      {status.connected ? (
        <div className="sync-status good">
          <CircleCheck size={18} />
          <span>
            @{status.username} працює · підключено учнів: {families} з {live.size}
          </span>
        </div>
      ) : (
        <div className="sync-status warn">
          <TriangleAlert size={18} />
          <span>Бот @{status.username} знайдено, але Telegram ще не надсилає йому повідомлень</span>
        </div>
      )}

      {status.lastError && <p className="sync-error">Остання помилка доставки: {status.lastError}</p>}

      <p className="muted" style={{ fontSize: 14, margin: '12px 0' }}>
        Запрошення для батьків — у картці кожного учня, кнопка «Запросити в бот». Батьки відкривають посилання й натискають «Почати».
      </p>

      <div className="bot-actions">
        {!status.connected && (
          <button className="btn btn-primary" disabled={busy} onClick={connect}>
            <Send size={17} /> Підключити бота
          </button>
        )}
        <a className="btn btn-ghost btn-sm" href={`https://t.me/${status.username}`} target="_blank" rel="noreferrer">
          <ExternalLink size={16} /> Відкрити в Telegram
        </a>
        <button className="btn btn-ghost btn-sm" disabled={loading} onClick={() => refreshBot(true)}>
          <RefreshCw size={16} className={loading ? 'spin' : undefined} /> Перевірити
        </button>
        {status.connected && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={connect}>
            Оновити опис і команди
          </button>
        )}
      </div>

      {problem && <p className="sync-error">{problem}</p>}
    </section>
  );
}
