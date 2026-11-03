import { create } from 'zustand';
import { cloud, cloudEnabled, useAccount } from './cloud';
import { useUi } from '../ui/uiStore';
import { useData } from './store';
import type { BotKind, ID } from './types';

/*
 * The Telegram bot, as the app sees it. Step 1: families connect to it.
 *
 * A bot can't write to anyone first, so every student has a personal link; the
 * parent opens it, presses «Почати», and the chat is tied to the student. Which
 * chats are connected comes from the server (supabase/migrations/…_bot.sql) and
 * is kept on the device, so the student cards show it offline too.
 */

export interface BotChat {
  studentId: ID;
  chatId: number;
  /** as Telegram shows the person who joined */
  name: string;
  username: string;
  linkedAt: string;
  /** the person blocked the bot */
  blocked: boolean;
}

export interface BotStatus {
  /** the server has a bot token */
  configured: boolean;
  username?: string;
  name?: string;
  /** Telegram delivers the bot's messages to the server */
  connected?: boolean;
  pending?: number;
  lastError?: string;
}

interface BotState {
  status?: BotStatus;
  chats: BotChat[];
  /** the last refresh failed (offline, or the server functions aren't there yet) */
  error?: string;
  loading: boolean;
}

const KEY = 'uroky-bot';

function stored(): Pick<BotState, 'status' | 'chats'> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && Array.isArray(v.chats)) return { status: v.status, chats: v.chats };
  } catch {
    /* nothing kept */
  }
  return { chats: [] };
}

function keep(s: Pick<BotState, 'status' | 'chats'>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ status: s.status, chats: s.chats }));
  } catch {
    /* private window: lives until reload */
  }
}

export const useBot = create<BotState>(() => ({ ...stored(), loading: false }));

/** Who handles the bot: the school's admins and managers, on the account. */
const allowed = () => {
  const a = useAccount.getState();
  return cloudEnabled && a.status === 'in' && (a.role === 'admin' || a.role === 'manager');
};

/** The server explains refusals itself; anything else is most likely the connection. */
async function reason(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    const body = await ctx.json().catch(() => null);
    if (body?.error) return body.error;
  }
  if (!navigator.onLine) return 'Немає інтернету';
  return error instanceof Error ? error.message : String(error);
}

async function call(action: 'status' | 'setup'): Promise<BotStatus> {
  const { data, error } = await cloud().functions.invoke('bot', { body: { action } });
  if (error) throw new Error(await reason(error));
  return data as BotStatus;
}

/** Telegram reaches the bot and this person may use it. */
export const botReady = (s: Pick<BotState, 'status'>) => allowed() && !!s.status?.configured && !!s.status.connected;

let lastRefresh = 0;

/** Reloads the bot's state and the connected chats. `force` skips the 10-second pause between refreshes. */
export async function refreshBot(force = false) {
  if (!allowed()) return;
  if (!force && Date.now() - lastRefresh < 10_000) return;
  lastRefresh = Date.now();
  useBot.setState({ loading: true });
  try {
    const [status, list] = await Promise.all([call('status'), cloud().rpc('bot_chats_list')]);
    if (list.error) throw new Error(await reason(list.error));
    const next = { status, chats: (list.data ?? []) as BotChat[] };
    keep(next);
    useBot.setState({ ...next, error: undefined, loading: false });
  } catch (e) {
    useBot.setState({ error: e instanceof Error ? e.message : String(e), loading: false });
  }
}

/** Admins: points Telegram at the server and gives the bot its commands and description. */
export async function setupBot() {
  const status = await call('setup');
  const next = { status, chats: useBot.getState().chats };
  keep(next);
  useBot.setState({ status, error: undefined });
}

/** The student's personal link; `renew` makes a new one and the old one stops working. */
export async function inviteLink(studentId: ID, renew = false): Promise<string> {
  const username = useBot.getState().status?.username;
  if (!username) throw new Error('Бот ще не підключений');
  const { data, error } = await cloud().rpc('bot_invite', { student: studentId, renew });
  if (error) throw new Error(await reason(error));
  return `https://t.me/${username}?start=${data as string}`;
}

/** What to send the family: a short explanation with the link. */
export const inviteText = (name: string, link: string) =>
  `Добрий день! Щоб отримувати в Telegram нагадування та повідомлення про уроки (${name}), відкрийте посилання й натисніть «Почати»:\n${link}`;

export async function unlinkChat(studentId: ID, chatId: number) {
  const { error } = await cloud().rpc('bot_unlink', { student: studentId, chat: chatId });
  if (error) throw new Error(await reason(error));
  const chats = useBot.getState().chats.filter((c) => !(c.studentId === studentId && c.chatId === chatId));
  keep({ status: useBot.getState().status, chats });
  useBot.setState({ chats });
}

/** The chats connected to one student, those that still receive messages first. */
export const chatsOf = (chats: BotChat[], studentId: ID) =>
  chats.filter((c) => c.studentId === studentId).sort((a, b) => Number(a.blocked) - Number(b.blocked));

/** A Telegram name to show: the name, the @username, or the bare chat. */
export const chatLabel = (c: BotChat) => c.name || (c.username ? `@${c.username}` : `чат ${c.chatId}`);

// Fresh on signing in, and whenever the app comes back to the screen — usually
// from Telegram, right after a parent pressed «Почати».
// The account is confirmed by the server (or changes): the session is ready for the bot's calls.
useAccount.subscribe((a, prev) => {
  if (a.status === 'in') refreshBot(prev.status !== 'in' || prev.role !== a.role);
  if (a.status !== 'in' && prev.status === 'in') {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing kept */
    }
    useBot.setState({ status: undefined, chats: [], error: undefined });
  }
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBot();
  });
}

/* ---------- sending ---------- */

export interface Outgoing {
  studentId: ID;
  text: string;
}

export interface SendResult {
  studentId: ID;
  chats: number;
  sent: number;
  blocked: number;
  failed: number;
}

/** Sends each text to the chats connected to its student; the server logs every attempt. */
export async function sendBot(kind: BotKind, messages: Outgoing[]): Promise<SendResult[]> {
  const { data, error } = await cloud().functions.invoke('bot', { body: { action: 'send', kind, messages } });
  if (error) throw new Error(await reason(error));
  const results = (data as { results: SendResult[] }).results;
  // A chat found blocked while sending is marked on the server; show it here too.
  if (results.some((r) => r.blocked)) refreshBot(true);
  return results;
}

/** How a sending went, for the card that stays until she closes it. */
export interface SendSummary {
  /** families that got it */
  sent: number;
  /** all the families it was about */
  total: number;
  /** families without the bot: their text, to pass on some other way */
  manual: { studentId: ID; name: string; text: string }[];
  /** families the bot couldn't reach */
  failed: { studentId: ID; name: string; text: string; blocked: boolean }[];
}

export const useBotResult = create<{ summary: SendSummary | null }>(() => ({ summary: null }));

export interface HistoryItem {
  at: string;
  kind: string;
  chatId: number;
  text: string;
  status: 'sent' | 'blocked' | 'failed';
  error: string;
  sentBy: string;
}

/** The latest messages about one student. */
export async function botHistory(studentId: ID): Promise<HistoryItem[]> {
  const { data, error } = await cloud().rpc('bot_history', { student: studentId, max_rows: 10 });
  if (error) throw new Error(await reason(error));
  return (data ?? []) as HistoryItem[];
}

/** Whether any of these students has a chat that can receive messages. */
export const anyConnected = (studentIds: ID[]) => {
  const chats = useBot.getState().chats;
  return studentIds.some((id) => chats.some((c) => c.studentId === id && !c.blocked));
};

/** The students in these lessons, without duplicates and without deleted ones. */
export function studentsOfLessons(lessonIds: ID[]): ID[] {
  const { lessons, students } = useData.getState();
  const ids = new Set<ID>();
  for (const id of lessonIds) for (const p of lessons[id]?.participants ?? []) if (students[p.studentId] && !students[p.studentId].deletedAt) ids.add(p.studentId);
  return [...ids];
}

/**
 * After a cancellation: offers «Повідомити батьків?» — only when the bot works
 * and at least one of the families has it. Otherwise nothing happens, so a
 * cancellation never turns into extra steps.
 */
export function offerNotify(o: { mode: BotKind; lessonIds: ID[]; from?: string; to?: string; reason?: string }) {
  if (!botReady(useBot.getState()) || o.lessonIds.length === 0) return;
  if (!anyConnected(studentsOfLessons(o.lessonIds))) return;
  useUi.getState().open({ kind: 'botNotify', ...o });
}
