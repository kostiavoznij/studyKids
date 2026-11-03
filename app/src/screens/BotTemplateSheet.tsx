import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { BUILT_IN, PLACEHOLDERS, renderBot, sampleValues, templateText } from '../data/botText';
import { useLiveStudents } from '../data/selectors';
import { useData } from '../data/store';
import { teacherById } from '../data/teachers';
import { MAIN_TEACHER, type BotKind, type ID } from '../data/types';
import { Sheet } from '../ui/components';
import { ask, useUi } from '../ui/uiStore';

/*
 * One of the bot's texts: a built-in one (shown when she cancels a lesson or
 * marks days off) or her own for free messages. The preview fills in example
 * values, so the braces never have to be guessed.
 */
export function BotTemplateSheet({ id, kind, onClose }: { id?: ID; kind: BotKind; onClose: () => void }) {
  const rec = useData((s) => s.botTemplates);
  const teachers = useData((s) => s.teachers);
  const saveBotTemplate = useData((s) => s.saveBotTemplate);
  const deleteBotTemplate = useData((s) => s.deleteBotTemplate);
  const notify = useUi((s) => s.notify);
  const student = useLiveStudents().find((s) => s.status === 'active');
  const area = useRef<HTMLTextAreaElement>(null);

  const builtIn = kind === 'free' ? null : kind;
  const existing = id ? rec[id] : builtIn ? rec[builtIn] : undefined;
  const edited = !!existing && !existing.deletedAt;
  const [name, setName] = useState(builtIn ? BUILT_IN[builtIn].name : (existing?.name ?? ''));
  const [text, setText] = useState(builtIn ? templateText(rec, builtIn) : (existing?.text ?? 'Добрий день! '));
  const tokens = PLACEHOLDERS.filter((p) => p.kinds.includes(kind));
  const sample = sampleValues(student, teacherById(teachers, MAIN_TEACHER).name);

  const insert = (token: string) => {
    const el = area.current;
    const at = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    setText(text.slice(0, at) + token + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const save = () => {
    if (!text.trim() || !name.trim()) return;
    saveBotTemplate({ id: builtIn ? undefined : id, kind, name: name.trim(), text: text.trim() });
    notify('Шаблон збережено');
    onClose();
  };

  const reset = async () => {
    if (!builtIn) return;
    const ok = await ask({ title: 'Повернути стандартний текст?', text: 'Ваш текст цього шаблону буде замінено стандартним.', ok: 'Повернути' });
    if (!ok) return;
    deleteBotTemplate(builtIn);
    notify('Повернуто стандартний текст');
    onClose();
  };

  const remove = async () => {
    if (!id) return;
    const ok = await ask({ title: `Видалити шаблон «${existing?.name ?? ''}»?`, ok: 'Видалити', danger: true });
    if (!ok) return;
    deleteBotTemplate(id);
    notify('Шаблон видалено');
    onClose();
  };

  return (
    <Sheet
      title={builtIn ? BUILT_IN[builtIn].name : id ? 'Мій шаблон' : 'Новий шаблон'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!text.trim() || !name.trim()} onClick={save}>
          Зберегти
        </button>
      }
    >
      {builtIn ? (
        <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
          {BUILT_IN[builtIn].when} Перед надсиланням текст завжди можна змінити.
        </p>
      ) : (
        <label className="field">
          <span className="field-label">Назва</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр.: Оплата" autoFocus={!id} />
        </label>
      )}

      <label className="field">
        <span className="field-label">Текст</span>
        <textarea ref={area} className="textarea bot-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {tokens.length > 0 && (
        <div className="bot-tokens">
          <span className="faint">Вставити:</span>
          {tokens.map((p) => (
            <button key={p.token} className="chip sm" onClick={() => insert(p.token)} title={p.token}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <p className="field-hint">У фігурних дужках — те, що застосунок підставить для кожної сім'ї.</p>

      <div className="bot-preview">
        <span className="field-label">Приклад</span>
        <div className="bot-bubble">{renderBot(text, sample) || '…'}</div>
      </div>

      {builtIn && edited && (
        <button className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={reset}>
          Повернути стандартний текст
        </button>
      )}
      {!builtIn && id && (
        <button className="btn btn-danger-soft btn-block" style={{ marginTop: 16 }} onClick={remove}>
          <Trash2 size={17} /> Видалити шаблон
        </button>
      )}
    </Sheet>
  );
}
