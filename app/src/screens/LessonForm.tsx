import { parseISO } from 'date-fns';
import { Plus, Repeat, Sparkles, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { isTrial } from '../data/money';
import { lessonsByDay, lessonTitle, useLiveGroups, useLiveStudents } from '../data/selectors';
import { studentSlotKey } from '../data/schedule';
import { useData } from '../data/store';
import type { ID, Lesson, Participant } from '../data/types';
import { cap, isoWeekday, minutesOf, timeOf, todayKey, WEEKDAYS_LONG } from '../lib/dates';
import { uid } from '../lib/format';
import { Avatar, Empty, Segmented, Sheet, Switch } from '../ui/components';
import { DurationChips, PriceField, StudentChips } from '../ui/fields';
import { useUi } from '../ui/uiStore';

type Mode = 'one' | 'group';

interface Prefill {
  start?: string;
  studentId?: ID;
  groupId?: ID;
  trial?: boolean;
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
  const allStudents = useLiveStudents();
  const groups = useLiveGroups().filter((g) => g.status === 'active' || g.id === lesson?.groupId);

  const initStart = lesson?.start ?? prefill?.start ?? `${todayKey()}T14:00`;
  const preGroup = prefill?.groupId ? groupsRec[prefill.groupId] : undefined;
  const preStudent = prefill?.studentId ? studentsRec[prefill.studentId] : undefined;

  const [trial, setTrial] = useState(lesson ? isTrial(lesson) : !!prefill?.trial || preStudent?.status === 'trial');
  const [day, setDayValue] = useState(initStart.slice(0, 10));
  const [time, setTime] = useState(timeOf(initStart));
  const [mode, setMode] = useState<Mode>(
    lesson ? (lesson.groupId || lesson.participants.length > 1 ? 'group' : 'one') : preGroup ? 'group' : 'one',
  );
  const [ids, setIds] = useState<ID[]>(
    lesson ? lesson.participants.map((p) => p.studentId) : preGroup ? preGroup.studentIds : preStudent ? [preStudent.id] : [],
  );
  const [groupId, setGroupId] = useState<ID | undefined>(lesson?.groupId ?? preGroup?.id);
  const [duration, setDuration] = useState(
    lesson?.duration ?? preGroup?.duration ?? (trial ? 45 : preStudent?.duration ?? settings.defaultDuration),
  );
  const [price, setPrice] = useState<number>(lesson?.participants[0]?.price ?? preGroup?.price ?? preStudent?.price ?? settings.defaultPrice);
  const [topic, setTopic] = useState(lesson?.topic ?? '');
  const [weekly, setWeekly] = useState(false);
  const [newName, setNewName] = useState('');

  // Trial lessons are for newcomers, so students still on a trial show up there too.
  const students = allStudents.filter(
    (s) => inLesson(s.id) || s.status === 'active' || (trial && s.status === 'trial'),
  );

  if (students.length === 0 && !trial) {
    return (
      <Empty icon={<UserPlus size={36} />} title="Ще немає учнів">
        <p style={{ marginBottom: 12 }}>Додайте першого учня або запишіть когось на пробний урок.</p>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => setTrial(true)}>
            Пробний урок
          </button>
          <button className="btn btn-primary" onClick={() => open({ kind: 'student' })}>
            Додати учня
          </button>
        </div>
      </Empty>
    );
  }

  const pickOne = (id: ID) => {
    const st = studentsRec[id];
    setIds([id]);
    setGroupId(undefined);
    if (!lesson && st && !trial) {
      setDuration(st.duration);
      setPrice(st.price);
    }
  };
  const toggleMember = (id: ID) => setIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const pickGroup = (id: ID) => {
    const g = groupsRec[id];
    if (!g) return;
    setGroupId(id);
    setIds(g.studentIds);
    setPrice(g.price);
    setDuration(g.duration);
  };
  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === 'one' && ids.length > 1) setIds(ids.slice(0, 1));
    if (m === 'one') setGroupId(undefined);
  };
  const switchTrial = (v: boolean) => {
    setTrial(v);
    if (v) {
      setMode('one');
      setGroupId(undefined);
      setIds((xs) => xs.slice(0, 1));
      setDuration(45);
    } else {
      setDuration(settings.defaultDuration);
    }
  };
  const addNewcomer = () => {
    const name = newName.trim();
    if (!name) return;
    const id = saveStudent({ name, status: 'trial' });
    setIds([id]);
    setNewName('');
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
      return { ...prev, studentId: id, price: trial ? 0 : price };
    });
    const gid = mode === 'group' ? groupId : undefined;

    if (lesson) {
      updateLesson(lesson.id, { start, duration, participants, groupId: gid });
      notify('Зміни збережено');
      onDone();
      return;
    }

    const st = studentsRec[ids[0]];
    if (trial) {
      createLesson({ start, duration, participants, kind: 'trial' });
      notify(`Пробний урок: ${st?.name ?? ''}`);
    } else if (weekly && mode === 'one' && st) {
      const slot = { id: uid(), weekday, time, duration };
      saveStudent({ ...st, price, duration, schedule: [...st.schedule, slot] });
      const key = studentSlotKey(st.id, slot.id, day);
      const made = useData.getState().lessons[key];
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
      {!lesson && (
        <div className="toggle-row trial-toggle" data-on={trial ? '' : undefined}>
          <Sparkles size={20} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>Пробний урок</div>
            <div className="field-hint">Безкоштовне знайомство з новим учнем і перевірка знань</div>
          </div>
          <Switch checked={trial} onChange={switchTrial} label="Пробний урок" />
        </div>
      )}

      {!trial && (
        <div style={{ marginTop: lesson ? 0 : 14 }}>
          <Segmented
            label="Тип уроку"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'one', label: 'Індивідуальний' },
              { value: 'group', label: 'Груповий' },
            ]}
          />
        </div>
      )}

      {mode === 'one' ? (
        <div className="field" style={{ marginTop: 16 }}>
          <span className="field-label">Учень</span>
          {students.length > 0 && <StudentChips students={students} selected={ids} onToggle={pickOne} />}
          {trial && !lesson && (
            <div className="newcomer">
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNewcomer()}
                placeholder="Новий учень — ім'я"
                aria-label="Ім'я нового учня"
              />
              <button className="btn btn-soft" disabled={!newName.trim()} onClick={addNewcomer}>
                <Plus size={17} /> Додати
              </button>
            </div>
          )}
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
            {groups.length === 0 && <span className="field-hint">Постійну групу з розкладом можна створити на вкладці «Учні».</span>}
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

      {!trial && (
        <div className="field" style={{ marginTop: 14 }}>
          <PriceField label={mode === 'group' ? 'Ціна з одного учня' : 'Ціна уроку'} price={price} onPrice={setPrice} />
        </div>
      )}

      {!lesson && !trial && (
        <div className="field" style={{ marginTop: 14 }}>
          <span className="field-label">Тема (можна пізніше)</span>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Напр.: Апостроф" />
        </div>
      )}

      {!lesson && !trial && mode === 'one' && (
        <div className="toggle-row weekly-row">
          <Repeat size={20} className="faint" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>Щотижня в цей час</div>
            <div className="field-hint">
              {cap(WEEKDAYS_LONG[weekday - 1])} о {time} — уроки з'являтимуться в календарі самі
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
          {lesson ? 'Зберегти' : trial ? 'Записати на пробний' : 'Додати урок'}
        </button>
      </div>
    </div>
  );
}
