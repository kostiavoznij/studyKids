import { create } from 'zustand';
import type { ID } from '../data/types';

export type Overlay =
  | { kind: 'lesson'; id: ID }
  | { kind: 'newLesson'; start?: string; studentId?: ID; groupId?: ID; trial?: boolean }
  | { kind: 'student'; id?: ID }
  | { kind: 'group'; id?: ID }
  | { kind: 'payment'; id?: ID; studentId?: ID; lessons?: number }
  | { kind: 'dayOff'; id?: ID; day?: string };

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
  open(o: Overlay): void;
  close(): void;
  notify(text: string, undo?: () => void): void;
  dismissToast(): void;
  setDay(day: string | null): void;
}

let toastSeq = 0;

export const useUi = create<UiState>()((set) => ({
  overlay: null,
  toast: null,
  confirm: null,
  day: null,
  open: (overlay) => set({ overlay }),
  close: () => set({ overlay: null }),
  notify: (text, undo) => set({ toast: { id: ++toastSeq, text, undo } }),
  dismissToast: () => set({ toast: null }),
  setDay: (day) => set({ day }),
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
