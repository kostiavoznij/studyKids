import { Copy, RefreshCw, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { chatLabel, chatsOf, inviteLink, inviteText, refreshBot, unlinkChat, useBot, type BotChat } from '../data/bot';
import type { Student } from '../data/types';
import { fmt } from '../lib/dates';
import { Avatar, Sheet } from '../ui/components';
import { ask, useUi } from '../ui/uiStore';

/*
 * One student and the bot: who of the family is connected, and the personal
 * link to invite the rest. Sending the invitation is up to her — the app only
 * prepares the text, ready to paste where she already talks to the parents.
 */

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** On a phone the share sheet goes straight to Viber or Telegram; on a computer copying is simpler. */
const canShare = () => typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;

export function StudentBotSheet({ student, onClose }: { student: Student; onClose: () => void }) {
  const { status, chats, loading, error } = useBot();
  const notify = useUi((s) => s.notify);
  const mine = chatsOf(chats, student.id);
  const [link, setLink] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    refreshBot(true);
  }, []);

  const getLink = async (renew = false) => {
    if (link && !renew) return link;
    setBusy(true);
    setProblem(undefined);
    try {
      const l = await inviteLink(student.id, renew);
      setLink(l);
      return l;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const invite = async () => {
    const l = await getLink();
    if (!l) return;
    const text = inviteText(student.name, l);
    if (canShare()) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    notify((await copy(text)) ? 'Запрошення скопійовано — вставте його в чат з батьками' : 'Не вдалося скопіювати — виділіть посилання нижче');
  };

  const copyLink = async () => {
    const l = await getLink();
    if (l) notify((await copy(l)) ? 'Посилання скопійовано' : 'Не вдалося скопіювати — виділіть посилання нижче');
  };

  const renew = async () => {
    const ok = await ask({
      title: 'Створити нове посилання?',
      text: 'Старе посилання перестане працювати. Ті, хто вже підключився, лишаться підключеними.',
      ok: 'Створити',
    });
    if (ok && (await getLink(true))) notify('Нове посилання готове, старе більше не діє');
  };

  const unlink = async (c: BotChat) => {
    const ok = await ask({
      title: `Відключити ${chatLabel(c)}?`,
      text: `Повідомлення про уроки (${student.name}) більше не надходитимуть у цей чат. Щоб повернутися, людині знадобиться посилання.`,
      ok: 'Відключити',
      danger: true,
    });
    if (!ok) return;
    try {
      await unlinkChat(student.id, c.chatId);
      notify(`${chatLabel(c)} — відключено`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet
      title="Telegram-бот"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={busy || !status?.username} onClick={invite}>
          <Send size={18} /> {mine.length ? 'Запросити ще когось' : 'Надіслати запрошення'}
        </button>
      }
    >
      <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
        Через бота батьки отримують повідомлення про уроки: {student.name}. Щоб підключитися, їм треба відкрити особисте посилання й натиснути «Почати».
      </p>

      {mine.length > 0 ? (
        <div className="list bot-chats">
          {mine.map((c) => (
            <div key={c.chatId} className="list-item">
              <Avatar name={chatLabel(c)} color={c.blocked ? 'amber' : 'teal'} size={38} />
              <div className="list-main">
                <div className="list-title">{chatLabel(c)}</div>
                <div className="list-sub">
                  {[c.name && c.username ? `@${c.username}` : '', `з ${fmt(c.linkedAt.slice(0, 10), 'd MMMM')}`].filter(Boolean).join(' · ')}
                </div>
              </div>
              {c.blocked && <span className="badge warn">заблокував бота</span>}
              <button className="icon-btn" onClick={() => unlink(c)} aria-label={`Відключити ${chatLabel(c)}`}>
                <X size={18} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="sync-status">
          <Send size={18} />
          <span>Ще ніхто не підключився</span>
        </div>
      )}

      <div className="bot-refresh">
        <button className="link-btn" onClick={() => refreshBot(true)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : undefined} /> Оновити
        </button>
        <span className="faint">Після «Почати» тут з'явиться ім'я з Telegram.</span>
      </div>

      {link && (
        <div className="field" style={{ marginTop: 16 }}>
          <span className="field-label">Посилання</span>
          <input className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Посилання для батьків" />
        </div>
      )}

      <div className="bot-actions">
        <button className="btn btn-ghost btn-sm" disabled={busy || !status?.username} onClick={copyLink}>
          <Copy size={16} /> Лише посилання
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy || !status?.username} onClick={renew}>
          <RefreshCw size={16} /> Нове посилання
        </button>
      </div>

      <p className="field-hint" style={{ marginTop: 10 }}>
        Посилання особисте: хто його відкриє, отримуватиме повідомлення про ці уроки. Якщо воно потрапило не туди, створіть нове, а зайвий чат відключіть хрестиком.
      </p>

      {(problem || (error && !status)) && <p className="sync-error">{problem ?? error}</p>}
    </Sheet>
  );
}
