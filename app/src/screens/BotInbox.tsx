import { MessageCircleReply, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { inboxLink, inboxList, inboxUnlink, useBot, type InboxChat } from '../data/bot';
import { useAccount } from '../data/cloud';
import { fmt } from '../lib/dates';
import { Avatar } from '../ui/components';
import { ask, useUi } from '../ui/uiStore';

/*
 * «Відповіді батьків»: whose Telegram gets what families write to the bot. Each
 * admin or manager connects their own; replying there sends the answer back.
 * Until someone connects, the bot tells families that nobody reads replies.
 */
export function BotInbox() {
  const me = useAccount((s) => s.email ?? '');
  const username = useBot((s) => s.status?.username);
  const notify = useUi((s) => s.notify);
  const [list, setList] = useState<InboxChat[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const load = useCallback(async () => {
    try {
      setList(await inboxList());
      setProblem(undefined);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    // Back from Telegram after pressing «Почати»: show the new connection.
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const link = await inboxLink();
      window.open(link, '_blank', 'noopener');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (c: InboxChat) => {
    const ok = await ask({
      title: `Відключити ${c.name || c.email}?`,
      text: 'Повідомлення від батьків більше не надходитимуть у цей Telegram.',
      ok: 'Відключити',
      danger: true,
    });
    if (!ok) return;
    try {
      await inboxUnlink(c.chatId);
      notify('Відключено');
      load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const mine = list?.some((c) => c.email === me);

  return (
    <div className="bot-inbox">
      <p className="muted" style={{ fontSize: 14, margin: '0 0 10px' }}>
        Коли батьки напишуть боту, повідомлення прийде вам у Telegram від @{username}. Щоб відповісти, відповідайте на нього (свайп вліво чи
        «Відповісти»), і бот передасть вашу відповідь батькам.
      </p>

      {list && list.length > 0 && (
        <div className="list">
          {list.map((c) => (
            <div key={c.chatId} className="list-item">
              <Avatar name={c.name || c.email} color="violet" size={36} />
              <div className="list-main">
                <div className="list-title">
                  {c.name || c.email}
                  {c.email === me ? ' · ви' : ''}
                </div>
                <div className="list-sub">
                  {c.email} · з {fmt(c.linkedAt.slice(0, 10), 'd MMMM')}
                </div>
              </div>
              <button className="icon-btn" onClick={() => unlink(c)} aria-label={`Відключити ${c.name || c.email}`}>
                <X size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
      {list && list.length === 0 && <p className="field-hint">Поки ніхто не отримує відповідей — бот каже батькам писати вчительці напряму.</p>}

      <div className="bot-actions">
        {!mine && (
          <button className="btn btn-soft" disabled={busy || !username} onClick={connect}>
            <MessageCircleReply size={17} /> Отримувати в мій Telegram
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={load}>
          <RefreshCw size={16} /> Оновити
        </button>
      </div>
      {!mine && <p className="field-hint">Відкриється Telegram — натисніть там «Почати». Підключайте лише свій Telegram.</p>}

      {problem && <p className="sync-error">{problem}</p>}
    </div>
  );
}
