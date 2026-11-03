import { BellRing, ChevronRight, TriangleAlert } from 'lucide-react';
import { useBot } from '../data/bot';
import { BUILT_IN, reminderLabel, reminderSchedule, templateText, type ReminderSchedule } from '../data/botText';
import { useLiveStudents } from '../data/selectors';
import { useData } from '../data/store';
import type { ID } from '../data/types';
import { Segmented, Switch } from '../ui/components';
import { useUi } from '../ui/uiStore';

/*
 * Reminders before lessons, in Налаштування → Telegram-бот. Off until she turns
 * them on; by default only for the students she picks — the ones who tend to be
 * late — so nobody gets messages they didn't need.
 */

const BEFORE = [15, 30, 60, 120, 180];
const EVENINGS = ['18:00', '19:00', '20:00', '21:00'];

/** Saves the reminder template with a new schedule, keeping its text. */
export function useSaveSchedule() {
  const rec = useData((s) => s.botTemplates);
  const saveBotTemplate = useData((s) => s.saveBotTemplate);
  return (next: ReminderSchedule) =>
    saveBotTemplate({ kind: 'reminder', name: BUILT_IN.reminder.name, text: templateText(rec, 'reminder'), schedule: next });
}

export function BotReminders() {
  const rec = useData((s) => s.botTemplates);
  const status = useBot((s) => s.status);
  const chats = useBot((s) => s.chats);
  const students = useLiveStudents();
  const open = useUi((s) => s.open);
  const save = useSaveSchedule();
  const s = reminderSchedule(rec);

  const set = (patch: Partial<ReminderSchedule>) => save({ ...s, ...patch });
  const toggleBefore = (m: number) => {
    const before = s.before.includes(m) ? s.before.filter((x) => x !== m) : [...s.before, m].sort((a, b) => a - b);
    set({ before });
  };
  const toggleStudent = (id: ID) => set({ students: s.students.includes(id) ? s.students.filter((x) => x !== id) : [...s.students, id] });

  const connected = students.filter((st) => st.status !== 'archived' && chats.some((c) => c.studentId === st.id && !c.blocked));
  const nothingChosen = s.before.length === 0 && !s.evening;
  const cron = status?.reminders;

  return (
    <div className="bot-reminders">
      <div className="toggle-row">
        <div>
          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BellRing size={17} /> Нагадування перед уроками
          </div>
          <div className="field-hint">Бот сам нагадає батькам про урок — наприклад, тим, хто часто запізнюється.</div>
        </div>
        <Switch checked={s.enabled} onChange={(enabled) => set({ enabled })} label="Нагадування перед уроками" />
      </div>

      {s.enabled && (
        <>
          <div className="field">
            <span className="field-label">Коли</span>
            <div className="chips">
              {BEFORE.map((m) => (
                <button key={m} className="chip sm" aria-pressed={s.before.includes(m)} onClick={() => toggleBefore(m)}>
                  {reminderLabel(m)}
                </button>
              ))}
              <button className="chip sm" aria-pressed={!!s.evening} onClick={() => set({ evening: s.evening ? '' : '19:00' })}>
                напередодні ввечері
              </button>
              {s.evening && (
                <select className="select bot-evening" value={s.evening} onChange={(e) => set({ evening: e.target.value })} aria-label="О котрій напередодні">
                  {EVENINGS.map((t) => (
                    <option key={t} value={t}>
                      о {t}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {nothingChosen && <span className="field-hint warn-text">Виберіть, коли нагадувати, — інакше нагадувань не буде.</span>}
          </div>

          <div className="field">
            <span className="field-label">Кому</span>
            <Segmented
              label="Кому"
              value={s.who}
              onChange={(who) => set({ who })}
              options={[
                { value: 'chosen', label: 'Вибраним учням' },
                { value: 'all', label: 'Усім з ботом' },
              ]}
            />
            {s.who === 'chosen' &&
              (connected.length ? (
                <>
                  <div className="chips" style={{ marginTop: 10 }}>
                    {connected.map((st) => (
                      <button key={st.id} className="chip sm" aria-pressed={s.students.includes(st.id)} onClick={() => toggleStudent(st.id)}>
                        {st.name}
                      </button>
                    ))}
                  </div>
                  <span className="field-hint">Тут лише учні, чиї батьки підключили бота. Те саме можна ввімкнути в картці учня.</span>
                </>
              ) : (
                <span className="field-hint">Поки жоден учень не підключив бота — щойно батьки підключаться, їх можна буде вибрати тут.</span>
              ))}
            {s.who === 'all' && <span className="field-hint">Нагадування отримають усі, хто підключив бота.</span>}
          </div>

          <button className="list-item bot-reminder-text" onClick={() => open({ kind: 'botTemplate', templateKind: 'reminder' })}>
            <div className="list-main">
              <div className="list-title">Текст нагадування</div>
              <div className="list-sub bot-template-sub">{templateText(rec, 'reminder')}</div>
            </div>
            <ChevronRight size={18} className="faint" />
          </button>

          {cron && !cron.scheduled && (
            <p className="sync-error" style={{ display: 'flex', gap: 8 }}>
              <TriangleAlert size={16} style={{ flex: 'none', marginTop: 2 }} />
              Сервер ще не перевіряє розклад. Адміністратор: натисніть «Оновити налаштування бота» вище.
            </p>
          )}
        </>
      )}
    </div>
  );
}
