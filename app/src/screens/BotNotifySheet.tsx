import { Send } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { sendBot, useBot, useBotResult, type SendSummary } from '../data/bot';
import { BUILT_IN, dayPhrase, lessonLines, ownTemplates, periodPhrase, PLACEHOLDERS, renderBot, shortLesson, templateText, timePhrase, type BotValues } from '../data/botText';
import { todayKey } from '../lib/dates';
import { useData } from '../data/store';
import { teacherById, teacherOf } from '../data/teachers';
import type { BotKind, ID, Lesson, Student } from '../data/types';
import { Sheet, Switch } from '../ui/components';
import { useUi } from '../ui/uiStore';

/*
 * «Повідомити батьків»: one text for everyone it concerns, each family getting
 * it with its own name, dates and times. Offered right after she cancels a
 * lesson or marks days off — and «Не надсилати» is always one tap away, so the
 * cancellation itself never waits on it.
 */

export interface NotifyRequest {
  mode: BotKind;
  /** the cancelled lessons ('cancel', 'cancelMany') */
  lessonIds?: ID[];
  /** whom to write to ('free') */
  studentIds?: ID[];
  /** the days off ('cancelMany') */
  from?: string;
  to?: string;
  reason?: string;
  /** where the lesson was before it moved ('move') */
  was?: string;
}

interface Family {
  student: Student;
  values: BotValues;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const FREE_START = 'Добрий день! ';

export function BotNotifySheet({ req, onClose }: { req: NotifyRequest; onClose: () => void }) {
  const data = useData();
  const chats = useBot((s) => s.chats);
  const notify = useUi((s) => s.notify);
  const saveBotTemplate = useData((s) => s.saveBotTemplate);
  const area = useRef<HTMLTextAreaElement>(null);

  const families = useMemo(() => familiesFor(req, data), [req, data]);
  const withBot = families.filter((f) => chats.some((c) => c.studentId === f.student.id && !c.blocked));
  const without = families.filter((f) => !withBot.includes(f));

  const builtIn = req.mode === 'free' || req.mode === 'reminder' ? null : req.mode;
  const stored = builtIn ? templateText(data.botTemplates, builtIn) : FREE_START;
  const [text, setText] = useState(stored);
  const [remember, setRemember] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const own = ownTemplates(data.botTemplates);

  const preview = (withBot[0] ?? families[0]) as Family | undefined;
  const tokens = PLACEHOLDERS.filter((p) => p.kinds.includes(req.mode));

  const insert = (token: string) => {
    const el = area.current;
    const at = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const next = text.slice(0, at) + token + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const send = async () => {
    setSending(true);
    setProblem(undefined);
    try {
      const results = await sendBot(
        req.mode,
        withBot.map((f) => ({ studentId: f.student.id, text: renderBot(text, f.values) })),
      );
      if (builtIn && remember && text.trim() !== stored.trim()) saveBotTemplate({ kind: builtIn, name: BUILT_IN[builtIn].name, text: text.trim() });
      const got = new Set(results.filter((r) => r.sent > 0).map((r) => r.studentId));
      const summary: SendSummary = {
        sent: got.size,
        total: families.length,
        manual: without.map((f) => ({ studentId: f.student.id, name: f.student.name, text: renderBot(text, f.values) })),
        failed: withBot
          .filter((f) => !got.has(f.student.id))
          .map((f) => ({
            studentId: f.student.id,
            name: f.student.name,
            text: renderBot(text, f.values),
            blocked: !!results.find((r) => r.studentId === f.student.id)?.blocked,
          })),
      };
      onClose();
      if (summary.manual.length || summary.failed.length) useBotResult.setState({ summary });
      else notify(`Надіслано через бота: ${summary.sent}`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const saveOwn = () => {
    const name = (newName ?? '').trim();
    if (!name || !text.trim()) return;
    saveBotTemplate({ kind: 'free', name, text: text.trim() });
    setNewName(null);
    notify(`Шаблон «${name}» збережено`);
  };

  const title = req.mode === 'free' ? 'Написати батькам' : 'Повідомити батьків?';

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <div className="bot-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Не надсилати
          </button>
          <button className="btn btn-primary" disabled={sending || !text.trim() || withBot.length === 0} onClick={send}>
            <Send size={17} /> {sending ? 'Надсилаю…' : `Надіслати (${withBot.length})`}
          </button>
        </div>
      }
    >
      {req.mode === 'free' && own.length > 0 && (
        <div className="field">
          <span className="field-label">Мої шаблони</span>
          <div className="chips">
            {own.map((t) => (
              <button key={t.id} className="chip sm" aria-pressed={text === t.text} onClick={() => setText(t.text)}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="field">
        <span className="field-label">Текст</span>
        <textarea ref={area} className="textarea bot-text" rows={req.mode === 'cancelMany' ? 6 : 4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {tokens.length > 1 && (
        <div className="bot-tokens">
          <span className="faint">Вставити:</span>
          {tokens.map((p) => (
            <button key={p.token} className="chip sm" onClick={() => insert(p.token)} title={p.token}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Only when something gets filled in: otherwise it would just repeat the text. */}
      {preview && (families.length > 1 || renderBot(text, preview.values) !== text.trim()) && (
        <div className="bot-preview">
          <span className="field-label">
            Так побачать батьки{families.length > 1 ? ` (${preview.student.name})` : ''}
          </span>
          <div className="bot-bubble">{renderBot(text, preview.values) || '…'}</div>
          {families.length > 1 && <span className="field-hint">Кожна сім'я отримає текст зі своїм ім'ям і своїми уроками.</span>}
        </div>
      )}

      <div className="bot-recipients">
        {withBot.length > 0 && (
          <p>
            <b>Отримають через бота:</b> {withBot.map((f) => f.student.name).join(', ')}
          </p>
        )}
        {without.length > 0 && (
          <p className="faint">
            Без бота: {without.map((f) => f.student.name).join(', ')}. Їхній текст буде під рукою після надсилання, щоб передати його самим.
          </p>
        )}
      </div>

      {builtIn && text.trim() !== stored.trim() && (
        <div className="toggle-row">
          <div>
            <div style={{ fontWeight: 700 }}>Запам'ятати цей текст</div>
            <div className="field-hint">Наступного разу він буде тут одразу.</div>
          </div>
          <Switch checked={remember} onChange={setRemember} label="Запам'ятати цей текст" />
        </div>
      )}

      {req.mode === 'free' &&
        (newName === null ? (
          <button className="link-btn" style={{ marginTop: 12 }} disabled={!text.trim() || text.trim() === FREE_START.trim()} onClick={() => setNewName('')}>
            + Зберегти як шаблон
          </button>
        ) : (
          <div className="bot-save-row">
            <input className="input" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Назва, напр.: Оплата" aria-label="Назва шаблону" />
            <button className="btn btn-soft btn-sm" disabled={!newName.trim()} onClick={saveOwn}>
              Зберегти
            </button>
          </div>
        ))}

      {problem && <p className="sync-error">{problem}</p>}
    </Sheet>
  );
}

/** Everyone a request concerns, with the values for their text. */
function familiesFor(req: NotifyRequest, d: ReturnType<typeof useData.getState>): Family[] {
  const live = (id: ID) => (d.students[id] && !d.students[id].deletedAt ? d.students[id] : undefined);
  const teacherName = (l: Lesson) => teacherById(d.teachers, teacherOf(l)).name;
  const out: Family[] = [];

  if (req.mode === 'free') {
    for (const id of req.studentIds ?? []) {
      const st = live(id);
      if (st) out.push({ student: st, values: { name: st.name } });
    }
    return out;
  }

  const lessons = (req.lessonIds ?? []).map((id) => d.lessons[id]).filter((l): l is Lesson => !!l && !l.deletedAt);

  if (req.mode === 'cancel' || req.mode === 'move') {
    for (const l of lessons) {
      const reason = req.reason ?? (req.mode === 'move' ? (l.moves[l.moves.length - 1]?.reason ?? '') : (l.cancel?.reason ?? ''));
      for (const p of l.participants) {
        const st = live(p.studentId);
        if (!st || out.some((f) => f.student.id === st.id)) continue;
        out.push({
          student: st,
          values: {
            name: st.name,
            date: dayPhrase(l.start.slice(0, 10), todayKey()),
            time: timePhrase(l.start, st.timezone),
            teacher: teacherName(l),
            reason: lowerFirst(reason),
            was: req.was ? shortLesson(req.was, st.timezone) : '',
          },
        });
      }
    }
    return out;
  }

  // cancelMany: each family gets its own lessons from those days
  const byStudent = new Map<ID, Lesson[]>();
  for (const l of lessons) for (const p of l.participants) byStudent.set(p.studentId, [...(byStudent.get(p.studentId) ?? []), l]);
  const days = lessons.map((l) => l.start.slice(0, 10)).sort();
  const from = req.from ?? days[0] ?? '';
  const to = req.to ?? days[days.length - 1] ?? from;
  for (const [id, ls] of byStudent) {
    const st = live(id);
    if (!st) continue;
    out.push({
      student: st,
      values: {
        name: st.name,
        period: from ? periodPhrase(from, to, todayKey()) : '',
        lessons: lessonLines(ls.map((l) => l.start), st.timezone),
        teacher: ls[0] ? teacherName(ls[0]) : '',
        reason: lowerFirst(req.reason ?? ''),
      },
    });
  }
  return out.sort((a, b) => a.student.name.localeCompare(b.student.name, 'uk'));
}

