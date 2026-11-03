import { CircleCheck, Copy, X } from 'lucide-react';
import { useBotResult } from '../data/bot';
import { useUi } from './uiStore';

/*
 * After the bot sent something and not everyone got it: who to tell some other
 * way, with their text one tap from the clipboard. Nothing has to be done here —
 * the card waits until she closes it.
 */
export function BotResultHost() {
  const summary = useBotResult((s) => s.summary);
  const notify = useUi((s) => s.notify);
  if (!summary) return null;
  const close = () => useBotResult.setState({ summary: null });

  const copy = async (name: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`Текст скопійовано (${name})`);
    } catch {
      notify('Не вдалося скопіювати');
    }
  };

  return (
    <div className="bot-result" role="status">
      <div className="bot-result-head">
        <CircleCheck size={18} />
        <b>
          Надіслано {summary.sent} з {summary.total}
        </b>
        <button className="icon-btn" onClick={close} aria-label="Закрити">
          <X size={18} />
        </button>
      </div>
      {summary.manual.length > 0 && (
        <div className="bot-result-part">
          <span>Без бота — натисніть ім'я, щоб скопіювати текст, і передайте самі:</span>
          <div className="chips">
            {summary.manual.map((m) => (
              <button key={m.studentId} className="chip sm" onClick={() => copy(m.name, m.text)} title="Скопіювати текст">
                <Copy size={13} /> {m.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {summary.failed.length > 0 && (
        <div className="bot-result-part">
          <span>Не дійшло — текст можна скопіювати так само:</span>
          <div className="chips">
            {summary.failed.map((m) => (
              <button key={m.studentId} className="chip sm" onClick={() => copy(m.name, m.text)} title="Скопіювати текст">
                <Copy size={13} /> {m.name}
                {m.blocked ? ' · заблокував бота' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
