export type ID = string;

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

/** 'trial' — came for a free trial lesson and hasn't started regular lessons yet. */
export type StudentStatus = 'active' | 'trial' | 'paused' | 'archived';

/** How the family usually pays: a package in advance, or for each lesson after it. */
export type Billing = 'prepaid' | 'after';

export interface Student {
  id: ID;
  name: string;
  /** key from STUDENT_COLORS */
  color: string;
  subject: string;
  grade: string;
  /** price of one lesson, UAH */
  price: number;
  billing: Billing;
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
  /** price per student, UAH */
  price: number;
  duration: number;
  status: StudentStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Participant {
  studentId: ID;
  /** what this lesson costs this student, UAH */
  price: number;
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

export type LessonKind = 'regular' | 'trial';

export type TrialOutcome = 'continue' | 'thinking' | 'declined';

/** What the teacher found out on a free trial lesson. */
export interface TrialReport {
  level: string;
  strengths: string;
  weaknesses: string;
  plan: string;
  outcome?: TrialOutcome;
}

export interface Lesson {
  id: ID;
  /** local wall time 'yyyy-MM-ddTHH:mm' */
  start: string;
  duration: number;
  /** missing means 'regular' */
  kind?: LessonKind;
  participants: Participant[];
  groupId?: ID;
  status: LessonStatus;
  topic: string;
  homework: string;
  note: string;
  trial?: TrialReport;
  cancel?: Cancel;
  moves: Move[];
  /** set for lessons generated from a weekly slot, keeps the generator idempotent */
  slotKey?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/** Money the family sent; lessons draw it down in date order. */
export interface Payment {
  id: ID;
  studentId: ID;
  /** 'yyyy-MM-dd' */
  date: string;
  /** UAH */
  amount: number;
  /** how many lessons it was meant for, for reference only */
  lessons?: number;
  note: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export type ThemeId = 'system' | 'light' | 'dark' | 'black' | 'sand' | 'ocean' | 'mint' | 'rose';

export type CalendarView = 'day' | 'week' | 'month';

export interface Settings {
  theme: ThemeId;
  defaultPrice: number;
  defaultDuration: number;
  defaultBilling: Billing;
  /** warn when a prepaid student has this many paid lessons left */
  lowBalanceLessons: number;
  dayStart: number;
  dayEnd: number;
  horizonWeeks: number;
  calendarView: CalendarView;
}
