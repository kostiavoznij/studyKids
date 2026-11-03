import { useState } from 'react';
import { useLiveGroups, useLiveLessons, useLiveStudents, useTeachers } from '../data/selectors';
import { useData } from '../data/store';
import { EMAIL_RE, teacherOf } from '../data/teachers';
import { MAIN_TEACHER, type TeacherStatus } from '../data/types';
import { LESSONS, nPlural, STUDENTS } from '../lib/format';
import { Segmented, Sheet } from '../ui/components';
import { ColorPicker } from '../ui/fields';
import { useUi } from '../ui/uiStore';
import { nowStamp } from '../lib/dates';

const STATUSES: { value: TeacherStatus; label: string }[] = [
  { value: 'active', label: 'Працює' },
  { value: 'archived', label: 'Архів' },
];

/** A teacher's card: name and color in the calendar, and the Gmail she signs in with. */
export function TeacherSheet({ id, onClose }: { id?: string; onClose: () => void }) {
  const teachers = useTeachers();
  const existing = teachers.find((t) => t.id === id);
  const saveTeacher = useData((s) => s.saveTeacher);
  const notify = useUi((s) => s.notify);
  const students = useLiveStudents();
  const groups = useLiveGroups();
  const lessons = useLiveLessons();

  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? pickColor(teachers.map((t) => t.color)));
  const [email, setEmail] = useState(existing?.email ?? '');
  const [status, setStatus] = useState<TeacherStatus>(existing?.status ?? 'active');
  const [error, setError] = useState<string>();

  const isMain = existing?.id === MAIN_TEACHER;
  const addr = email.trim().toLowerCase();
  const now = nowStamp();
  // What still depends on her: archiving her would leave it without a teacher.
  const busy = existing
    ? {
        students: students.filter((s) => s.status !== 'archived' && teacherOf(s) === existing.id).length,
        groups: groups.filter((g) => g.status !== 'archived' && teacherOf(g) === existing.id).length,
        lessons: lessons.filter((l) => l.status === 'planned' && l.start >= now && teacherOf(l) === existing.id).length,
      }
    : null;

  const save = () => {
    if (!name.trim()) return;
    if (addr && !EMAIL_RE.test(addr)) return setError('Перевірте пошту — має бути щось на зразок name@gmail.com');
    if (addr && teachers.some((t) => t.id !== existing?.id && t.email === addr)) return setError('Ця пошта вже вказана в картці іншої вчительки');
    if (existing && status === 'archived' && existing.status !== 'archived' && busy && busy.students + busy.groups + busy.lessons > 0) {
      return setError(
        `Спершу передайте іншій вчительці ${[
          busy.students && nPlural(busy.students, STUDENTS),
          busy.groups && `групи (${busy.groups})`,
          busy.lessons && `заплановані уроки (${busy.lessons})`,
        ]
          .filter(Boolean)
          .join(', ')} — поле «Вчителька» в картці учня, групи чи окремого уроку.`,
      );
    }
    saveTeacher({ ...(existing ?? {}), name: name.trim(), color, email: addr, status });
    notify(existing ? 'Збережено' : `${name.trim()} — додано`);
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'Вчителька' : 'Нова вчителька'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          {existing ? 'Зберегти' : 'Додати вчительку'}
        </button>
      }
    >
      <label className="field">
        <span className="field-label">Ім'я</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр.: Олена" autoFocus={!existing} />
      </label>

      <div className="field">
        <span className="field-label">Колір</span>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <label className="field">
        <span className="field-label">Gmail для входу (необов'язково)</span>
        <input
          className="input"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="name@gmail.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(undefined);
          }}
        />
        <span className="field-hint">
          {isMain
            ? 'Адміністраторові чи менеджерові пошта тут не потрібна — вони входять зі своєю роллю.'
            : 'З цією поштою вона увійде через Google і бачитиме лише свій розклад: уроки, своїх учнів, теми й нотатки. Без цін, оплат, статистики й чужих уроків. Без пошти картка просто показує, хто веде уроки.'}
        </span>
      </label>

      {existing && busy && (
        <p className="field-hint" style={{ marginTop: 14 }}>
          Зараз веде: {nPlural(busy.students, STUDENTS)}
          {busy.groups > 0 && `, групи: ${busy.groups}`}
          {` · попереду ${nPlural(busy.lessons, LESSONS)}`}
        </p>
      )}

      {existing && !isMain && (
        <div className="form-section">
          <h3>Статус</h3>
          <Segmented
            label="Статус"
            value={status}
            options={STATUSES}
            onChange={(v) => {
              setStatus(v);
              setError(undefined);
            }}
          />
          <p className="field-hint" style={{ marginTop: 8 }}>
            В архіві вчителька більше не може увійти, а її проведені уроки лишаються в історії.
          </p>
        </div>
      )}

      {error && <p className="sync-error">{error}</p>}
    </Sheet>
  );
}

function pickColor(used: string[]) {
  const keys = ['teal', 'orange', 'blue', 'pink', 'green', 'amber', 'cyan', 'red', 'fuchsia', 'lime'];
  return keys.find((k) => !used.includes(k)) ?? keys[used.length % keys.length];
}
