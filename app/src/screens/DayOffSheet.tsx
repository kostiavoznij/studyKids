import { Backpack, Coffee, PartyPopper, StickyNote, Thermometer, TreePalm, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { DAY_OFF_KINDS, dayOffLabel } from '../data/constants';
import { lessonTitle, liveLessons } from '../data/selectors';
import { useData } from '../data/store';
import type { DayOffKind, ID } from '../data/types';
import { shortDay, timeOf, todayKey } from '../lib/dates';
import { LESSONS, nPlural } from '../lib/format';
import { Sheet, Switch } from '../ui/components';
import { ask, useUi } from '../ui/uiStore';

export const DAY_OFF_ICONS: Record<DayOffKind, LucideIcon> = {
  dayoff: Coffee,
  vacation: TreePalm,
  sick: Thermometer,
  holiday: PartyPopper,
  break: Backpack,
  other: StickyNote,
};

/** Mark a day (or a few) without lessons and say why. */
export function DayOffSheet({ id, day, onClose }: { id?: ID; day?: string; onClose: () => void }) {
  const existing = useData((s) => (id ? s.daysOff[id] : undefined));
  const rec = useData((s) => s.lessons);
  const students = useData((s) => s.students);
  const groups = useData((s) => s.groups);
  const saveDayOff = useData((s) => s.saveDayOff);
  const deleteDayOff = useData((s) => s.deleteDayOff);
  const putLesson = useData((s) => s.putLesson);
  const notify = useUi((s) => s.notify);

  const start = existing?.from ?? day ?? todayKey();
  const [kind, setKind] = useState<DayOffKind>(existing?.kind ?? 'sick');
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(existing?.to ?? start);
  const [note, setNote] = useState(existing?.note ?? '');
  const [cancel, setCancel] = useState(existing?.cancelLessons ?? true);

  const last = to < from ? from : to;
  const affected = liveLessons(rec).filter((l) => l.status === 'planned' && l.start.slice(0, 10) >= from && l.start.slice(0, 10) <= last);

  const save = () => {
    const before = affected.map((l) => ({ ...l }));
    const savedId = saveDayOff({ ...(existing ?? {}), kind, from, to: last, note: note.trim(), cancelLessons: cancel });
    const cancelled = cancel ? before.length : 0;
    notify(
      `${dayOffLabel(kind)}${cancelled ? ` · скасовано ${nPlural(cancelled, LESSONS)}` : ''}`,
      existing
        ? undefined
        : () => {
            useData.setState((s) => ({ daysOff: { ...s.daysOff, [savedId]: { ...s.daysOff[savedId], deletedAt: Date.now(), updatedAt: Date.now() } } }));
            if (cancel) before.forEach(putLesson);
          },
    );
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await ask({
      title: 'Прибрати позначку?',
      text: 'Майбутні уроки, які скасувались через неї, знову стануть запланованими.',
      ok: 'Прибрати',
    });
    if (!ok) return;
    deleteDayOff(existing.id);
    notify('Позначку прибрано');
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'Дні без уроків' : 'Позначити день'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={save}>
          Зберегти
        </button>
      }
    >
      <div className="field">
        <span className="field-label">Чому немає уроків</span>
        <div className="dayoff-kinds">
          {DAY_OFF_KINDS.map((k) => {
            const Icon = DAY_OFF_ICONS[k.value];
            return (
              <button key={k.value} className="dayoff-kind" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
                <Icon size={20} />
                {k.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="row">
        <label className="field">
          <span className="field-label">З</span>
          <input
            className="input"
            type="date"
            value={from}
            onChange={(e) => {
              if (!e.target.value) return;
              setFrom(e.target.value);
              if (to < e.target.value) setTo(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">По</span>
          <input className="input" type="date" value={last} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field-label">Коментар (необов'язково)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр.: поїздка до батьків" />
      </label>

      <div className="toggle-row weekly-row">
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Скасувати уроки в ці дні{affected.length ? ` · ${affected.length}` : ''}</div>
          <div className="field-hint">
            {affected.length
              ? affected
                  .slice(0, 4)
                  .map((l) => `${shortDay(l.start)} ${timeOf(l.start)} ${lessonTitle(l, students, groups)}`)
                  .join(', ') + (affected.length > 4 ? '…' : '')
              : 'Уроки з постійного розкладу на ці дні теж з’являться вже скасованими'}
          </div>
        </div>
        <Switch checked={cancel} onChange={setCancel} label="Скасувати уроки" />
      </div>

      {existing && (
        <button className="btn btn-ghost btn-block" style={{ marginTop: 18 }} onClick={remove}>
          Прибрати позначку
        </button>
      )}
    </Sheet>
  );
}
