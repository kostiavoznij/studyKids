/*
 * Reminders before lessons. The database calls this every minute (pg_cron,
 * scheduled by bot_schedule() when the admin connects the bot).
 *
 * Due are the reminders whose moment — so long before the lesson, or the
 * evening before — fell within the last 20 minutes, for lessons still ahead
 * and still planned. Each one is claimed in bot_reminders before it goes, so it
 * goes once; a lesson moved to another time is reminded again. A run that
 * missed the window sends nothing late rather than a reminder after the fact.
 */
import { botToken, cronKey, deliver, json, serviceGet, serviceRpc, TelegramError } from '../_shared/bot.ts';
import {
  DEFAULT_TEXT,
  dayPhrase,
  NO_REMINDERS,
  reminderMoments,
  renderBot,
  schoolMoment,
  schoolToday,
  shiftDay,
  timePhrase,
  type ReminderSchedule,
} from '../_shared/botFormat.ts';

const WINDOW = 20 * 60000;

interface Row<T> {
  id: string;
  data: T;
}

interface LessonData {
  start?: string;
  status?: string;
  teacherId?: string;
  participants?: { studentId: string }[];
}

interface StudentData {
  name?: string;
  status?: string;
  timezone?: string;
}

interface Claim {
  lessonId: string;
  slot: string;
  chatId: number;
}

const inList = (ids: string[]) => `(${ids.map((x) => `"${x.replace(/"/g, '')}"`).join(',')})`;

async function run(token: string): Promise<number> {
  const [tpl] = await serviceGet<{ data: { text?: string; schedule?: ReminderSchedule } }>(
    'records',
    'type=eq.botTemplates&id=eq.reminder&deleted=is.false&select=data',
  );
  const schedule: ReminderSchedule | null = tpl?.data.schedule ? { ...NO_REMINDERS, ...tpl.data.schedule } : null;
  if (!schedule?.enabled) return 0;
  if (schedule.who === 'chosen' && schedule.students.length === 0) return 0;
  const text = tpl.data.text?.trim() || DEFAULT_TEXT.reminder;

  const now = Date.now();
  const today = schoolToday(now);
  // Reminders reach at most a day ahead: today's, tomorrow's and the next day's lessons are enough.
  const lessons = await serviceGet<Row<LessonData>>(
    'records',
    `type=eq.lessons&deleted=is.false&data->>status=eq.planned&data->>start=gte.${today}&data->>start=lt.${shiftDay(today, 3)}&select=id,data`,
  );

  const due: { lesson: Row<LessonData>; slot: string }[] = [];
  for (const l of lessons) {
    const start = l.data.start;
    if (!start || schoolMoment(start) <= now) continue;
    for (const r of reminderMoments(start, schedule)) if (r.at <= now && now - r.at < WINDOW) due.push({ lesson: l, slot: r.slot });
  }
  if (due.length === 0) return 0;

  const wanted = new Set<string>();
  for (const d of due) {
    for (const p of d.lesson.data.participants ?? []) if (schedule.who === 'all' || schedule.students.includes(p.studentId)) wanted.add(p.studentId);
  }
  if (wanted.size === 0) return 0;
  const ids = [...wanted];

  const [students, chats, teachers] = await Promise.all([
    serviceGet<Row<StudentData>>('records', `type=eq.students&deleted=is.false&id=in.${inList(ids)}&select=id,data`),
    serviceGet<{ student_id: string; chat_id: number }>('bot_chats', `student_id=in.${inList(ids)}&blocked=is.false&select=student_id,chat_id`),
    serviceGet<Row<{ name?: string }>>('records', 'type=eq.teachers&deleted=is.false&select=id,data'),
  ]);

  const outgoing: (Claim & { studentId: string; text: string })[] = [];
  for (const d of due) {
    const start = d.lesson.data.start as string;
    const teacher = teachers.find((t) => t.id === (d.lesson.data.teacherId ?? 'main'))?.data.name ?? '';
    for (const p of d.lesson.data.participants ?? []) {
      if (!wanted.has(p.studentId)) continue;
      const st = students.find((s) => s.id === p.studentId);
      if (!st || st.data.status === 'archived') continue;
      const body = renderBot(text, {
        name: st.data.name ?? '',
        date: dayPhrase(start.slice(0, 10), today),
        time: timePhrase(start, st.data.timezone || undefined),
        teacher,
      });
      for (const c of chats) {
        if (c.student_id === st.id) outgoing.push({ lessonId: d.lesson.id, slot: d.slot, chatId: c.chat_id, studentId: st.id, text: body });
      }
    }
  }
  if (outgoing.length === 0) return 0;

  const claimed = await serviceRpc<Claim[]>('bot_claim', { entries: outgoing.map(({ lessonId, slot, chatId }) => ({ lessonId, slot, chatId })) });
  const mine = new Set(claimed.map((c) => `${c.lessonId}|${c.slot}|${c.chatId}`));

  let sent = 0;
  const log: Record<string, unknown>[] = [];
  for (const o of outgoing) {
    if (!mine.has(`${o.lessonId}|${o.slot}|${o.chatId}`)) continue;
    try {
      await deliver(token, o.chatId, o.text);
      sent++;
      log.push({ studentId: o.studentId, chatId: o.chatId, text: o.text, status: 'sent' });
    } catch (e) {
      const blocked = e instanceof TelegramError && e.code === 403;
      log.push({ studentId: o.studentId, chatId: o.chatId, text: o.text, status: blocked ? 'blocked' : 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (log.length) await serviceRpc('bot_log_auto', { entries: log });
  return sent;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const token = botToken();
  if (!token) return new Response('no bot');
  if (req.headers.get('x-cron-key') !== (await cronKey(token))) return new Response('forbidden', { status: 403 });
  try {
    return json({ sent: await run(token) });
  } catch (e) {
    console.error('reminders failed', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
