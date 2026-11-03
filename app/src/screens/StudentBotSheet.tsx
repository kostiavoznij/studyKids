import { CircleAlert, CircleCheck, Copy, CornerDownLeft, CornerUpRight, MessageSquareText, RefreshCw, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  botHistory,
  chatLabel,
  chatsOf,
  inviteLink,
  inviteText,
  markInvited,
  refreshBot,
  shareOrCopy,
  unlinkChat,
  useBot,
  type BotChat,
  type HistoryItem,
} from '../data/bot';
import type { Student } from '../data/types';
import { fmt, todayKey } from '../lib/dates';
import { Avatar, Sheet, Switch } from '../ui/components';
import { reminderLabel, reminderSchedule } from '../data/botText';
import { useData } from '../data/store';
import { useSaveSchedule } from './BotReminders';
import { ask, useUi } from '../ui/uiStore';

/*
 * One student and the bot: who of the family is connected, and the personal
 * link to invite the rest. Sending the invitation is up to her — the app only
 * prepares the text, ready to paste where she already talks to the parents.
 */

export function StudentBotSheet({ student, onClose, onWrite }: { student: Student; onClose: () => void; onWrite: () => void }) {
  const { status, chats, loading, error } = useBot();
  const notify = useUi((s) => s.notify);
  const mine = chatsOf(chats, student.id);
  const [link, setLink] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const reachable = mine.some((c) => !c.blocked);
  const schedule = reminderSchedule(useData((s) => s.botTemplates));
  const saveSchedule = useSaveSchedule();
  const reminded = schedule.who === 'all' || schedule.students.includes(student.id);
  const when = [...schedule.before.map(reminderLabel), ...(schedule.evening ? [`напередодні о ${schedule.evening}`] : [])].join(', ');

  useEffect(() => {
    refreshBot(true);
    botHistory(student.id)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [student.id]);

  // The link is ready before any tap: sharing and copying must follow the tap at once.
  const username = status?.username;
  useEffect(() => {
    if (!username) return;
    let alive = true;
    inviteLink(student.id)
      .then((l) => alive && setLink(l))
      .catch((e) => alive && setProblem(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [student.id, username]);

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

  const invite = () => {
    if (!link) return;
    shareOrCopy(inviteText(student.name, link)).then((r) => {
      if (r === 'shared' || r === 'copied') markInvited(student.id, todayKey());
      if (r === 'copied') notify('Запрошення скопійовано — вставте його в чат з батьками');
      if (r === 'failed') notify('Не вдалося скопіювати — виділіть посилання нижче');
    });
  };

  const copyLink = () => {
    if (!link) return;
    navigator.clipboard.writeText(link).then(
      () => notify('Посилання скопійовано'),
      () => notify('Не вдалося скопіювати — виділіть посилання нижче'),
    );
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
        <button className="btn btn-primary" disabled={busy || !link} onClick={invite}>
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
        <button className="btn btn-ghost btn-sm" disabled={busy || !link} onClick={copyLink}>
          <Copy size={16} /> Лише посилання
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy || !status?.username} onClick={renew}>
          <RefreshCw size={16} /> Нове посилання
        </button>
      </div>

      <p className="field-hint" style={{ marginTop: 10 }}>
        Посилання особисте: хто його відкриє, отримуватиме повідомлення про ці уроки. Якщо воно потрапило не туди, створіть нове, а зайвий чат відключіть хрестиком.
      </p>

      {reachable && schedule.enabled && (
        <div className="toggle-row" style={{ marginTop: 14 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Нагадування перед уроками</div>
            <div className="field-hint">
              {schedule.who === 'all' ? 'Отримують усі, хто підключив бота' : when ? `Бот нагадає ${when}` : 'Час нагадувань — у Налаштуваннях'}
            </div>
          </div>
          {schedule.who === 'chosen' && (
          <Switch
            checked={reminded}
            onChange={(on) =>
              saveSchedule({
                ...schedule,
                students: on ? [...new Set([...schedule.students, student.id])] : schedule.students.filter((x) => x !== student.id),
              })
            }
            label="Нагадування перед уроками"
          />
          )}
        </div>
      )}

      {reachable && (
        <button className="btn btn-soft btn-block" style={{ marginTop: 16 }} onClick={onWrite}>
          <MessageSquareText size={18} /> Написати батькам
        </button>
      )}

      {history && history.length > 0 && (
        <div className="bot-history">
          <span className="field-label">Останні повідомлення</span>
          {history.slice(0, 5).map((h, i) => (
            <div key={i} className="bot-history-item" data-status={h.status}>
              {h.status === 'received' ? (
                <CornerDownLeft size={15} />
              ) : h.kind === 'answer' && h.status === 'sent' ? (
                <CornerUpRight size={15} />
              ) : h.status === 'sent' ? (
                <CircleCheck size={15} />
              ) : (
                <CircleAlert size={15} />
              )}
              <div>
                <div className="faint">
                  {fmt(h.at.slice(0, 10), 'd MMMM')}, {new Date(h.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
                  {h.status === 'received' ? ` · від батьків${h.sentBy ? ` (${h.sentBy})` : ''}` : h.kind === 'answer' ? ' · ваша відповідь' : h.kind === 'reminder' ? ' · нагадування' : ''}
                  {h.status === 'blocked' ? ' · заблокував бота' : h.status === 'failed' ? ' · не дійшло' : ''}
                </div>
                <div className="bot-history-text">{h.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(problem || (error && !status)) && <p className="sync-error">{problem ?? error}</p>}
    </Sheet>
  );
}
