import { CircleCheck, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { chatLabel, chatsOf, inviteLink, inviteText, invitedOn, markInvited, refreshBot, shareOrCopy, useBot } from '../data/bot';
import { useLiveStudents } from '../data/selectors';
import type { ID, Student } from '../data/types';
import { fmt, todayKey } from '../lib/dates';
import { Avatar, Sheet } from '../ui/components';
import { useUi } from '../ui/uiStore';

/*
 * All the families at once: who is connected, who already got an invitation,
 * and a «Надіслати» for each of the rest — instead of opening every student's
 * card. The links are fetched as the sheet opens, so each tap goes straight to
 * the share sheet (an iPhone won't open it from a tap that waited).
 */
export function BotInviteSheet({ onClose }: { onClose: () => void }) {
  const all = useLiveStudents();
  const chats = useBot((s) => s.chats);
  const notify = useUi((s) => s.notify);
  const students = useMemo(() => all.filter((s) => s.status !== 'archived'), [all]);
  const [links, setLinks] = useState<Record<ID, string>>({});
  const [invited, setInvited] = useState(invitedOn);
  const [problem, setProblem] = useState<string>();

  const ids = students.map((s) => s.id).join(',');
  useEffect(() => {
    refreshBot(true);
    let alive = true;
    Promise.all(students.map((s) => inviteLink(s.id).then((l) => [s.id, l] as const)))
      .then((pairs) => alive && setLinks(Object.fromEntries(pairs)))
      .catch((e) => alive && setProblem(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // keyed by the ids: the same students keep the same links
  }, [ids]);

  const connected = (id: ID) => chatsOf(chats, id).filter((c) => !c.blocked);
  const rank = (s: Student) => (connected(s.id).length ? 2 : invited[s.id] ? 1 : 0);
  const rows = students.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'uk'));
  const done = students.filter((s) => connected(s.id).length).length;

  const send = (st: Student) => {
    const link = links[st.id];
    if (!link) return;
    shareOrCopy(inviteText(st.name, link)).then((r) => {
      if (r === 'shared' || r === 'copied') setInvited(markInvited(st.id, todayKey()));
      if (r === 'copied') notify(`Запрошення скопійовано (${st.name}) — вставте його в чат з батьками`);
      if (r === 'failed') notify('Не вдалося — спробуйте з картки учня');
    });
  };

  return (
    <Sheet title="Запросити батьків" onClose={onClose}>
      <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
        Кожна сім'я отримує своє посилання. «Надіслати» відкриває, куди переслати (Viber, Telegram…), а на комп'ютері копіює текст. Коли батьки
        натиснуть «Почати», учень позначиться як підключений.
      </p>
      <div className="sync-status good" style={{ marginBottom: 12 }}>
        <CircleCheck size={18} />
        <span>
          Підключено {done} з {students.length}
        </span>
      </div>

      <div className="list bot-invites">
        {rows.map((st) => {
          const conn = connected(st.id);
          return (
            <div key={st.id} className="list-item">
              <Avatar name={st.name} color={st.color} size={36} />
              <div className="list-main">
                <div className="list-title">{st.name}</div>
                <div className="list-sub">
                  {conn.length
                    ? `підключено: ${conn.map(chatLabel).join(', ')}`
                    : invited[st.id]
                      ? `запрошення надіслано ${fmt(invited[st.id], 'd MMMM')}`
                      : 'ще не запрошено'}
                </div>
              </div>
              {conn.length ? (
                <CircleCheck size={20} className="bot-invite-done" aria-label="Підключено" />
              ) : (
                <button className="btn btn-soft btn-sm" disabled={!links[st.id]} onClick={() => send(st)}>
                  <Send size={15} /> {invited[st.id] ? 'Ще раз' : 'Надіслати'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="field-hint" style={{ marginTop: 10 }}>
        Позначка «надіслано» — лише на цьому пристрої. Другого з батьків можна запросити з картки учня: «Бот підключено» → «Запросити ще когось».
      </p>
      {problem && <p className="sync-error">{problem}</p>}
    </Sheet>
  );
}
