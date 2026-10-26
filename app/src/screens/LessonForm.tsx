import { parseISO } from 'date-fns';
import { Repeat, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { lessonsByDay, lessonTitle, useLiveGroups, useLiveStudents } from '../data/selectors';
import { studentSlotKey } from '../data/schedule';
import { useData } from '../data/store';
import type { Currency, ID, Lesson, Participant } from '../data/types';
import { isoWeekday, minutesOf, timeOf, todayKey, WEEKDAYS_LONG } from '../lib/dates';
import { uid } from '../lib/format';
import { Avatar, Empty, Segmented, Sheet, Switch } from '../ui/components';
import { DurationChips, PriceField, StudentChips } from '../ui/fields';
import { useUi } from '../ui/uiStore';

type Mode = 'one' | 'group';

interface Prefill {
  start?: string;
  studentId?: ID;
  groupId?: ID;
}

export function NewLessonSheet({ prefill, onClose }: { prefill: Prefill; onClose: () => void }) {
  return (
    <Sheet title="Новий урок" onClose={onClose}>
      <LessonForm prefill={prefill} onDone={onClose} />
    </Sheet>
  );
}

/** Create a lesson, or edit time/participants/price of an existing one. */
export function LessonForm({ lesson, prefill, onDone }: { lesson?: Lesson; prefill?: Prefill; onDone: () => void }) {
  const studentsRec = useData((s) => s.students);
  const groupsRec = useData((s) => s.groups);
  const rec = useData((s) => s.lessons);
  const settings = useData((s) => s.settings);
  const createLesson = useData((s) => s.createLesson);
  const updateLesson = useData((s) => s.updateLesson);
  const saveStudent = useData((s) => s.saveStudent);
  const notify = useUi((s) => s.notify);
  const open = useUi((s) => s.open);
  const setDay = useUi((s) => s.setDay);

  const inLesson = (id: ID) => !!lesson?.participants.some((p) => p.studentId === id);
  const students = useLiveStudents().filter((s) => s.status === 'active' || inLesson(s.id));
  const groups = useLiveGroups().filter((g) => g.status === 'active' || g.id === lesson?.groupId);

  const initStart = lesson?.start ?? prefill?.start ?? `${todayKey()}T14:00`;
  const preGroup = prefill?.groupId ? groupsRec[prefill.groupId] : undefined;
  const preStudent = prefill?.studentId ? studentsRec[prefill.studentId] : undefined;

  const [day, setDayValue] = useState(initStart.slice(0, 10));
  const [time, setTime] = useState(timeOf(initStart));
  const [mode, setMode] = useState<Mode>(
    lesson ? (lesson.groupId || lesson.participants.length > 1 ? 'group' : 'one') : preGroup ? 'group' : 'one',
  );
  const [ids, setIds] = useState<ID[]>(
    lesson ? lesson.participants.map((p) => p.studentId) : preGroup ? preGroup.studentIds : preStudent ? [preStudent.id] : [],
  );
  const [groupId, setGroupId] = useState<ID | undefined>(lesson?.groupId ?? preGroup?.id);
  const [duration, setDuration] = useState(lesson?.duration ?? preGroup?.duration ?? preStudent?.duration ?? settings.defaultDuration);
  const firstP = lesson?.participants[0];
  const [price, setPrice] = useState<number>(firstP?.price ?? preGroup?.price ?? preStudent?.price ?? settings.defaultPrice);
  const [currency, setCurrency] = useState<Currency>(
    firstP?.currency ?? preGroup?.currency ?? preStudent?.currency ?? settings.baseCurrency,
  );
  const [topic, setTopic] = useState(lesson?.topic ?? '');
  const [weekly, setWeekly] = useState(false);

  if (students.length === 0) {
    return (
      <Empty icon={<UserPlus size={36} />} title="Ще немає учнів">
        <p style={{ marginBottom: 12 }}>Додайте першого учня — і можна планувати уроки.</p>
        <button className="btn btn-primary" onClick={() => open({ kind: 'student' })}>
          Додати учня
        </button>
      </Empty>
    );
  }

  const pickOne = (id: ID) => {
    const st = studentsRec[id];
    setIds([id]);
    setGroupId(undefined);
    if (!lesson && st) {
      setDuration(st.duration);
      setPrice(st.price);
      setCurrency(st.currency);
    }
  };
  const toggleMember = (id: ID) => setIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const pickGroup = (id: ID) => {
    const g = groupsRec[id];
    if (!g) return;
    setGroupId(id);
    setIds(g.studentIds);
    setPrice(g.price);
    setCurrency(g.currency);
    setDuration(g.duration);
  };
  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === 'one' && ids.length > 1) setIds(ids.slice(0, 1));
    if (m === 'one') setGroupId(undefined);
  };

  const sameDay = (lessonsByDay(rec).get(day) ?? []).filter((l) => l.id !== lesson?.id && l.status !== 'cancelled');
  const s = minutesOf(`${day}T${time}`);
  const clash = sameDay.filter((l) => {
    const ls = minutesOf(l.start);
    return s < ls + l.duration && ls < s + duration;
  });

  const canSave = ids.length > 0 && !!day && !!time;
  const weekday = isoWeekday(parseISO(day));

  const save = () => {
    if (!canSave) return;
    const start = `${day}T${time}`;
    const participants: Participant[] = ids.map((id) => {
      const prev = lesson?.participants.find((p) => p.studentId === id);
      return { ...(prev ?? { paid: false }), studentId: id, price, currency };
    });
    const gid = mode === 'group' ? groupId : undefined;

    if (lesson) {
      updateLesson(lesson.id, { start, duration, participants, groupId: gid });
      notify('Зміни збережено');
      onDone();
      return;
    }

    const st = studentsRec[ids[0]];
    if (weekly && mode === 'one' && st) {
      const slot = { id: uid(), weekday, time, duration };
      saveStudent({ ...st, price, currency, duration, schedule: [...st.schedule, slot] });
      const key = studentSlotKey(st.id, slot.id, day);
      const made = Object.values(useData.getState().lessons).find((l) => l.slotKey === key);
      if (made) {
        if (topic) updateLesson(made.id, { topic });
      } else {
        createLesson({ start, duration, participants, topic });
      }
      notify(`${st.name}: щотижня, ${WEEKDAYS_LONG[weekday - 1]} о ${time}`);
    } else {
      createLesson({ start, duration, participants, groupId: gid, topic });
      notify('Урок додано');
    }
    setDay(day);
    onDone();
  };

  return (
    <div>
      <Segmented
        label="Тип уроку"
        value={mode}
        onChange={switchMode}
        options={[
          { value: 'one', label: 'Індивідуальний' },
          { value: 'group', label: 'Груповий' },
        ]}
      />

      {mode === 'one' ? (
        <div className="field" style={{ marginTop: 16 }}>
          <span className="field-label">Учень</span>
          <StudentChips students={students} selected={ids} onToggle={pickOne} />
        </div>
      ) : (
        <>
          {groups.length > 0 && (
            <div className="field" style={{ marginTop: 16 }}>
              <span className="field-label">Група</span>
              <div className="student-chips">
                {groups.map((g) => (
                  <button key={g.id} className="student-chip" aria-pressed={groupId === g.id} onClick={() => pickGroup(g.id)}>
                    <Avatar name={g.name} color={g.color} size={26} />
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field" style={{ marginTop: 16 }}>
            <span className="field-label">Учасники · {ids.length}</span>
            <StudentChips students={students} selected={ids} onToggle={toggleMember} />
            {groups.length === 0 && (
              <span className="field-hint">Постійну групу з розкладом можна створити на вкладці «Учні».</span>
            )}
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <label className="field" style={{ flex: 1.5 }}>
          <span className="field-label">Дата</span>
          <input className="input" type="date" value={day} onChange={(e) => e.target.value && setDayValue(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Час</span>
          <input className="input" type="time" step={900} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
        </label>
      </div>
      {clash.length > 0 && (
        <p className="field-hint" style={{ color: 'var(--bad)', fontWeight: 650, marginTop: 6 }}>
          Перетинається з: {clash.map((l) => `${timeOf(l.start)} ${lessonTitle(l, studentsRec, groupsRec)}`).join(', ')}
        </p>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <span className="field-label">Тривалість</span>
        <DurationChips value={duration} onChange={setDuration} />
      </div>

      <div style={{ marginTop: 14 }}>
        <PriceField
          label={mode === 'group' ? 'Ціна з одного учня' : 'Ціна уроку'}
          price={price}
          currency={currency}
          onPrice={setPrice}
          onCurrency={setCurrency}
        />
      </div>

      {!lesson && (
        <div className="field" style={{ marginTop: 14 }}>
          <span className="field-label">Тема (можна пізніше)</span>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Напр.: Апостроф" />
        </div>
      )}

      {!lesson && mode === 'one' && (
        <div className="toggle-row weekly-row">
          <Repeat size={20} className="faint" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>Щотижня в цей час</div>
            <div className="field-hint">
              {cap1(WEEKDAYS_LONG[weekday - 1])} о {time} — уроки з'являтимуться в календарі самі
            </div>
          </div>
          <Switch checked={weekly} onChange={setWeekly} label="Щотижня" />
        </div>
      )}

      <div className="row" style={{ marginTop: 22 }}>
        <button className="btn btn-ghost" onClick={onDone}>
          {lesson ? 'Назад' : 'Скасувати'}
        </button>
        <button className="btn btn-primary" disabled={!canSave} onClick={save}>
          {lesson ? 'Зберегти' : 'Додати урок'}
        </button>
      </div>
    </div>
  );
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
