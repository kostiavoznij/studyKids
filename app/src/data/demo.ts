import { addDays, parseISO, subDays, subWeeks } from 'date-fns';
import { dayKey, isoWeekday, nowStamp, todayKey } from '../lib/dates';
import { uid } from '../lib/format';
import { CANCEL_REASONS, MOVE_REASONS } from './constants';
import { blankLesson, groupSlotKey, studentSlotKey } from './schedule';
import { chargeOf } from './money';
import type { Billing, DayOff, Group, ID, Lesson, Payment, Slot, Student } from './types';

// Invented students: the demo is published publicly, so no real names here.

const TOPICS_LANG = [
  'Звуки і букви',
  'Голосні та приголосні',
  "Тверді й м'які приголосні",
  'Склад. Перенос слів',
  'Наголос',
  'Апостроф',
  "М'який знак",
  'Подвоєння приголосних',
  'Іменник: рід і число',
  'Відмінки іменників',
  'Прикметник',
  'Дієслово: час',
  'Займенник',
  'Числівник',
  'Ненаголошені е, и',
  'Чергування голосних',
  'Види речень за метою',
  'Головні члени речення',
  'Однорідні члени речення',
  'Звертання',
  'Пряма мова',
  'Словниковий диктант',
  'Переказ тексту',
  'Твір-опис',
  'Повторення вивченого',
  'Контрольна робота',
  'Префікси пре-, при-, прі-',
  'Правопис -ться, -шся',
];

const TOPICS_READING = [
  'Читання складів',
  "Слова з м'яким знаком",
  'Казка «Рукавичка»',
  'Казка «Колобок»',
  'Вірші Н. Забіли',
  'Читання діалогів',
  'В. Сухомлинський. Оповідання',
  'Читання на швидкість',
  'Переказ прочитаного',
  'Казка «Коза-дереза»',
  'Загадки та скоромовки',
  'Л. Костенко. Вірші для дітей',
];

const TOPICS_FOREIGN = [
  'Привітання і знайомство',
  'Алфавіт: А–Ж',
  'Алфавіт: З–П',
  'Алфавіт: Р–Я',
  'Числа 1–10',
  'Числа 11–100',
  'Кольори',
  "Моя сім'я",
  'Дні тижня',
  'Їжа та напої',
  'У магазині',
  'Погода і пори року',
  'Мій день',
  'Хобі',
  'Тварини',
  'Одяг',
  'Місто',
  'Свята в Україні',
];

const TOPICS_NMT = [
  'Фонетика: наголос',
  "Орфографія: апостроф і м'який знак",
  'Фразеологізми',
  'Дієприкметник',
  'Складнопідрядне речення',
  'Відокремлені члени речення',
  'Тест НМТ: варіант 1',
  'Пароніми',
  'Правопис складних слів',
  'Тест НМТ: варіант 2',
  'Безсполучникове речення',
  'Тире в простому реченні',
];

const TOPICS_GROUP = ['Скоромовки', 'Гра «Слова на букву»', 'Читання в ролях', 'Загадки', 'Вікторина «Знавці мови»', 'Казка-імпровізація'];

const HOMEWORK = ['Вправа 3–4 у зошиті', 'Прочитати 2 сторінки', 'Вивчити 5 слів', 'Скласти 3 речення', 'Повторити правило', ''];

interface Spec {
  name: string;
  color: string;
  subject: string;
  grade: string;
  price: number;
  billing: Billing;
  /** lessons per prepaid package */
  pkg: number;
  /** stop paying this many days ago — makes a debt or an empty balance show up */
  stopPayingDaysAgo?: number;
  timezone?: string;
  slots: [number, string][];
  weeksAgo: number;
  pausedWeeksAgo?: number;
  gradeFrom: number;
  gradeTo: number;
  cancelP: number;
  cancelRecentP?: number;
  moveP: number;
  topics: string[];
  contact: Student['contact'];
  notes?: [number, string][];
}

const SPECS: Spec[] = [
  {
    name: 'Соломія',
    color: 'violet',
    subject: 'Українська мова',
    grade: '3 клас',
    price: 400,
    billing: 'prepaid',
    pkg: 8,
    slots: [[1, '14:00'], [4, '14:00']],
    weeksAgo: 14,
    gradeFrom: 3,
    gradeTo: 4.7,
    cancelP: 0.05,
    moveP: 0.06,
    topics: TOPICS_LANG,
    contact: { parent: 'Ірина (мама)', telegram: 'example_parent', phone: '+380 00 000 00 01' },
    notes: [
      [3, 'Помітний прогрес з апострофом, майже без помилок.'],
      [30, 'Плутає ненаголошені е/и — більше вправ на перевірку.'],
    ],
  },
  {
    name: 'Марко',
    color: 'blue',
    subject: 'Читання',
    grade: '2 клас',
    price: 350,
    billing: 'after',
    pkg: 1,
    slots: [[1, '15:00'], [3, '15:00']],
    weeksAgo: 12,
    gradeFrom: 3.2,
    gradeTo: 4.1,
    cancelP: 0.07,
    moveP: 0.05,
    topics: TOPICS_READING,
    contact: { parent: 'Олег (тато)', phone: '+380 00 000 00 02' },
  },
  {
    name: 'Олівія',
    color: 'pink',
    subject: 'Українська мова',
    grade: '5 клас',
    price: 450,
    billing: 'prepaid',
    pkg: 8,
    stopPayingDaysAgo: 12,
    timezone: 'Europe/Warsaw',
    slots: [[1, '16:00'], [5, '16:00']],
    weeksAgo: 16,
    gradeFrom: 4.3,
    gradeTo: 4.6,
    cancelP: 0.04,
    moveP: 0.05,
    topics: TOPICS_LANG,
    contact: { parent: 'Наталія (мама)', telegram: 'example_parent2' },
  },
  {
    name: 'Тимофій',
    color: 'orange',
    subject: 'Українська мова',
    grade: '4 клас',
    price: 300,
    billing: 'prepaid',
    pkg: 4,
    slots: [[3, '17:00']],
    weeksAgo: 14,
    gradeFrom: 4,
    gradeTo: 3.1,
    cancelP: 0.05,
    cancelRecentP: 0.4,
    moveP: 0.05,
    topics: TOPICS_LANG,
    contact: { parent: 'Світлана (мама)', phone: '+380 00 000 00 03' },
    notes: [[10, 'Часто скасовує — поговорити з мамою про розклад.']],
  },
  {
    name: 'Злата',
    color: 'green',
    subject: 'Українська мова',
    grade: '1 клас',
    price: 400,
    billing: 'prepaid',
    pkg: 4,
    slots: [[1, '17:00'], [4, '17:00']],
    weeksAgo: 10,
    gradeFrom: 3.4,
    gradeTo: 4.3,
    cancelP: 0.06,
    moveP: 0.04,
    topics: TOPICS_READING,
    contact: { parent: 'Марія (мама)', telegram: 'example_parent3' },
  },
  {
    name: 'Назар',
    color: 'cyan',
    subject: 'Підготовка до НМТ',
    grade: '11 клас',
    price: 500,
    billing: 'prepaid',
    pkg: 8,
    slots: [[2, '18:00'], [5, '18:00']],
    weeksAgo: 9,
    gradeFrom: 3.9,
    gradeTo: 3.4,
    cancelP: 0.06,
    moveP: 0.2,
    topics: TOPICS_NMT,
    contact: { phone: '+380 00 000 00 04' },
  },
  {
    name: 'Emma',
    color: 'amber',
    subject: 'Українська як іноземна',
    grade: '10 років',
    price: 800,
    billing: 'prepaid',
    pkg: 8,
    timezone: 'Europe/Berlin',
    slots: [[1, '18:00'], [6, '11:00']],
    weeksAgo: 11,
    gradeFrom: 2.8,
    gradeTo: 4,
    cancelP: 0.05,
    moveP: 0.05,
    topics: TOPICS_FOREIGN,
    contact: { parent: 'Katrin (mother)', email: 'parent@example.com' },
  },
  {
    name: 'Leo',
    color: 'teal',
    subject: 'Українська як іноземна',
    grade: '8 років',
    price: 850,
    billing: 'after',
    pkg: 1,
    stopPayingDaysAgo: 5,
    timezone: 'America/Toronto',
    slots: [[1, '20:00'], [3, '20:00']],
    weeksAgo: 8,
    gradeFrom: 3,
    gradeTo: 3.6,
    cancelP: 0.05,
    moveP: 0.06,
    topics: TOPICS_FOREIGN,
    contact: { parent: 'Андрій (тато)', telegram: 'example_parent4' },
  },
  {
    name: 'Мілана',
    color: 'fuchsia',
    subject: 'Українська мова',
    grade: '7 клас',
    price: 450,
    billing: 'prepaid',
    pkg: 4,
    slots: [[2, '16:00']],
    weeksAgo: 4,
    gradeFrom: 4,
    gradeTo: 4.4,
    cancelP: 0.03,
    moveP: 0.05,
    topics: TOPICS_LANG.slice(8),
    contact: { parent: 'Оксана (мама)', phone: '+380 00 000 00 05' },
  },
  {
    name: 'Остап',
    color: 'brown',
    subject: 'Читання',
    grade: '1 клас',
    price: 350,
    billing: 'prepaid',
    pkg: 4,
    slots: [[2, '15:00']],
    weeksAgo: 15,
    pausedWeeksAgo: 5,
    gradeFrom: 3.2,
    gradeTo: 3.8,
    cancelP: 0.08,
    moveP: 0.05,
    topics: TOPICS_READING,
    contact: { parent: 'Ірина (мама)' },
  },
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every date the slots hit between two days, in chronological order. */
function occurrences(slots: Slot[], from: Date, to: Date) {
  const out: { day: string; slot: Slot }[] = [];
  for (const slot of slots) {
    let d = addDays(from, (slot.weekday - isoWeekday(from) + 7) % 7);
    while (d <= to) {
      out.push({ day: dayKey(d), slot });
      d = addDays(d, 7);
    }
  }
  return out.sort((a, b) => (a.day + a.slot.time).localeCompare(b.day + b.slot.time));
}

export function buildDemo() {
  const rnd = mulberry32(20261026);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const now = nowStamp();
  const today = todayKey();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const recentFrom = dayKey(subDays(midnight, 28));

  const students: Record<ID, Student> = {};
  const groups: Record<ID, Group> = {};
  const lessons: Record<ID, Lesson> = {};
  const payments: Record<ID, Payment> = {};
  const byName: Record<string, ID> = {};

  const student = (spec: Spec, status: Student['status'], start: Date, slots: Slot[]): Student => ({
    id: uid(),
    name: spec.name,
    color: spec.color,
    subject: spec.subject,
    grade: spec.grade,
    price: spec.price,
    billing: spec.billing,
    duration: 60,
    timezone: spec.timezone ?? '',
    contact: spec.contact,
    schedule: slots,
    status,
    startDate: dayKey(start),
    notes: (spec.notes ?? []).map(([ago, text]) => ({ id: uid(), date: dayKey(subDays(midnight, ago)), text })),
    createdAt: start.getTime(),
    updatedAt: start.getTime(),
  });

  for (const spec of SPECS) {
    const start = subWeeks(midnight, spec.weeksAgo);
    const slots: Slot[] = spec.slots.map(([weekday, time]) => ({ id: uid(), weekday, time, duration: 60 }));
    const st = student(spec, spec.pausedWeeksAgo ? 'paused' : 'active', start, slots);
    const id = st.id;
    students[id] = st;
    byName[spec.name] = id;

    const until = spec.pausedWeeksAgo ? subWeeks(midnight, spec.pausedWeeksAgo) : midnight;
    const occ = occurrences(slots, start, until);
    let topicIdx = 0;
    occ.forEach(({ day, slot }, i) => {
      const startStamp = `${day}T${slot.time}`;
      if (startStamp >= now) return; // future lessons come from the schedule generator
      const progress = occ.length > 1 ? i / (occ.length - 1) : 1;
      const l = blankLesson(startStamp, 60, [{ studentId: id, price: spec.price }]);
      l.id = l.slotKey = studentSlotKey(id, slot.id, day);
      l.createdAt = l.updatedAt = parseISO(day).getTime();

      const cancelP = day >= recentFrom && spec.cancelRecentP != null ? spec.cancelRecentP : spec.cancelP;
      if (rnd() < cancelP) {
        l.status = 'cancelled';
        l.cancel = { by: rnd() < 0.8 ? 'student' : 'teacher', reason: pick(CANCEL_REASONS), charged: rnd() < 0.2, at: l.createdAt };
      } else {
        if (rnd() < spec.moveP) {
          // two days later could land on the student's next regular slot, so shift the hour too
          const twoDays = rnd() >= 0.6;
          const hour = String(Number(slot.time.slice(0, 2)) + (twoDays ? 1 : 0)).padStart(2, '0');
          const to = `${dayKey(addDays(parseISO(day), twoDays ? 2 : 1))}T${hour}${slot.time.slice(2)}`;
          l.moves = [{ from: startStamp, to, by: rnd() < 0.75 ? 'student' : 'teacher', reason: pick(MOVE_REASONS), at: l.createdAt }];
          l.start = to;
        }
        if (l.start < now) {
          const g = spec.gradeFrom + (spec.gradeTo - spec.gradeFrom) * progress + (rnd() - 0.5) * 1.3;
          l.status = 'done';
          l.topic = spec.topics[topicIdx++ % spec.topics.length];
          l.homework = pick(HOMEWORK);
          l.participants[0].grade = Math.max(1, Math.min(5, Math.round(g)));
        }
      }
      lessons[l.id] = l;
    });
  }

  // One small group so the group lessons feature is visible.
  const gid = uid();
  const members = ['Злата', 'Мілана', 'Соломія'].map((n) => byName[n]);
  const gSlot: Slot = { id: uid(), weekday: 6, time: '10:00', duration: 60 };
  const gStart = subWeeks(midnight, 4);
  groups[gid] = {
    id: gid,
    name: 'Мовна розминка',
    color: 'teal',
    studentIds: members,
    schedule: [gSlot],
    price: 250,
    duration: 60,
    status: 'active',
    createdAt: gStart.getTime(),
    updatedAt: gStart.getTime(),
  };
  occurrences([gSlot], gStart, midnight).forEach(({ day }, i) => {
    const startStamp = `${day}T10:00`;
    if (startStamp >= now || day > today) return;
    const l = blankLesson(
      startStamp,
      60,
      members.map((studentId) => ({ studentId, price: 250, grade: 3 + Math.round(rnd() * 2), absent: rnd() < 0.12 })),
    );
    for (const p of l.participants) if (p.absent) p.grade = undefined;
    l.groupId = gid;
    l.id = l.slotKey = groupSlotKey(gid, gSlot.id, day);
    l.status = 'done';
    l.topic = TOPICS_GROUP[i % TOPICS_GROUP.length];
    lessons[l.id] = l;
  });

  // Trial lessons: one that became a regular student, one still deciding, one upcoming.
  const trial = (studentId: ID, start: string, report?: Lesson['trial']) => {
    const l = blankLesson(start, 45, [{ studentId, price: 0 }]);
    l.kind = 'trial';
    l.trial = report ?? { level: '', strengths: '', weaknesses: '', plan: '' };
    if (report) l.status = 'done';
    lessons[l.id] = l;
  };
  const milana = students[byName['Мілана']];
  trial(milana.id, `${dayKey(subDays(parseISO(milana.startDate), 3))}T16:00`, {
    level: 'Відповідає віку',
    strengths: 'Добре читає, великий словниковий запас, охоче говорить.',
    weaknesses: 'Пунктуація у складних реченнях, плутає -ться/-шся.',
    plan: 'Двічі на тиждень: правопис і синтаксис, щомісяця контрольна.',
    outcome: 'continue',
  });
  const newbie = (name: string, color: string, grade: string) => {
    const spec: Spec = { ...SPECS[0], name, color, grade, notes: [], contact: { parent: 'Мама' }, price: 400, billing: 'prepaid' };
    const st = student(spec, 'trial', midnight, []);
    students[st.id] = st;
    return st.id;
  };
  trial(newbie('Денис', 'lime', '2 клас'), `${dayKey(subDays(midnight, 3))}T19:00`, {
    level: 'Нижче вікової норми',
    strengths: "Гарно переказує, уважний, швидко запам'ятовує правила.",
    weaknesses: 'Читає по складах, пропускає букви на письмі.',
    plan: 'Читання щодня по 10 хв, звуко-буквений аналіз, списування.',
    outcome: 'thinking',
  });
  trial(newbie('Вероніка', 'red', '4 клас'), `${dayKey(addDays(midnight, 1))}T19:00`);

  // A sick day ten days ago: every lesson that day cancelled by the teacher.
  const daysOff: Record<ID, DayOff> = {};
  let sick = subDays(midnight, 10);
  while (isoWeekday(sick) > 5) sick = subDays(sick, 1);
  const sickDay = dayKey(sick);
  for (const l of Object.values(lessons)) {
    if (l.start.slice(0, 10) !== sickDay || l.status === 'cancelled') continue;
    l.status = 'cancelled';
    l.topic = '';
    l.homework = '';
    for (const p of l.participants) p.grade = undefined;
    l.cancel = { by: 'teacher', reason: 'Лікарняний', charged: false, at: sick.getTime() };
  }
  const off: DayOff = { id: uid(), from: sickDay, to: sickDay, kind: 'sick', note: 'Застуда', cancelLessons: true, createdAt: sick.getTime(), updatedAt: sick.getTime() };
  daysOff[off.id] = off;

  // Payments: prepaying families buy a package when the balance runs out,
  // the others pay right after each lesson.
  for (const spec of SPECS) {
    const id = byName[spec.name];
    const stopFrom = spec.stopPayingDaysAgo != null ? dayKey(subDays(midnight, spec.stopPayingDaysAgo)) : '9999';
    let balance = 0;
    const pay = (date: string, amount: number, count: number) => {
      const t = parseISO(date).getTime();
      const p: Payment = { id: uid(), studentId: id, date, amount, lessons: count, note: '', createdAt: t, updatedAt: t };
      payments[p.id] = p;
      balance += amount;
    };
    const own = Object.values(lessons)
      .filter((l) => l.participants.some((p) => p.studentId === id))
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const l of own) {
      const c = chargeOf(l, l.participants.find((x) => x.studentId === id)!);
      if (c <= 0) continue;
      const day = l.start.slice(0, 10);
      if (spec.billing === 'prepaid' && balance < c && day < stopFrom) {
        pay(dayKey(subDays(parseISO(day), 1)), spec.price * spec.pkg, spec.pkg);
      }
      balance -= c;
      if (spec.billing === 'after' && day < stopFrom) pay(day, c, 1);
    }
  }

  return { students, groups, lessons, payments, daysOff };
}
