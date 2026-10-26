import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nowStamp, todayKey } from '../lib/dates';
import { uid } from '../lib/format';
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
  TrialReport,
} from './types';

export interface DataState {
  students: Record<ID, Student>;
  groups: Record<ID, Group>;
  lessons: Record<ID, Lesson>;
  payments: Record<ID, Payment>;
  daysOff: Record<ID, DayOff>;
  settings: Settings;
  seeded: 'demo' | 'clean' | null;
}

export type StudentInput = Partial<Student> & { name: string };
export type GroupInput = Partial<Group> & { name: string };
export type PaymentInput = Partial<Payment> & { studentId: ID; amount: number };
export type DayOffInput = Partial<DayOff> & Pick<DayOff, 'from' | 'to' | 'kind'>;

export interface NewLessonInput {
  start: string;
  duration: number;
  participants: Participant[];
  groupId?: ID;
  topic?: string;
  kind?: LessonKind;
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
        settings: DEFAULT_SETTINGS,
        seeded: null,

        init() {
          if (get().seeded === null) get().loadDemo();
          else get().ensureSchedule();
        },

        ensureSchedule() {
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
          set({ students: { ...s.students, [id]: stamp({ ...st, deletedAt: Date.now() }) }, lessons, groups });
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
          patchLesson(id, (l) => ({ ...l, status: 'done', cancel: undefined }));
        },

        markManyDone(ids) {
          set((s) => {
            const lessons = { ...s.lessons };
            for (const id of ids) {
              const l = lessons[id];
              if (l) lessons[id] = stamp({ ...l, status: 'done' });
            }
            return { lessons };
          });
        },

        reopen(id) {
          patchLesson(id, (l) => ({ ...l, status: 'planned', cancel: undefined }));
        },

        cancelLesson(id, cancel) {
          patchLesson(id, (l) => ({ ...l, status: 'cancelled', cancel: { ...cancel, at: Date.now() } }));
        },

        moveLesson(id, to, by, reason, duration) {
          patchLesson(id, (l) => ({
            ...l,
            start: to,
            duration: duration ?? l.duration,
            status: 'planned',
            cancel: undefined,
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
              if (l.deletedAt || l.status !== 'planned' || day < next.from || day > next.to) continue;
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
            if (l.deletedAt || l.status !== 'cancelled' || day < d.from || day > d.to || l.start < now) continue;
            if (l.cancel?.by !== 'teacher' || l.cancel.reason !== reason) continue;
            lessons[l.id] = stamp({ ...l, status: 'planned', cancel: undefined });
          }
          set({ daysOff: { ...s.daysOff, [id]: stamp({ ...d, deletedAt: Date.now() }) }, lessons });
        },

        updateSettings(patch) {
          const prevHorizon = get().settings.horizonWeeks;
          set((s) => ({ settings: { ...s.settings, ...patch } }));
          if (patch.horizonWeeks && patch.horizonWeeks !== prevHorizon) get().ensureSchedule();
        },

        loadDemo() {
          set({ ...buildDemo(), seeded: 'demo' });
          get().ensureSchedule();
        },

        clearAll() {
          set({ students: {}, groups: {}, lessons: {}, payments: {}, daysOff: {}, seeded: 'clean' });
        },

        exportData() {
          const { students, groups, lessons, payments, daysOff, settings } = get();
          return JSON.stringify(
            { app: 'uroky', version: 2, exportedAt: new Date().toISOString(), students, groups, lessons, payments, daysOff, settings },
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
      partialize: ({ students, groups, lessons, payments, daysOff, settings, seeded }) => ({
        students,
        groups,
        lessons,
        payments,
        daysOff,
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
          settings: { ...DEFAULT_SETTINGS, ...p.settings },
        };
      },
    },
  ),
);
