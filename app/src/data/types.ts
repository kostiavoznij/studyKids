export type ID = string;

export type Currency = 'UAH' | 'EUR' | 'USD' | 'PLN' | 'GBP' | 'CAD';

/** Who initiated a cancellation or a reschedule. */
export type Initiator = 'student' | 'teacher';

/** A weekly recurring slot, e.g. Tuesday 17:00 for 60 minutes. */
export interface Slot {
  id: ID;
  /** ISO weekday: 1 = Monday … 7 = Sunday */
  weekday: number;
  /** 'HH:mm' */
  time: string;
  duration: number;
}

export interface Contact {
  parent?: string;
  phone?: string;
  telegram?: string;
  email?: string;
}

export interface Note {
  id: ID;
  /** 'yyyy-MM-dd' */
  date: string;
  text: string;
}

export type StudentStatus = 'active' | 'paused' | 'archived';

export interface Student {
  id: ID;
  name: string;
  /** key from STUDENT_COLORS */
  color: string;
  subject: string;
  grade: string;
  price: number;
  currency: Currency;
  duration: number;
  /** IANA zone if the student lives in another time zone */
  timezone: string;
  contact: Contact;
  schedule: Slot[];
  status: StudentStatus;
  /** 'yyyy-MM-dd' */
  startDate: string;
  notes: Note[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Group {
  id: ID;
  name: string;
  color: string;
  studentIds: ID[];
  schedule: Slot[];
  /** price per student */
  price: number;
  currency: Currency;
  duration: number;
  status: StudentStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Participant {
  studentId: ID;
  price: number;
  currency: Currency;
  paid: boolean;
  /** 1–5, how well the topic was understood */
  grade?: number;
  /** only meaningful for group lessons */
  absent?: boolean;
}

export interface Move {
  /** 'yyyy-MM-ddTHH:mm' */
  from: string;
  to: string;
  by: Initiator;
  reason: string;
  at: number;
}

export interface Cancel {
  by: Initiator;
  reason: string;
  /** late cancellation that is still paid */
  charged: boolean;
  at: number;
}

export type LessonStatus = 'planned' | 'done' | 'cancelled';

export interface Lesson {
  id: ID;
  /** local wall time 'yyyy-MM-ddTHH:mm' */
  start: string;
  duration: number;
  participants: Participant[];
  groupId?: ID;
  status: LessonStatus;
  topic: string;
  homework: string;
  note: string;
  cancel?: Cancel;
  moves: Move[];
  /** set for lessons generated from a weekly slot, keeps the generator idempotent */
  slotKey?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export type ThemeId = 'system' | 'light' | 'dark' | 'black' | 'sand' | 'ocean' | 'mint' | 'rose';

export type CalendarView = 'day' | 'week' | 'month';

export interface Settings {
  theme: ThemeId;
  baseCurrency: Currency;
  /** how many UAH one unit of the currency is worth */
  rates: Record<Currency, number>;
  defaultPrice: number;
  defaultDuration: number;
  dayStart: number;
  dayEnd: number;
  horizonWeeks: number;
  calendarView: CalendarView;
}
