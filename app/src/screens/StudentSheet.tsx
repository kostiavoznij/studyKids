import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SUBJECTS, TIMEZONES } from '../data/constants';
import { useLiveStudents } from '../data/selectors';
import { useData } from '../data/store';
import type { Contact, Currency, Slot, StudentStatus } from '../data/types';
import { Segmented, Sheet } from '../ui/components';
import { ColorPicker, DurationChips, PriceField, SlotEditor, StudentChips } from '../ui/fields';
import { navigate } from '../ui/router';
import { ask, useUi } from '../ui/uiStore';

const STATUSES: { value: StudentStatus; label: string }[] = [
  { value: 'active', label: 'Займається' },
  { value: 'paused', label: 'Пауза' },
  { value: 'archived', label: 'Архів' },
];

export function StudentSheet({ id, onClose }: { id?: string; onClose: () => void }) {
  const existing = useData((s) => (id ? s.students[id] : undefined));
  const settings = useData((s) => s.settings);
  const saveStudent = useData((s) => s.saveStudent);
  const deleteStudent = useData((s) => s.deleteStudent);
  const notify = useUi((s) => s.notify);

  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? pickColor());
  const [subject, setSubject] = useState(existing?.subject ?? SUBJECTS[0]);
  const [grade, setGrade] = useState(existing?.grade ?? '');
  const [price, setPrice] = useState(existing?.price ?? settings.defaultPrice);
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? settings.baseCurrency);
  const [duration, setDuration] = useState(existing?.duration ?? settings.defaultDuration);
  const [schedule, setSchedule] = useState<Slot[]>(existing?.schedule ?? []);
  const [timezone, setTimezone] = useState(existing?.timezone ?? '');
  const [contact, setContact] = useState<Contact>(existing?.contact ?? {});
  const [status, setStatus] = useState<StudentStatus>(existing?.status ?? 'active');

  const setC = (k: keyof Contact, v: string) => setContact((c) => ({ ...c, [k]: v }));

  const save = () => {
    if (!name.trim()) return;
    const sid = saveStudent({
      ...(existing ?? {}),
      name: name.trim(),
      color,
      subject: subject.trim(),
      grade: grade.trim(),
      price,
      currency,
      duration,
      schedule: schedule.map((s) => ({ ...s, duration })),
      timezone,
      contact,
      status,
    });
    notify(existing ? 'Збережено' : `${name.trim()} — додано`);
    onClose();
    if (!existing) navigate(`/students/${sid}`);
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await ask({
      title: `Видалити ${existing.name}?`,
      text: 'Проведені уроки залишаться в статистиці, а майбутні заплановані зникнуть. Якщо учень просто закінчив навчання — краще перенести в архів.',
      ok: 'Видалити',
      danger: true,
    });
    if (!ok) return;
    deleteStudent(existing.id);
    onClose();
    navigate('/students');
  };

  return (
    <Sheet
      title={existing ? 'Редагувати учня' : 'Новий учень'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          {existing ? 'Зберегти' : 'Додати учня'}
        </button>
      }
    >
      <label className="field">
        <span className="field-label">Ім'я</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр.: Софійка" autoFocus={!existing} />
      </label>

      <div className="field">
        <span className="field-label">Колір у календарі</span>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <div className="field">
        <span className="field-label">Що вивчає</span>
        <div className="chips">
          {SUBJECTS.map((s) => (
            <button key={s} className="chip sm" aria-pressed={subject === s} onClick={() => setSubject(s)}>
              {s}
            </button>
          ))}
        </div>
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Або напишіть своє" />
      </div>

      <label className="field">
        <span className="field-label">Клас або вік</span>
        <input className="input" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Напр.: 3 клас" />
      </label>

      <div className="form-section">
        <h3>Урок і оплата</h3>
        <PriceField price={price} currency={currency} onPrice={setPrice} onCurrency={setCurrency} />
        <div className="field">
          <span className="field-label">Тривалість</span>
          <DurationChips value={duration} onChange={setDuration} />
        </div>
      </div>

      <div className="form-section">
        <h3>Постійний розклад</h3>
        <p className="field-hint" style={{ marginBottom: 10 }}>
          Уроки на ці дні з'являтимуться в календарі на {settings.horizonWeeks} тижнів наперед. Окремий урок завжди можна перенести чи скасувати.
        </p>
        <SlotEditor slots={schedule} onChange={setSchedule} duration={duration} />
      </div>

      <div className="form-section">
        <h3>Де живе</h3>
        <label className="field">
          <span className="field-label">Часовий пояс учня</span>
          <select className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONES.map((t) => (
              <option key={t.zone} value={t.zone}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="field-hint">Тоді в картці уроку видно, котра година в учня.</span>
        </label>
      </div>

      <div className="form-section">
        <h3>Контакти</h3>
        <label className="field">
          <span className="field-label">Батьки</span>
          <input className="input" value={contact.parent ?? ''} onChange={(e) => setC('parent', e.target.value)} placeholder="Напр.: Ірина (мама)" />
        </label>
        <div className="row">
          <label className="field">
            <span className="field-label">Телефон</span>
            <input className="input" type="tel" value={contact.phone ?? ''} onChange={(e) => setC('phone', e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Telegram</span>
            <input className="input" value={contact.telegram ?? ''} onChange={(e) => setC('telegram', e.target.value.replace(/^@/, ''))} placeholder="нікнейм" />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" value={contact.email ?? ''} onChange={(e) => setC('email', e.target.value)} />
        </label>
      </div>

      {existing && (
        <div className="form-section">
          <h3>Статус</h3>
          <Segmented label="Статус" value={status} options={STATUSES} onChange={setStatus} />
          <p className="field-hint" style={{ marginTop: 8 }}>
            На паузі чи в архіві нові уроки не створюються, а історія зберігається.
          </p>
          <button className="btn btn-danger-soft btn-block" style={{ marginTop: 18 }} onClick={remove}>
            <Trash2 size={17} /> Видалити учня
          </button>
        </div>
      )}
    </Sheet>
  );
}

let colorTurn = 0;
function pickColor() {
  const keys = ['violet', 'blue', 'teal', 'orange', 'pink', 'green', 'amber', 'cyan', 'red', 'fuchsia', 'lime', 'brown'];
  const used = new Set(Object.values(useData.getState().students).filter((s) => !s.deletedAt).map((s) => s.color));
  return keys.find((k) => !used.has(k)) ?? keys[colorTurn++ % keys.length];
}

export function GroupSheet({ id, onClose }: { id?: string; onClose: () => void }) {
  const existing = useData((s) => (id ? s.groups[id] : undefined));
  const settings = useData((s) => s.settings);
  const saveGroup = useData((s) => s.saveGroup);
  const deleteGroup = useData((s) => s.deleteGroup);
  const notify = useUi((s) => s.notify);
  const students = useLiveStudents().filter((s) => s.status === 'active' || existing?.studentIds.includes(s.id));

  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? 'teal');
  const [ids, setIds] = useState<string[]>(existing?.studentIds ?? []);
  const [price, setPrice] = useState(existing?.price ?? Math.round(settings.defaultPrice * 0.6));
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? settings.baseCurrency);
  const [duration, setDuration] = useState(existing?.duration ?? settings.defaultDuration);
  const [schedule, setSchedule] = useState<Slot[]>(existing?.schedule ?? []);
  const [status, setStatus] = useState<StudentStatus>(existing?.status ?? 'active');

  const save = () => {
    if (!name.trim()) return;
    saveGroup({
      ...(existing ?? {}),
      name: name.trim(),
      color,
      studentIds: ids,
      price,
      currency,
      duration,
      schedule: schedule.map((s) => ({ ...s, duration })),
      status,
    });
    notify(existing ? 'Групу збережено' : 'Групу створено');
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await ask({ title: `Видалити групу «${existing.name}»?`, text: 'Проведені заняття залишаться в історії учнів.', ok: 'Видалити', danger: true });
    if (!ok) return;
    deleteGroup(existing.id);
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'Група' : 'Нова група'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          {existing ? 'Зберегти' : 'Створити групу'}
        </button>
      }
    >
      <label className="field">
        <span className="field-label">Назва</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр.: Читайлики" autoFocus={!existing} />
      </label>
      <div className="field">
        <span className="field-label">Колір</span>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="field">
        <span className="field-label">Учасники · {ids.length}</span>
        <StudentChips students={students} selected={ids} onToggle={(sid) => setIds((xs) => (xs.includes(sid) ? xs.filter((x) => x !== sid) : [...xs, sid]))} />
      </div>
      <div className="form-section">
        <h3>Заняття й оплата</h3>
        <PriceField label="Ціна з одного учня" price={price} currency={currency} onPrice={setPrice} onCurrency={setCurrency} />
        <div className="field">
          <span className="field-label">Тривалість</span>
          <DurationChips value={duration} onChange={setDuration} />
        </div>
      </div>
      <div className="form-section">
        <h3>Постійний розклад</h3>
        <SlotEditor slots={schedule} onChange={setSchedule} duration={duration} />
      </div>
      {existing && (
        <div className="form-section">
          <h3>Статус</h3>
          <Segmented label="Статус" value={status} options={STATUSES} onChange={setStatus} />
          <button className="btn btn-danger-soft btn-block" style={{ marginTop: 18 }} onClick={remove}>
            <Trash2 size={17} /> Видалити групу
          </button>
        </div>
      )}
    </Sheet>
  );
}
