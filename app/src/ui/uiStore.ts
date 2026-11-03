import { create } from 'zustand';
import type { BotKind, ID, TaxKind } from '../data/types';

export type Overlay =
  | { kind: 'lesson'; id: ID }
  | { kind: 'newLesson'; start?: string; studentId?: ID; groupId?: ID; trial?: boolean; teacherId?: ID }
  | { kind: 'student'; id?: ID }
  | { kind: 'group'; id?: ID }
  | { kind: 'payment'; id?: ID; studentId?: ID; groupId?: ID; lessons?: number; date?: string }
  | { kind: 'dayOff'; id?: ID; day?: string; teacherId?: ID }
  | { kind: 'tax'; id?: ID; taxKind?: TaxKind; period?: string }
  | { kind: 'taxPlan' }
  | { kind: 'bank'; month: string }
  | { kind: 'teacher'; id?: ID }
  | { kind: 'payout'; id?: ID; teacherId?: ID }
  | { kind: 'botNotify'; mode: BotKind; lessonIds?: ID[]; studentIds?: ID[]; from?: string; to?: string; reason?: string }
  | { kind: 'botTemplate'; id?: ID; templateKind: BotKind };

interface Toast {
  id: number;
  text: string;
  undo?: () => void;
}

interface Confirm {
  title: string;
  text?: string;
  ok: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}

interface UiState {
  overlay: Overlay | null;
  toast: Toast | null;
  confirm: Confirm | null;
  /** selected calendar day 'yyyy-MM-dd' */
  day: string | null;
  /** whose lessons the calendar shows; null — everyone's */
  teacher: ID | null;
  open(o: Overlay): void;
  close(): void;
  notify(text: string, undo?: () => void): void;
  dismissToast(): void;
  setDay(day: string | null): void;
  setTeacher(teacher: ID | null): void;
}

let toastSeq = 0;

export const useUi = create<UiState>()((set) => ({
  overlay: null,
  toast: null,
  confirm: null,
  day: null,
  teacher: null,
  open: (overlay) => set({ overlay }),
  close: () => set({ overlay: null }),
  notify: (text, undo) => set({ toast: { id: ++toastSeq, text, undo } }),
  dismissToast: () => set({ toast: null }),
  setDay: (day) => set({ day }),
  setTeacher: (teacher) => set({ teacher }),
}));

export function ask(opts: Omit<Confirm, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useUi.setState({
      confirm: {
        ...opts,
        resolve: (v) => {
          useUi.setState({ confirm: null });
          resolve(v);
        },
      },
    });
  });
}
