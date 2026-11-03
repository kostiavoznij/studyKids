import { ChevronRight, CircleCheck, ExternalLink, Plus, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useAccess } from '../data/access';
import { refreshBot, setupBot, useBot } from '../data/bot';
import { BUILT_IN, ownTemplates } from '../data/botText';
import { BotReminders } from './BotReminders';
import { BotInbox } from './BotInbox';
import { useData } from '../data/store';
import { useLiveStudents } from '../data/selectors';
import { useUi } from '../ui/uiStore';

/*
 * Налаштування → Telegram-бот, for the admin and the manager (connecting the bot
 * is the admin's). Shows up only once the server has a bot token (docs/BOT.md),
 * so on an account without a bot there is nothing to wonder about.
 */
export function BotSection() {
  const { status, chats, loading } = useBot();
  const access = useAccess();
  const admin = access.role === 'admin';
  const templates = useData((s) => s.botTemplates);
  const open = useUi((s) => s.open);
  const students = useLiveStudents();
  const notify = useUi((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  if (!access.manage || access.role === 'teacher' || !status?.configured) return null;
  const own = ownTemplates(templates);

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
        Батьки підключаються самі: відкривають своє посилання й натискають «Почати». Надіслати посилання можна всім одразу тут або з картки учня.
      </p>
      {status.connected && (
        <button className="btn btn-primary btn-block" style={{ marginBottom: 4 }} onClick={() => open({ kind: 'botInvites' })}>
          <Send size={17} /> Запросити батьків
        </button>
      )}

      <div className="bot-actions">
        {admin && !status.connected && (
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
        {admin && status.connected && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={connect}>
            Оновити налаштування бота
          </button>
        )}
      </div>

      {problem && <p className="sync-error">{problem}</p>}

      <h3 className="bot-subtitle">Нагадування</h3>
      <BotReminders />

      <h3 className="bot-subtitle">Відповіді батьків</h3>
      <BotInbox />

      <h3 className="bot-subtitle">Шаблони повідомлень</h3>
      <div className="list">
        {(['cancel', 'cancelMany', 'move'] as const).map((k) => (
          <button key={k} className="list-item" onClick={() => open({ kind: 'botTemplate', templateKind: k })}>
            <div className="list-main">
              <div className="list-title">{BUILT_IN[k].name}</div>
              <div className="list-sub">{templates[k] && !templates[k].deletedAt ? 'ваш текст' : 'стандартний текст'} · {BUILT_IN[k].when.toLowerCase()}</div>
            </div>
            <ChevronRight size={18} className="faint" />
          </button>
        ))}
        {own.map((t) => (
          <button key={t.id} className="list-item" onClick={() => open({ kind: 'botTemplate', id: t.id, templateKind: 'free' })}>
            <div className="list-main">
              <div className="list-title">{t.name}</div>
              <div className="list-sub bot-template-sub">{t.text}</div>
            </div>
            <ChevronRight size={18} className="faint" />
          </button>
        ))}
      </div>
      <button className="link-btn" style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => open({ kind: 'botTemplate', templateKind: 'free' })}>
        <Plus size={16} /> Мій шаблон
      </button>
      <p className="field-hint" style={{ marginTop: 6 }}>Свої шаблони — для повідомлень окремій сім'ї: картка учня → «Бот» → «Написати батькам».</p>
    </section>
  );
}
