import { addDays, parseISO, subDays, subWeeks } from 'date-fns';
import { dayKey, isoWeekday, nowStamp, todayKey } from '../lib/dates';
import { uid } from '../lib/format';
import { CANCEL_REASONS, MOVE_REASONS } from './constants';
import { blankLesson, groupSlotKey, studentSlotKey } from './schedule';
import type { Currency, Group, ID, Lesson, Settings, Slot, Student } from './types';

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
  currency: Currency;
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
    currency: 'UAH',
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
    currency: 'UAH',
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
    currency: 'UAH',
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
    currency: 'UAH',
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
    currency: 'UAH',
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
    currency: 'UAH',
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
    price: 18,
    currency: 'EUR',
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
    price: 20,
    currency: 'USD',
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
    currency: 'UAH',
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
    currency: 'UAH',
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

export function buildDemo(_settings: Settings) {
  const rnd = mulberry32(20261026);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const now = nowStamp();
  const today = todayKey();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const recentFrom = dayKey(subDays(midnight, 28));
  const unpaidFrom = dayKey(subDays(midnight, 10));

  const students: Record<ID, Student> = {};
  const groups: Record<ID, Group> = {};
  const lessons: Record<ID, Lesson> = {};
  const byName: Record<string, ID> = {};

  for (const spec of SPECS) {
    const id = uid();
    byName[spec.name] = id;
    const start = subWeeks(midnight, spec.weeksAgo);
    const slots: Slot[] = spec.slots.map(([weekday, time]) => ({ id: uid(), weekday, time, duration: 60 }));
    const created = start.getTime();
    students[id] = {
      id,
      name: spec.name,
      color: spec.color,
      subject: spec.subject,
      grade: spec.grade,
      price: spec.price,
      currency: spec.currency,
      duration: 60,
      timezone: spec.timezone ?? '',
      contact: spec.contact,
      schedule: slots,
      status: spec.pausedWeeksAgo ? 'paused' : 'active',
      startDate: dayKey(start),
      notes: (spec.notes ?? []).map(([ago, text]) => ({ id: uid(), date: dayKey(subDays(midnight, ago)), text })),
      createdAt: created,
      updatedAt: created,
    };

    const until = spec.pausedWeeksAgo ? subWeeks(midnight, spec.pausedWeeksAgo) : midnight;
    const occ = occurrences(slots, start, until);
    let topicIdx = 0;
    occ.forEach(({ day, slot }, i) => {
      const startStamp = `${day}T${slot.time}`;
      if (startStamp >= now) return; // future lessons come from the schedule generator
      const progress = occ.length > 1 ? i / (occ.length - 1) : 1;
      const l = blankLesson(startStamp, 60, [{ studentId: id, price: spec.price, currency: spec.currency, paid: true }]);
      l.slotKey = studentSlotKey(id, slot.id, day);
      l.createdAt = l.updatedAt = parseISO(day).getTime();

      const cancelP = day >= recentFrom && spec.cancelRecentP != null ? spec.cancelRecentP : spec.cancelP;
      if (rnd() < cancelP) {
        const charged = rnd() < 0.2;
        l.status = 'cancelled';
        l.cancel = { by: rnd() < 0.8 ? 'student' : 'teacher', reason: pick(CANCEL_REASONS), charged, at: l.createdAt };
        l.participants[0].paid = charged;
      } else {
        if (rnd() < spec.moveP) {
          const to = `${dayKey(addDays(parseISO(day), rnd() < 0.6 ? 1 : 2))}T${slot.time}`;
          l.moves = [{ from: startStamp, to, by: rnd() < 0.75 ? 'student' : 'teacher', reason: pick(MOVE_REASONS), at: l.createdAt }];
          l.start = to;
        }
        if (l.start >= now) {
          l.participants[0].paid = false;
        } else {
          const g = spec.gradeFrom + (spec.gradeTo - spec.gradeFrom) * progress + (rnd() - 0.5) * 1.3;
          l.status = 'done';
          l.topic = spec.topics[topicIdx++ % spec.topics.length];
          l.homework = pick(HOMEWORK);
          l.participants[0].grade = Math.max(1, Math.min(5, Math.round(g)));
          l.participants[0].paid = day < unpaidFrom || rnd() < 0.55;
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
    currency: 'UAH',
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
      members.map((studentId) => ({
        studentId,
        price: 250,
        currency: 'UAH' as Currency,
        paid: true,
        grade: 3 + Math.round(rnd() * 2),
        absent: rnd() < 0.12,
      })),
    );
    for (const p of l.participants) if (p.absent) p.grade = undefined;
    l.groupId = gid;
    l.slotKey = groupSlotKey(gid, gSlot.id, day);
    l.status = 'done';
    l.topic = TOPICS_GROUP[i % TOPICS_GROUP.length];
    lessons[l.id] = l;
  });

  return { students, groups, lessons };
}
