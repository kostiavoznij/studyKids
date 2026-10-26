import { addDays, addWeeks, parseISO } from 'date-fns';
import { Check, ChevronRight, Clock, CornerUpRight, Pencil, RotateCcw, Trash2, Users, X } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { CANCEL_REASONS, MOVE_REASONS, zoneLabel } from '../data/constants';
import { lessonColor, lessonsByDay, lessonTitle } from '../data/selectors';
import { useData } from '../data/store';
import type { Initiator, Lesson } from '../data/types';
import { dayKey, endStamp, longDay, minutesOf, shortDay, timeInZone, timeOf, zoneDiffers } from '../lib/dates';
import { money } from '../lib/format';
import { Avatar, GradePicker, Segmented, Sheet, StatusBadge, Switch, useNow } from '../ui/components';
import { DraftField, DurationChips } from '../ui/fields';
import { navigate } from '../ui/router';
import { ask, useUi } from '../ui/uiStore';
import { LessonForm } from './LessonForm';

type Step = 'main' | 'move' | 'cancel' | 'edit';

const INITIATORS: { value: Initiator; label: string }[] = [
  { value: 'student', label: 'Учень / батьки' },
  { value: 'teacher', label: 'Я' },
];

export function LessonSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const lesson = useData((s) => s.lessons[id]);
  const students = useData((s) => s.students);
  const groups = useData((s) => s.groups);
  const [step, setStep] = useState<Step>('main');

  if (!lesson || lesson.deletedAt) return null;

  const title = lessonTitle(lesson, students, groups);
  const end = endStamp(lesson.start, lesson.duration);
  const single = !lesson.groupId && lesson.participants.length === 1 ? students[lesson.participants[0].studentId] : undefined;

  const head = (
    <div className="ls-title">
      {single ? (
        <Avatar name={single.name} color={single.color} size={46} />
      ) : (
        <span className="avatar" style={{ width: 46, height: 46, '--c': lessonColor(lesson, students, groups) } as CSSProperties}>
          <Users size={22} />
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <h2>{title}</h2>
        <div className="muted" style={{ fontSize: 14, fontWeight: 600 }}>
          {longDay(lesson.start)} · {timeOf(lesson.start)}–{timeOf(end)}
        </div>
      </div>
    </div>
  );

  return (
    <Sheet title={head} onClose={onClose}>
      {step === 'main' && <MainStep lesson={lesson} onStep={setStep} onClose={onClose} />}
      {step === 'move' && <MoveStep lesson={lesson} onDone={() => setStep('main')} />}
      {step === 'cancel' && <CancelStep lesson={lesson} onDone={() => setStep('main')} onMove={() => setStep('move')} />}
      {step === 'edit' && <LessonForm lesson={lesson} onDone={() => setStep('main')} />}
    </Sheet>
  );
}

/* ---------- Main ---------- */

function MainStep({ lesson, onStep, onClose }: { lesson: Lesson; onStep: (s: Step) => void; onClose: () => void }) {
  const students = useData((s) => s.students);
  const groups = useData((s) => s.groups);
  const markDone = useData((s) => s.markDone);
  const reopen = useData((s) => s.reopen);
  const updateLesson = useData((s) => s.updateLesson);
  const updateParticipant = useData((s) => s.updateParticipant);
  const deleteLesson = useData((s) => s.deleteLesson);
  const putLesson = useData((s) => s.putLesson);
  const notify = useUi((s) => s.notify);
  const now = useNow();
  const isGroup = !!lesson.groupId || lesson.participants.length > 1;
  const first = students[lesson.participants[0]?.studentId];
  const tz = !isGroup && first?.timezone && zoneDiffers(first.timezone) ? first.timezone : '';

  const withUndo = (text: string, action: () => void) => {
    const before = { ...lesson };
    action();
    notify(text, () => putLesson(before));
  };

  const remove = async () => {
    const ok = await ask({
      title: 'Видалити урок?',
      text: 'Краще скасувати — тоді урок залишиться в історії та статистиці. Видалення прибирає його повністю.',
      ok: 'Видалити',
      danger: true,
    });
    if (!ok) return;
    const before = { ...lesson };
    deleteLesson(lesson.id);
    onClose();
    notify('Урок видалено', () => putLesson({ ...before, deletedAt: undefined }));
  };

  const openStudent = (sid: string) => {
    onClose();
    navigate(`/students/${sid}`);
  };

  return (
    <div className="ls-main">
      <div className="ls-status">
        <StatusBadge lesson={lesson} now={now} />
        {lesson.groupId && groups[lesson.groupId] && <span className="badge">Групове заняття</span>}
        {tz && (
          <span className="badge">
            <Clock size={13} /> в учня {timeInZone(lesson.start, tz)} · {zoneLabel(tz)}
          </span>
        )}
      </div>

      {lesson.status === 'planned' && (
        <div className="ls-actions">
          <button className="ls-action done" onClick={() => withUndo('Урок проведено', () => markDone(lesson.id))}>
            <Check size={22} strokeWidth={2.6} />
            Проведено
          </button>
          <button className="ls-action move" onClick={() => onStep('move')}>
            <CornerUpRight size={22} strokeWidth={2.4} />
            Перенести
          </button>
          <button className="ls-action cancel" onClick={() => onStep('cancel')}>
            <X size={22} strokeWidth={2.6} />
            Скасувати
          </button>
        </div>
      )}

      {lesson.status === 'cancelled' && lesson.cancel && (
        <div className="ls-info bad">
          <div>
            <strong>Скасовано {lesson.cancel.by === 'teacher' ? 'мною' : 'учнем'}</strong>
            {lesson.cancel.reason && ` · ${lesson.cancel.reason}`}
            <div className="muted" style={{ fontSize: 13 }}>
              {lesson.cancel.charged ? 'Оплачується (пізнє скасування)' : 'Не оплачується'}
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => withUndo('Урок відновлено', () => reopen(lesson.id))}>
              <RotateCcw size={16} /> Відновити
            </button>
            <button className="btn btn-sm btn-soft" onClick={() => onStep('move')}>
              <CornerUpRight size={16} /> Перенести на інший час
            </button>
          </div>
        </div>
      )}

      {lesson.status === 'done' && (
        <div className="ls-info good">
          <span>
            <strong>Урок проведено</strong>
          </span>
          <button className="link-btn" onClick={() => withUndo('Повернуто в заплановані', () => reopen(lesson.id))}>
            Повернути в заплановані
          </button>
        </div>
      )}

      <div className="field" style={{ marginTop: 18 }}>
        <span className="field-label">Тема уроку</span>
        <DraftField label="Тема уроку" value={lesson.topic} placeholder="Напр.: Відмінки іменників" onCommit={(v) => updateLesson(lesson.id, { topic: v })} />
      </div>
      <div className="field">
        <span className="field-label">Домашнє завдання</span>
        <DraftField label="Домашнє завдання" multiline rows={2} value={lesson.homework} placeholder="Що задали" onCommit={(v) => updateLesson(lesson.id, { homework: v })} />
      </div>

      {!isGroup ? (
        <div className="field">
          <span className="field-label">Засвоєння теми</span>
          <GradePicker value={lesson.participants[0]?.grade} onChange={(g) => updateParticipant(lesson.id, lesson.participants[0].studentId, { grade: g })} />
        </div>
      ) : null}

      <div className="field">
        <span className="field-label">Нотатка</span>
        <DraftField label="Нотатка" multiline rows={2} value={lesson.note} placeholder="Як пройшов урок, на що звернути увагу" onCommit={(v) => updateLesson(lesson.id, { note: v })} />
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>
        <h3>{isGroup ? 'Учасники та оплата' : 'Оплата'}</h3>
      </div>
      <div className="list">
        {lesson.participants.map((p) => {
          const st = students[p.studentId];
          const charged = lesson.status === 'cancelled' ? !!lesson.cancel?.charged : !p.absent;
          return (
            <div key={p.studentId} className="list-item" style={{ flexWrap: 'wrap' }}>
              {isGroup && st && (
                <button onClick={() => openStudent(st.id)} style={{ display: 'contents' }}>
                  <Avatar name={st.name} color={st.color} size={34} />
                </button>
              )}
              <div className="list-main">
                {isGroup && <div className="list-title">{st?.name ?? '—'}</div>}
                <div className={isGroup ? 'list-sub' : 'list-title'}>
                  {money(p.price, p.currency)}
                  {!charged && <span className="faint"> · не оплачується</span>}
                </div>
              </div>
              {charged && (
                <label className="pay-toggle">
                  <span className={p.paid ? 'badge good' : 'badge warn'}>{p.paid ? 'Оплачено' : 'Не оплачено'}</span>
                  <Switch checked={p.paid} label="Оплачено" onChange={(v) => updateParticipant(lesson.id, p.studentId, { paid: v })} />
                </label>
              )}
              {isGroup && (
                <div className="group-extra">
                  <GradePicker value={p.grade} onChange={(g) => updateParticipant(lesson.id, p.studentId, { grade: g })} />
                  <button
                    className="chip sm"
                    aria-pressed={!!p.absent}
                    onClick={() => updateParticipant(lesson.id, p.studentId, { absent: !p.absent })}
                  >
                    {p.absent ? 'Не було на уроці' : 'Відмітити відсутність'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {lesson.moves.length > 0 && (
        <>
          <div className="section-title">
            <h3>Історія перенесень</h3>
          </div>
          <div className="list">
            {lesson.moves.map((m, i) => (
              <div key={i} className="list-item">
                <CornerUpRight size={18} className="faint" style={{ flex: 'none' }} />
                <div className="list-main">
                  <div className="list-title" style={{ fontWeight: 650, fontSize: 14 }}>
                    {shortDay(m.from)} {timeOf(m.from)} → {shortDay(m.to)} {timeOf(m.to)}
                  </div>
                  <div className="list-sub">
                    {m.by === 'teacher' ? 'з моєї ініціативи' : 'попросив учень / батьки'}
                    {m.reason && ` · ${m.reason}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {isSingle(lesson) && first && (
        <button className="list-item card-link" onClick={() => openStudent(first.id)}>
          <Avatar name={first.name} color={first.color} size={34} />
          <div className="list-main">
            <div className="list-title">Сторінка учня</div>
            <div className="list-sub">Історія тем, прогрес, оплати</div>
          </div>
          <ChevronRight size={20} className="faint" />
        </button>
      )}

      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={() => onStep('edit')}>
          <Pencil size={17} /> Змінити
        </button>
        <button className="btn btn-danger-soft" onClick={remove}>
          <Trash2 size={17} /> Видалити
        </button>
      </div>
    </div>
  );
}

const isSingle = (l: Lesson) => !l.groupId && l.participants.length === 1;

/* ---------- Move ---------- */

function MoveStep({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const moveLesson = useData((s) => s.moveLesson);
  const putLesson = useData((s) => s.putLesson);
  const rec = useData((s) => s.lessons);
  const students = useData((s) => s.students);
  const groups = useData((s) => s.groups);
  const notify = useUi((s) => s.notify);
  const base = parseISO(lesson.start);
  const [day, setDay] = useState(dayKey(addDays(base, 1)));
  const [time, setTime] = useState(timeOf(lesson.start));
  const [duration, setDuration] = useState(lesson.duration);
  const [by, setBy] = useState<Initiator>('student');
  const [reason, setReason] = useState('');

  const quick = [
    { label: 'Наступного дня', day: dayKey(addDays(base, 1)) },
    { label: 'Через 2 дні', day: dayKey(addDays(base, 2)) },
    { label: 'Через тиждень', day: dayKey(addWeeks(base, 1)) },
  ];

  const sameDay = (lessonsByDay(rec).get(day) ?? []).filter((l) => l.id !== lesson.id && l.status !== 'cancelled');
  const s = minutesOf(`${day}T${time}`);
  const clash = sameDay.filter((l) => {
    const ls = minutesOf(l.start);
    return s < ls + l.duration && ls < s + duration;
  });

  const submit = () => {
    const to = `${day}T${time}`;
    const before = { ...lesson };
    moveLesson(lesson.id, to, by, reason.trim(), duration);
    notify(`Перенесено на ${shortDay(to)} о ${time}`, () => putLesson(before));
    onDone();
  };

  return (
    <div>
      <div className="step-head">
        <CornerUpRight size={20} />
        <h3>Перенести урок</h3>
      </div>

      <div className="field">
        <span className="field-label">Новий день</span>
        <div className="chips">
          {quick.map((q) => (
            <button key={q.label} className="chip" aria-pressed={q.day === day} onClick={() => setDay(q.day)}>
              {q.label}
            </button>
          ))}
        </div>
        <input className="input" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Дата" />
      </div>

      <div className="row">
        <label className="field">
          <span className="field-label">Час</span>
          <input className="input" type="time" step={900} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
        </label>
      </div>

      <div className="field">
        <span className="field-label">Тривалість</span>
        <DurationChips value={duration} onChange={setDuration} />
      </div>

      <div className="field">
        <span className="field-label">{longDay(day)} — вже заплановано</span>
        {sameDay.length === 0 ? (
          <span className="faint" style={{ fontSize: 14 }}>
            Нічого — день вільний
          </span>
        ) : (
          <div className="chips">
            {sameDay.map((l) => (
              <span key={l.id} className="chip sm" data-clash={clash.includes(l) ? '' : undefined}>
                {timeOf(l.start)} {lessonTitle(l, students, groups)}
              </span>
            ))}
          </div>
        )}
        {clash.length > 0 && (
          <span className="field-hint" style={{ color: 'var(--bad)', fontWeight: 650 }}>
            Перетинається з: {clash.map((l) => lessonTitle(l, students, groups)).join(', ')}
          </span>
        )}
      </div>

      <div className="field">
        <span className="field-label">Хто попросив</span>
        <Segmented label="Хто попросив" value={by} options={INITIATORS} onChange={setBy} />
      </div>

      <div className="field">
        <span className="field-label">Причина (необов'язково)</span>
        <div className="chips">
          {MOVE_REASONS.map((r) => (
            <button key={r} className="chip sm" aria-pressed={reason === r} onClick={() => setReason(reason === r ? '' : r)}>
              {r}
            </button>
          ))}
        </div>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Або напишіть свою" />
      </div>

      <div className="row" style={{ marginTop: 22 }}>
        <button className="btn btn-ghost" onClick={onDone}>
          Назад
        </button>
        <button className="btn btn-primary" onClick={submit}>
          Перенести
        </button>
      </div>
    </div>
  );
}

/* ---------- Cancel ---------- */

function CancelStep({ lesson, onDone, onMove }: { lesson: Lesson; onDone: () => void; onMove: () => void }) {
  const cancelLesson = useData((s) => s.cancelLesson);
  const putLesson = useData((s) => s.putLesson);
  const notify = useUi((s) => s.notify);
  const [by, setBy] = useState<Initiator>('student');
  const [reason, setReason] = useState('');
  const [charged, setCharged] = useState(false);

  const submit = () => {
    const before = { ...lesson };
    cancelLesson(lesson.id, { by, reason: reason.trim(), charged });
    notify('Урок скасовано', () => putLesson(before));
    onDone();
  };

  return (
    <div>
      <div className="step-head">
        <X size={20} />
        <h3>Скасувати урок</h3>
      </div>

      <div className="banner" style={{ marginBottom: 16 }}>
        <CornerUpRight size={20} />
        <span style={{ flex: 1 }}>Домовились на інший час? Тоді краще перенести.</span>
        <button className="btn btn-sm btn-soft" onClick={onMove}>
          Перенести
        </button>
      </div>

      <div className="field">
        <span className="field-label">Хто скасував</span>
        <Segmented label="Хто скасував" value={by} options={INITIATORS} onChange={setBy} />
      </div>

      <div className="field">
        <span className="field-label">Причина (необов'язково)</span>
        <div className="chips">
          {CANCEL_REASONS.map((r) => (
            <button key={r} className="chip sm" aria-pressed={reason === r} onClick={() => setReason(reason === r ? '' : r)}>
              {r}
            </button>
          ))}
        </div>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Або напишіть свою" />
      </div>

      <div className="toggle-row" style={{ marginTop: 10 }}>
        <div>
          <div style={{ fontWeight: 700 }}>Оплачується</div>
          <div className="field-hint">Напр., скасували в останній момент</div>
        </div>
        <Switch checked={charged} onChange={setCharged} label="Оплачується" />
      </div>

      <p className="field-hint" style={{ marginTop: 8 }}>
        Урок залишиться в історії учня та статистиці скасувань
        {charged ? ' і піде в дохід.' : ', але не піде в дохід.'}
      </p>

      <div className="row" style={{ marginTop: 22 }}>
        <button className="btn btn-ghost" onClick={onDone}>
          Назад
        </button>
        <button className="btn btn-danger" onClick={submit}>
          Скасувати урок
        </button>
      </div>
    </div>
  );
}
