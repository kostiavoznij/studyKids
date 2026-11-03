import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nowStamp, todayKey } from '../lib/dates';
import { uid } from '../lib/format';
import { currentRole } from './access';
import { DEFAULT_SETTINGS, dayOffLabel } from './constants';
import { buildDemo } from './demo';
import { migrateV1 } from './migrate';
import {
  blankLesson,
  changedSlots,
  isUntouchedFuture,
  missingScheduled,
  orphanedScheduled,
  reissueChanged,
  slotKeyOwner,
} from './schedule';
import type {
  BankMonth,
  BotTemplate,
  Cancel,
  DayOff,
  Group,
  ID,
  Initiator,
  Lesson,
  LessonKind,
  Participant,
  Payment,
  Settings,
  Student,
  StudentStatus,
  TaxPayment,
  TaxPlan,
  Teacher,
  TeacherPay,
  TeacherPayout,
  TrialReport,
} from './types';
import { TAX_PLAN_ID } from './taxes';
import { MAIN_TEACHER } from './types';
import { canDeleteTeacher, dayOffApplies, teacherOf, teacherTies } from './teachers';

export interface DataState {
  students: Record<ID, Student>;
  groups: Record<ID, Group>;
  lessons: Record<ID, Lesson>;
  payments: Record<ID, Payment>;
  daysOff: Record<ID, DayOff>;
  taxes: Record<ID, TaxPayment>;
  /** holds a single record, TAX_PLAN_ID */
  taxPlans: Record<ID, TaxPlan>;
  /** keyed by month 'yyyy-MM' */
  bankMonths: Record<ID, BankMonth>;
  teachers: Record<ID, Teacher>;
  /** keyed by teacher id; only on the admin's devices */
  teacherPay: Record<ID, TeacherPay>;
  teacherPayouts: Record<ID, TeacherPayout>;
  /** the bot's texts: the edited built-in ones by kind, her own ones by random id */
  botTemplates: Record<ID, BotTemplate>;
  settings: Settings;
  seeded: 'demo' | 'clean' | null;
}

export type StudentInput = Partial<Student> & { name: string };
export type GroupInput = Partial<Group> & { name: string };
export type PaymentInput = Partial<Payment> & { studentId: ID; amount: number };
export type DayOffInput = Partial<DayOff> & Pick<DayOff, 'from' | 'to' | 'kind'>;
export type TaxInput = Partial<TaxPayment> & Pick<TaxPayment, 'kind' | 'period' | 'date' | 'amount'>;
export type BankInput = Pick<BankMonth, 'month' | 'amount' | 'note' | 'acceptedDiff'>;
export type TeacherInput = Partial<Teacher> & { name: string };
export type PayInput = Pick<TeacherPay, 'mode' | 'rate' | 'trials' | 'lateCancels'>;
export type PayoutInput = Partial<TeacherPayout> & Pick<TeacherPayout, 'teacherId' | 'date' | 'amount'>;

export interface NewLessonInput {
  start: string;
  duration: number;
  participants: Participant[];
  groupId?: ID;
  topic?: string;
  kind?: LessonKind;
  teacherId?: ID;
}

interface Actions {
  init(): void;
  ensureSchedule(): void;
  saveStudent(input: StudentInput): ID;
  setStudentStatus(id: ID, status: StudentStatus): void;
  deleteStudent(id: ID): void;
  addNote(studentId: ID, text: string): void;
  deleteNote(studentId: ID, noteId: ID): void;
  saveGroup(input: GroupInput): ID;
  deleteGroup(id: ID): void;
  createLesson(input: NewLessonInput): ID;
  updateLesson(id: ID, patch: Partial<Lesson>): void;
  updateTrial(id: ID, patch: Partial<TrialReport>): void;
  updateParticipant(id: ID, studentId: ID, patch: Partial<Participant>): void;
  putLesson(lesson: Lesson): void;
  markDone(id: ID): void;
  /** the teacher's «the student didn't come» */
  setMissed(id: ID, missed: boolean): void;
  markManyDone(ids: ID[]): void;
  reopen(id: ID): void;
  cancelLesson(id: ID, cancel: Omit<Cancel, 'at'>): void;
  moveLesson(id: ID, to: string, by: Initiator, reason: string, duration?: number): void;
  deleteLesson(id: ID): void;
  savePayment(input: PaymentInput): ID;
  deletePayment(id: ID): void;
  /** Marks days without lessons; with cancelLessons, planned lessons on those days get cancelled. */
  saveDayOff(input: DayOffInput): ID;
  /** Removes the mark and brings back future lessons it had cancelled. */
  deleteDayOff(id: ID): void;
  saveTax(input: TaxInput): ID;
  deleteTax(id: ID): void;
  saveTaxPlan(plan: Pick<TaxPlan, 'start' | 'rules'>): void;
  saveBankMonth(input: BankInput): void;
  deleteBankMonth(month: string): void;
  saveTeacher(input: TeacherInput): ID;
  /**
   * Deletes a teacher's card for good (one added by mistake or to try things out).
   * Refuses — returns false — while teacherTies() still holds her; her past lessons
   * and archived students go to the main teacher, her own days off and pay terms go.
   */
  deleteTeacher(id: ID): boolean;
  saveTeacherPay(teacherId: ID, input: PayInput): void;
  savePayout(input: PayoutInput): ID;
  deletePayout(id: ID): void;
  /** A built-in template is saved under its kind; her own get a random id. */
  saveBotTemplate(input: Pick<BotTemplate, 'kind' | 'name' | 'text'> & { id?: ID }): ID;
  /** Her own template goes; a built-in one goes back to the default text. */
  deleteBotTemplate(id: ID): void;
  updateSettings(patch: Partial<Settings>): void;
  loadDemo(): void;
  clearAll(): void;
  exportData(): string;
  importData(json: string): boolean;
}

type Store = DataState & Actions;

const stamp = <T extends { updatedAt: number }>(x: T): T => ({ ...x, updatedAt: Date.now() });

/** Soft-delete future untouched lessons matching the predicate. */
function dropFuture(lessons: Record<ID, Lesson>, match: (l: Lesson) => boolean): Record<ID, Lesson> {
  const now = nowStamp();
  const t = Date.now();
  let out = lessons;
  for (const l of Object.values(lessons)) {
    if (isUntouchedFuture(l, now) && match(l)) {
      if (out === lessons) out = { ...lessons };
      out[l.id] = { ...l, deletedAt: t, updatedAt: t };
    }
  }
  return out;
}

const ownedBySlot = (kind: 's' | 'g', ownerId: ID, slotIds?: Set<string>) => (l: Lesson) => {
  if (!l.slotKey) return false;
  const k = slotKeyOwner(l.slotKey);
  return k.kind === kind && k.owner === ownerId && (!slotIds || slotIds.has(k.slotId));
};

const EMPTY_TRIAL: TrialReport = { level: '', strengths: '', weaknesses: '', plan: '' };

/** Lessons still ahead go with the student (or group) to the new teacher; the past stays with whoever taught it. */
function reassignFuture(lessons: Record<ID, Lesson>, match: (l: Lesson) => boolean, teacherId: ID): Record<ID, Lesson> {
  const now = nowStamp();
  let out = lessons;
  for (const l of Object.values(lessons)) {
    if (l.deletedAt || l.status !== 'planned' || l.start < now || !match(l) || teacherOf(l) === teacherId) continue;
    if (out === lessons) out = { ...lessons };
    out[l.id] = stamp({ ...l, teacherId });
  }
  return out;
}

export const useData = create<Store>()(
  persist(
    (set, get) => {
      const patchLesson = (id: ID, fn: (l: Lesson) => Lesson) =>
        set((s) => {
          const l = s.lessons[id];
          if (!l) return s;
          return { lessons: { ...s.lessons, [id]: stamp(fn(l)) } };
        });

      return {
        students: {},
        groups: {},
        lessons: {},
        payments: {},
        daysOff: {},
        taxes: {},
        taxPlans: {},
        bankMonths: {},
        teachers: {},
        teacherPay: {},
        teacherPayouts: {},
        botTemplates: {},
        settings: DEFAULT_SETTINGS,
        seeded: null,

        init() {
          if (get().seeded === null) get().loadDemo();
          else get().ensureSchedule();
        },

        ensureSchedule() {
          // A teacher's device only shows what the school planned; the weekly schedule isn't even on it.
          if (currentRole() === 'teacher') return;
          const s = get();
          const list = Object.values(s.lessons);
          const orphans = orphanedScheduled(s.students, s.groups, list, nowStamp());
          const fresh = missingScheduled(
            Object.values(s.students),
            Object.values(s.groups),
            list,
            s.settings.horizonWeeks,
            Object.values(s.daysOff),
          );
          if (fresh.length === 0 && orphans.length === 0) return;
          const lessons = { ...s.lessons };
          const t = Date.now();
          for (const l of orphans) lessons[l.id] = { ...l, deletedAt: t, updatedAt: t };
          for (const l of fresh) lessons[l.id] = l;
          set({ lessons });
        },

        saveStudent(input) {
          const s = get();
          const prev = input.id ? s.students[input.id] : undefined;
          let lessons = s.lessons;
          let next: Student;

          if (prev) {
            next = stamp({ ...prev, ...input });
            const changed = changedSlots(prev.schedule, next.schedule);
            next.schedule = reissueChanged(next.schedule, changed);
            if (changed.size) lessons = dropFuture(lessons, ownedBySlot('s', prev.id, changed));
            if (next.status !== 'active') lessons = dropFuture(lessons, ownedBySlot('s', prev.id));
            if (teacherOf(next) !== teacherOf(prev)) {
              lessons = reassignFuture(lessons, (l) => !l.groupId && l.participants.some((p) => p.studentId === prev.id), teacherOf(next));
            }

            // A new price applies to future lessons that still carry the old one.
            if (next.price !== prev.price) {
              const now = nowStamp();
              lessons = { ...lessons };
              for (const l of Object.values(lessons)) {
                if (l.deletedAt || l.status !== 'planned' || l.start < now || l.groupId || l.kind === 'trial') continue;
                const p = l.participants.find((x) => x.studentId === prev.id);
                if (!p || p.price !== prev.price) continue;
                lessons[l.id] = stamp({
                  ...l,
                  participants: l.participants.map((x) => (x === p ? { ...x, price: next.price } : x)),
                });
              }
            }
          } else {
            const t = Date.now();
            next = {
              id: uid(),
              color: 'violet',
              subject: 'Українська мова',
              grade: '',
              price: s.settings.defaultPrice,
              billing: s.settings.defaultBilling,
              duration: s.settings.defaultDuration,
              timezone: '',
              contact: {},
              schedule: [],
              status: 'active',
              startDate: todayKey(),
              notes: [],
              createdAt: t,
              updatedAt: t,
              ...input,
            };
          }

          set({ students: { ...s.students, [next.id]: next }, lessons });
          get().ensureSchedule();
          return next.id;
        },

        setStudentStatus(id, status) {
          const st = get().students[id];
          if (st) get().saveStudent({ ...st, status });
        },

        deleteStudent(id) {
          const s = get();
          const st = s.students[id];
          if (!st) return;
          const lessons = dropFuture(s.lessons, (l) => !l.groupId && l.participants.some((p) => p.studentId === id));
          const groups = { ...s.groups };
          for (const g of Object.values(groups)) {
            if (g.studentIds.includes(id)) groups[g.id] = stamp({ ...g, studentIds: g.studentIds.filter((x) => x !== id) });
          }
          // A deleted student's payments would still count as money that came in, with nowhere to see them.
          const payments = { ...s.payments };
          for (const p of Object.values(payments)) {
            if (p.studentId === id && !p.deletedAt) payments[p.id] = stamp({ ...p, deletedAt: Date.now() });
          }
          set({ students: { ...s.students, [id]: stamp({ ...st, deletedAt: Date.now() }) }, lessons, groups, payments });
        },

        addNote(studentId, text) {
          const st = get().students[studentId];
          if (!st || !text.trim()) return;
          const note = { id: uid(), date: todayKey(), text: text.trim() };
          set((s) => ({ students: { ...s.students, [studentId]: stamp({ ...st, notes: [note, ...st.notes] }) } }));
        },

        deleteNote(studentId, noteId) {
          const st = get().students[studentId];
          if (!st) return;
          set((s) => ({
            students: { ...s.students, [studentId]: stamp({ ...st, notes: st.notes.filter((n) => n.id !== noteId) }) },
          }));
        },

        saveGroup(input) {
          const s = get();
          const prev = input.id ? s.groups[input.id] : undefined;
          let lessons = s.lessons;
          let next: Group;
          if (prev) {
            next = stamp({ ...prev, ...input });
            const relevant =
              prev.price !== next.price ||
              prev.studentIds.join() !== next.studentIds.join() ||
              changedSlots(prev.schedule, next.schedule).size > 0 ||
              next.status !== 'active';
            if (relevant) {
              // Members or price changed: rebuild every future untouched lesson of the group.
              lessons = dropFuture(lessons, ownedBySlot('g', prev.id));
              next.schedule = next.schedule.map((sl) => ({ ...sl, id: uid() }));
            }
            if (teacherOf(next) !== teacherOf(prev)) lessons = reassignFuture(lessons, (l) => l.groupId === prev.id, teacherOf(next));
          } else {
            const t = Date.now();
            next = {
              id: uid(),
              color: 'teal',
              studentIds: [],
              schedule: [],
              price: s.settings.defaultPrice,
              duration: s.settings.defaultDuration,
              status: 'active',
              createdAt: t,
              updatedAt: t,
              ...input,
            };
          }
          set({ groups: { ...s.groups, [next.id]: next }, lessons });
          get().ensureSchedule();
          return next.id;
        },

        deleteGroup(id) {
          const s = get();
          const g = s.groups[id];
          if (!g) return;
          const lessons = dropFuture(s.lessons, (l) => l.groupId === id);
          set({ groups: { ...s.groups, [id]: stamp({ ...g, deletedAt: Date.now() }) }, lessons });
        },

        createLesson(input) {
          const l = blankLesson(input.start, input.duration, input.participants);
          if (input.groupId) l.groupId = input.groupId;
          if (input.teacherId) l.teacherId = input.teacherId;
          if (input.topic) l.topic = input.topic;
          if (input.kind === 'trial') {
            l.kind = 'trial';
            l.trial = { ...EMPTY_TRIAL };
            l.participants = l.participants.map((p) => ({ ...p, price: 0 }));
          }
          set((s) => ({ lessons: { ...s.lessons, [l.id]: l } }));
          return l.id;
        },

        updateLesson(id, patch) {
          patchLesson(id, (l) => ({ ...l, ...patch }));
        },

        updateTrial(id, patch) {
          patchLesson(id, (l) => ({ ...l, trial: { ...EMPTY_TRIAL, ...l.trial, ...patch } }));
        },

        updateParticipant(id, studentId, patch) {
          patchLesson(id, (l) => ({
            ...l,
            participants: l.participants.map((p) => (p.studentId === studentId ? { ...p, ...patch } : p)),
          }));
        },

        putLesson(lesson) {
          set((s) => ({ lessons: { ...s.lessons, [lesson.id]: stamp(lesson) } }));
        },

        markDone(id) {
          patchLesson(id, (l) => ({ ...l, status: 'done', cancel: undefined, missed: undefined }));
        },

        setMissed(id, missed) {
          patchLesson(id, (l) => ({ ...l, missed: missed || undefined }));
        },

        markManyDone(ids) {
          set((s) => {
            const lessons = { ...s.lessons };
            for (const id of ids) {
              const l = lessons[id];
              if (l) lessons[id] = stamp({ ...l, status: 'done', missed: undefined });
            }
            return { lessons };
          });
        },

        reopen(id) {
          patchLesson(id, (l) => ({ ...l, status: 'planned', cancel: undefined }));
        },

        cancelLesson(id, cancel) {
          patchLesson(id, (l) => ({ ...l, status: 'cancelled', cancel: { ...cancel, at: Date.now() }, missed: undefined }));
        },

        moveLesson(id, to, by, reason, duration) {
          patchLesson(id, (l) => ({
            ...l,
            start: to,
            duration: duration ?? l.duration,
            status: 'planned',
            cancel: undefined,
            missed: undefined,
            moves: [...l.moves, { from: l.start, to, by, reason, at: Date.now() }],
          }));
        },

        deleteLesson(id) {
          patchLesson(id, (l) => ({ ...l, deletedAt: Date.now() }));
        },

        savePayment(input) {
          const s = get();
          const prev = input.id ? s.payments[input.id] : undefined;
          const t = Date.now();
          const next: Payment = prev
            ? stamp({ ...prev, ...input })
            : { id: uid(), date: todayKey(), note: '', createdAt: t, updatedAt: t, ...input };
          set({ payments: { ...s.payments, [next.id]: next } });
          return next.id;
        },

        deletePayment(id) {
          const p = get().payments[id];
          if (!p) return;
          set((s) => ({ payments: { ...s.payments, [id]: stamp({ ...p, deletedAt: Date.now() }) } }));
        },

        saveDayOff(input) {
          const s = get();
          const prev = input.id ? s.daysOff[input.id] : undefined;
          const t = Date.now();
          const next: DayOff = prev
            ? stamp({ ...prev, ...input })
            : { id: uid(), note: '', cancelLessons: true, createdAt: t, updatedAt: t, ...input };
          let lessons = s.lessons;
          if (next.cancelLessons) {
            const reason = dayOffLabel(next.kind);
            lessons = { ...lessons };
            for (const l of Object.values(s.lessons)) {
              const day = l.start.slice(0, 10);
              if (l.deletedAt || l.status !== 'planned' || day < next.from || day > next.to || !dayOffApplies(next, teacherOf(l))) continue;
              lessons[l.id] = stamp({ ...l, status: 'cancelled', cancel: { by: 'teacher', reason, charged: false, at: t } });
            }
          }
          set({ daysOff: { ...s.daysOff, [next.id]: next }, lessons });
          return next.id;
        },

        deleteDayOff(id) {
          const s = get();
          const d = s.daysOff[id];
          if (!d) return;
          const reason = dayOffLabel(d.kind);
          const now = nowStamp();
          const lessons = { ...s.lessons };
          for (const l of Object.values(s.lessons)) {
            const day = l.start.slice(0, 10);
            if (l.deletedAt || l.status !== 'cancelled' || day < d.from || day > d.to || l.start < now || !dayOffApplies(d, teacherOf(l))) continue;
            if (l.cancel?.by !== 'teacher' || l.cancel.reason !== reason) continue;
            lessons[l.id] = stamp({ ...l, status: 'planned', cancel: undefined });
          }
          set({ daysOff: { ...s.daysOff, [id]: stamp({ ...d, deletedAt: Date.now() }) }, lessons });
        },

        saveTax(input) {
          const s = get();
          const prev = input.id ? s.taxes[input.id] : undefined;
          const t = Date.now();
          const next: TaxPayment = prev ? stamp({ ...prev, ...input }) : { id: uid(), note: '', createdAt: t, updatedAt: t, ...input };
          set({ taxes: { ...s.taxes, [next.id]: next } });
          return next.id;
        },

        deleteTax(id) {
          const x = get().taxes[id];
          if (!x) return;
          set((s) => ({ taxes: { ...s.taxes, [id]: stamp({ ...x, deletedAt: Date.now() }) } }));
        },

        saveTaxPlan({ start, rules }) {
          const prev = get().taxPlans[TAX_PLAN_ID];
          const t = Date.now();
          const next: TaxPlan = prev ? stamp({ ...prev, start, rules, deletedAt: undefined }) : { id: TAX_PLAN_ID, start, rules, createdAt: t, updatedAt: t };
          set((s) => ({ taxPlans: { ...s.taxPlans, [TAX_PLAN_ID]: next } }));
        },

        saveBankMonth({ month, amount, note, acceptedDiff }) {
          const prev = get().bankMonths[month];
          const t = Date.now();
          const next: BankMonth = prev
            ? stamp({ ...prev, amount, note, acceptedDiff, deletedAt: undefined })
            : { id: month, month, amount, note, acceptedDiff, createdAt: t, updatedAt: t };
          set((s) => ({ bankMonths: { ...s.bankMonths, [month]: next } }));
        },

        deleteBankMonth(month) {
          const prev = get().bankMonths[month];
          if (!prev) return;
          set((s) => ({ bankMonths: { ...s.bankMonths, [month]: stamp({ ...prev, deletedAt: Date.now() }) } }));
        },

        saveTeacher(input) {
          const s = get();
          const prev = input.id ? s.teachers[input.id] : undefined;
          const t = Date.now();
          const next: Teacher = prev
            ? stamp({ ...prev, ...input })
            : { id: uid(), color: 'teal', email: '', status: 'active', createdAt: t, updatedAt: t, ...input };
          next.email = next.email.trim().toLowerCase();
          set({ teachers: { ...s.teachers, [next.id]: next } });
          return next.id;
        },

        deleteTeacher(id) {
          const s = get();
          const card = s.teachers[id];
          if (!card || card.deletedAt || id === MAIN_TEACHER || !canDeleteTeacher(teacherTies(s, id, nowStamp()))) return false;
          const at = Date.now();
          const hers = (x: { teacherId?: ID; deletedAt?: number }) => !x.deletedAt && teacherOf(x) === id;
          // Each record is copied only if it changes, so nothing else gets pushed again.
          const move = <T extends { id: ID; teacherId?: ID; deletedAt?: number; updatedAt: number }>(rec: Record<ID, T>): Record<ID, T> => {
            let out = rec;
            for (const x of Object.values(rec)) {
              if (!hers(x)) continue;
              if (out === rec) out = { ...rec };
              out[x.id] = stamp({ ...x, teacherId: undefined });
            }
            return out;
          };
          let daysOff = s.daysOff;
          for (const d of Object.values(s.daysOff)) {
            if (d.deletedAt || d.teacherId !== id) continue;
            if (daysOff === s.daysOff) daysOff = { ...s.daysOff };
            daysOff[d.id] = stamp({ ...d, deletedAt: at });
          }
          const pay = s.teacherPay[id];
          set({
            teachers: { ...s.teachers, [id]: stamp({ ...card, deletedAt: at }) },
            lessons: move(s.lessons),
            students: move(s.students),
            groups: move(s.groups),
            daysOff,
            teacherPay: pay && !pay.deletedAt ? { ...s.teacherPay, [id]: stamp({ ...pay, deletedAt: at }) } : s.teacherPay,
          });
          return true;
        },

        saveTeacherPay(teacherId, input) {
          const prev = get().teacherPay[teacherId];
          const t = Date.now();
          const next: TeacherPay = prev
            ? stamp({ ...prev, ...input, deletedAt: undefined })
            : { id: teacherId, createdAt: t, updatedAt: t, ...input };
          set((s) => ({ teacherPay: { ...s.teacherPay, [teacherId]: next } }));
        },

        savePayout(input) {
          const s = get();
          const prev = input.id ? s.teacherPayouts[input.id] : undefined;
          const t = Date.now();
          const next: TeacherPayout = prev ? stamp({ ...prev, ...input }) : { id: uid(), note: '', createdAt: t, updatedAt: t, ...input };
          set({ teacherPayouts: { ...s.teacherPayouts, [next.id]: next } });
          return next.id;
        },

        deletePayout(id) {
          const x = get().teacherPayouts[id];
          if (!x) return;
          set((s) => ({ teacherPayouts: { ...s.teacherPayouts, [id]: stamp({ ...x, deletedAt: Date.now() }) } }));
        },

        saveBotTemplate(input) {
          const s = get();
          const id = input.id ?? (input.kind === 'free' ? uid() : input.kind);
          const prev = s.botTemplates[id];
          const t = Date.now();
          const next: BotTemplate = prev
            ? stamp({ ...prev, name: input.name, text: input.text, deletedAt: undefined })
            : { id, kind: input.kind, name: input.name, text: input.text, createdAt: t, updatedAt: t };
          set({ botTemplates: { ...s.botTemplates, [id]: next } });
          return id;
        },

        deleteBotTemplate(id) {
          const x = get().botTemplates[id];
          if (!x || x.deletedAt) return;
          set((s) => ({ botTemplates: { ...s.botTemplates, [id]: stamp({ ...x, deletedAt: Date.now() }) } }));
        },

        updateSettings(patch) {
          const prevHorizon = get().settings.horizonWeeks;
          set((s) => ({ settings: { ...s.settings, ...patch } }));
          if (patch.horizonWeeks && patch.horizonWeeks !== prevHorizon) get().ensureSchedule();
        },

        loadDemo() {
          set({ taxPlans: {}, bankMonths: {}, teachers: {}, teacherPay: {}, teacherPayouts: {}, botTemplates: {}, ...buildDemo(), seeded: 'demo' });
          get().ensureSchedule();
        },

        clearAll() {
          set({
            students: {},
            groups: {},
            lessons: {},
            payments: {},
            daysOff: {},
            taxes: {},
            taxPlans: {},
            bankMonths: {},
            teachers: {},
            teacherPay: {},
            teacherPayouts: {},
            botTemplates: {},
            seeded: 'clean',
          });
        },

        exportData() {
          const { students, groups, lessons, payments, daysOff, taxes, taxPlans, bankMonths, teachers, teacherPay, teacherPayouts, botTemplates, settings } = get();
          return JSON.stringify(
            {
              app: 'uroky',
              version: 2,
              exportedAt: new Date().toISOString(),
              students,
              groups,
              lessons,
              payments,
              daysOff,
              taxes,
              taxPlans,
              bankMonths,
              teachers,
              teacherPay,
              teacherPayouts,
              botTemplates,
              settings,
            },
            null,
            1,
          );
        },

        importData(json) {
          try {
            let d = JSON.parse(json);
            if (d.app !== 'uroky' || typeof d.students !== 'object' || typeof d.lessons !== 'object') return false;
            if (!d.version || d.version < 2) d = migrateV1(d);
            set({
              students: d.students,
              groups: d.groups ?? {},
              lessons: d.lessons,
              payments: d.payments ?? {},
              daysOff: d.daysOff ?? {},
              taxes: d.taxes ?? {},
              taxPlans: d.taxPlans ?? {},
              bankMonths: d.bankMonths ?? {},
              teachers: d.teachers ?? {},
              teacherPay: d.teacherPay ?? {},
              teacherPayouts: d.teacherPayouts ?? {},
              botTemplates: d.botTemplates ?? {},
              settings: { ...DEFAULT_SETTINGS, ...d.settings },
              seeded: 'clean',
            });
            get().ensureSchedule();
            return true;
          } catch {
            return false;
          }
        },
      };
    },
    {
      name: 'uroky-data',
      version: 2,
      partialize: ({ students, groups, lessons, payments, daysOff, taxes, taxPlans, bankMonths, teachers, teacherPay, teacherPayouts, botTemplates, settings, seeded }) => ({
        students,
        groups,
        lessons,
        payments,
        daysOff,
        taxes,
        taxPlans,
        bankMonths,
        teachers,
        teacherPay,
        teacherPayouts,
        botTemplates,
        settings,
        seeded,
      }),
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as DataState;
        // Keep the old copy around in case something goes wrong with the conversion.
        try {
          localStorage.setItem('uroky-data-v1-backup', JSON.stringify(persisted));
        } catch {
          /* storage full or blocked — the migration still runs */
        }
        const old = persisted as { seeded?: string } | undefined;
        if (!old || old.seeded !== 'clean') return { seeded: null } as unknown as DataState;
        return migrateV1(old) as DataState;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DataState>;
        return {
          ...current,
          ...p,
          payments: p.payments ?? {},
          daysOff: p.daysOff ?? {},
          taxes: p.taxes ?? {},
          taxPlans: p.taxPlans ?? {},
          bankMonths: p.bankMonths ?? {},
          teachers: p.teachers ?? {},
          teacherPay: p.teacherPay ?? {},
          teacherPayouts: p.teacherPayouts ?? {},
          botTemplates: p.botTemplates ?? {},
          settings: { ...DEFAULT_SETTINGS, ...p.settings },
        };
      },
    },
  ),
);
