import { useState } from 'react';
import { useAccess } from '../data/access';
import { PAY_MODES, termsOf } from '../data/pay';
import { useLiveGroups, useLiveLessons, useLiveStudents, useTeachers } from '../data/selectors';
import { useData } from '../data/store';
import { EMAIL_RE, teacherOf } from '../data/teachers';
import { MAIN_TEACHER, type PayMode, type TeacherStatus } from '../data/types';
import { LESSONS, nPlural, STUDENTS } from '../lib/format';
import { Segmented, Sheet, Switch } from '../ui/components';
import { ColorPicker, NumberInput } from '../ui/fields';
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

  // Her pay is finance: only the admin sees and sets it, and it's kept apart from the card.
  const finance = useAccess().finance;
  const saveTeacherPay = useData((s) => s.saveTeacherPay);
  const payRec = useData((s) => s.teacherPay);
  const terms = existing ? termsOf(payRec, existing.id) : { mode: 'lesson' as PayMode, rate: 0, trials: true, lateCancels: false };
  const [payMode, setPayMode] = useState<PayMode>(terms.mode);
  const [rate, setRate] = useState(terms.rate);
  const [trials, setTrials] = useState(terms.trials);
  const [lateCancels, setLateCancels] = useState(terms.lateCancels);

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
    const tid = saveTeacher({ ...(existing ?? {}), name: name.trim(), color, email: addr, status });
    const payChanged =
      payMode !== terms.mode || rate !== terms.rate || trials !== terms.trials || lateCancels !== terms.lateCancels || (!existing && rate > 0);
    if (finance && payChanged) saveTeacherPay(tid, { mode: payMode, rate: payMode === 'none' ? 0 : rate, trials, lateCancels });
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

      {finance && (
        <div className="form-section">
          <h3>Оплата вчительки</h3>
          <p className="field-hint" style={{ marginBottom: 10 }}>
            Скільки школа платить їй за проведені уроки. Бачить лише адміністратор — ні менеджер, ні сама вчителька.
          </p>
          <Segmented label="Як рахувати оплату" value={payMode} options={PAY_MODES} onChange={setPayMode} />
          {payMode !== 'none' && (
            <>
              <label className="field" style={{ marginTop: 12 }}>
                <span className="field-label">{payMode === 'percent' ? 'Відсоток від ціни уроку' : payMode === 'hour' ? 'Ставка за годину' : 'Ставка за урок'}</span>
                <div className="input-wrap">
                  <NumberInput value={rate} onChange={(v) => setRate(payMode === 'percent' ? Math.min(v, 100) : v)} label="Ставка" />
                  <span className="input-suffix">{payMode === 'percent' ? '%' : '₴'}</span>
                </div>
                <span className="field-hint">
                  {payMode === 'percent'
                    ? 'Від того, скільки урок коштує сім’ї (для групи — від суми з усіх учнів).'
                    : payMode === 'hour'
                      ? 'Урок на 45 хвилин — це три чверті ставки.'
                      : 'Однаково за будь-який урок, і за груповий теж.'}
                </span>
              </label>
              <div className="toggle-row">
                <div>
                  <div style={{ fontWeight: 700 }}>Пробні уроки оплачуються</div>
                  <div className="field-hint">{payMode === 'percent' ? 'Пробний безкоштовний для сім’ї, тож відсоток від нього — 0.' : 'Хоч для сім’ї вони безкоштовні.'}</div>
                </div>
                <Switch checked={trials} onChange={setTrials} label="Пробні уроки оплачуються" />
              </div>
              <div className="toggle-row">
                <div>
                  <div style={{ fontWeight: 700 }}>Пізні скасування оплачуються</div>
                  <div className="field-hint">Ті, за які сім'я все одно платить.</div>
                </div>
                <Switch checked={lateCancels} onChange={setLateCancels} label="Пізні скасування оплачуються" />
              </div>
            </>
          )}
          {payMode === 'none' && <p className="field-hint" style={{ marginTop: 8 }}>Оплата не рахується — так для власниці школи.</p>}
        </div>
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
