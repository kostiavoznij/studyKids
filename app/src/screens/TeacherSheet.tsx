import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { stopPreview, useAccess, usePreview } from '../data/access';
import { PAY_MODES, termsOf } from '../data/pay';
import { useTeachers } from '../data/selectors';
import { useData } from '../data/store';
import { canDeleteTeacher, EMAIL_RE, teacherById, teacherTies } from '../data/teachers';
import { MAIN_TEACHER, type PayMode, type TeacherStatus } from '../data/types';
import { LESSONS, nPlural, STUDENTS } from '../lib/format';
import { Segmented, Sheet, Switch } from '../ui/components';
import { ColorPicker, NumberInput } from '../ui/fields';
import { ask, useUi } from '../ui/uiStore';
import { nowStamp } from '../lib/dates';

/** «передайте 1 учня, 3 учнів» */
const STUDENTS_WHOM: [string, string, string] = ['учня', 'учнів', 'учнів'];

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
  const data = useData();
  const deleteTeacher = useData((s) => s.deleteTeacher);

  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? pickColor(teachers.map((t) => t.color)));
  const [email, setEmail] = useState(existing?.email ?? '');
  const [status, setStatus] = useState<TeacherStatus>(existing?.status ?? 'active');
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLParagraphElement>(null);
  // The reason lands under the buttons at the bottom of the sheet: bring it into sight.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  // Her pay is finance: only the admin sees and sets it, and it's kept apart from the card.
  const { finance, destroy } = useAccess();
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
  // What still depends on her: archiving or deleting her would leave it without a teacher.
  const ties = existing ? teacherTies(data, existing.id, now) : null;
  const busy = ties ? { students: ties.students, groups: ties.groups, lessons: ties.ahead } : null;
  const handOver = (b: NonNullable<typeof busy>) =>
    `Спершу передайте іншій вчительці ${[
      b.students && nPlural(b.students, STUDENTS_WHOM),
      b.groups && `групи (${b.groups})`,
      b.lessons && `заплановані уроки (${b.lessons})`,
    ]
      .filter(Boolean)
      .join(', ')} — поле «Вчителька» в картці учня, групи чи окремого уроку.`;

  const save = () => {
    if (!name.trim()) return;
    if (addr && !EMAIL_RE.test(addr)) return setError('Перевірте пошту — має бути щось на зразок name@gmail.com');
    if (addr && teachers.some((t) => t.id !== existing?.id && t.email === addr)) return setError('Ця пошта вже вказана в картці іншої вчительки');
    if (existing && status === 'archived' && existing.status !== 'archived' && busy && busy.students + busy.groups + busy.lessons > 0) {
      return setError(handOver(busy));
    }
    const tid = saveTeacher({ ...(existing ?? {}), name: name.trim(), color, email: addr, status });
    const payChanged =
      payMode !== terms.mode || rate !== terms.rate || trials !== terms.trials || lateCancels !== terms.lateCancels || (!existing && rate > 0);
    if (finance && payChanged) saveTeacherPay(tid, { mode: payMode, rate: payMode === 'none' ? 0 : rate, trials, lateCancels });
    notify(existing ? 'Збережено' : `${name.trim()} — додано`);
    onClose();
  };

  const remove = async () => {
    if (!existing || !ties || !busy) return;
    if (busy.students + busy.groups + busy.lessons > 0) return setError(handOver(busy));
    if (!canDeleteTeacher(ties)) {
      return setError(
        `Їй записано виплати (${ties.payouts}) — це гроші школи, тож картку краще перенести в архів. Якщо виплати внесено помилково, спершу видаліть їх у її статистиці.`,
      );
    }
    const main = teacherById(data.teachers, MAIN_TEACHER).name;
    const ok = await ask({
      title: `Видалити картку «${existing.name}»?`,
      text: ties.history
        ? `Її минулі уроки (${ties.history}) буде записано на «${main}», тож історія учнів, баланси й статистика лишаться цілими. Якщо вона справді працювала у школі — краще перенесіть в архів: так видно, хто що вів.`
        : 'За нею немає жодного уроку, тож картка просто зникне.',
      ok: 'Видалити',
      danger: true,
    });
    if (!ok) return;
    if (!deleteTeacher(existing.id)) return setError('Не вдалося видалити — щось змінилося. Відкрийте картку ще раз.');
    if (usePreview.getState().teacherId === existing.id) stopPreview();
    notify(`${existing.name} — видалено`);
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
            {destroy && ' Видалити варто лише картку, додану помилково чи для перевірки.'}
          </p>
          {destroy && (
            <button className="btn btn-danger-soft btn-block" style={{ marginTop: 18 }} onClick={remove}>
              <Trash2 size={17} /> Видалити вчительку
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="sync-error" ref={errorRef}>
          {error}
        </p>
      )}
    </Sheet>
  );
}

function pickColor(used: string[]) {
  const keys = ['teal', 'orange', 'blue', 'pink', 'green', 'amber', 'cyan', 'red', 'fuchsia', 'lime'];
  return keys.find((k) => !used.includes(k)) ?? keys[used.length % keys.length];
}
