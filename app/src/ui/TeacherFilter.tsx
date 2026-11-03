import type { CSSProperties } from 'react';
import { useAccess } from '../data/access';
import { colorHex } from '../data/constants';
import { useActiveTeachers, useCalendarTeacher } from '../data/selectors';
import { useUi } from './uiStore';

/** Everyone's or one teacher's: lessons in the calendar, students in the list. Only once the school has several teachers. */
export function TeacherFilter() {
  const teachers = useActiveTeachers();
  const chosen = useCalendarTeacher();
  const setTeacher = useUi((s) => s.setTeacher);
  const access = useAccess();
  if (!access.manage || teachers.length < 2) return null;
  return (
    <div className="chips teacher-filter" role="group" aria-label="Чий розклад">
      <button className="chip sm" aria-pressed={chosen === null} onClick={() => setTeacher(null)}>
        Усі
      </button>
      {teachers.map((t) => (
        <button key={t.id} className="chip sm" aria-pressed={chosen === t.id} onClick={() => setTeacher(t.id)}>
          <i className="dot" style={{ '--c': colorHex(t.color) } as CSSProperties} />
          {t.name}
        </button>
      ))}
    </div>
  );
}
