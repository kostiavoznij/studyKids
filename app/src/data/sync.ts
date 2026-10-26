import { create } from 'zustand';
import { useData, type DataState } from './store';
import type { ID } from './types';

/*
 * Sync with the Google Sheet backend (backend/Code.gs).
 *
 * Every record carries updatedAt. A record is "dirty" when its updatedAt differs
 * from the one the server last confirmed; dirty records are pushed, then every
 * change newer than our last revision is pulled. Both sides keep the later
 * updatedAt, so edits made on two devices settle on the newest one.
 */

const TYPES = ['students', 'groups', 'lessons', 'payments'] as const;
type RecType = (typeof TYPES)[number];
type AnyRecord = { id: ID; updatedAt: number };
type Records = Partial<Record<RecType, AnyRecord[]>>;

interface SyncConfig {
  url: string;
  key: string;
  /** last server revision we have seen */
  lastRev: number;
  /** `${type}:${id}` → updatedAt the server already has */
  confirmed: Record<string, number>;
}

const STORAGE = 'uroky-sync';
const BATCH = 300;

function loadConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
}

function saveConfig(cfg: SyncConfig) {
  localStorage.setItem(STORAGE, JSON.stringify(cfg));
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  configured: boolean;
  lastSyncAt?: number;
  error?: string;
  /** local changes not yet on the server */
  pending: number;
}

export const useSync = create<SyncState>(() => ({ status: 'off', configured: false, pending: 0 }));

/* ---------- transport ---------- */

export class SyncError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  bad_key: 'Невірний код доступу',
  not_set_up: 'У таблиці ще не запущено setup',
  server: 'Помилка на боці таблиці',
  network: 'Немає зв’язку з таблицею',
  not_json: 'Адреса не відповідає. Перевірте, що в розгортанні вибрано доступ «Будь-хто» (Anyone)',
};

async function call<T>(cfg: { url: string; key: string }, action: string, payload: object = {}): Promise<T> {
  let res: Response;
  try {
    // text/plain keeps this a "simple" request — Apps Script can't answer CORS preflight.
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: cfg.key, action, ...payload }),
      redirect: 'follow',
    });
  } catch {
    throw new SyncError('network', MESSAGES.network);
  }
  let data: { ok: boolean; error?: string; message?: string } & T;
  try {
    data = await res.json();
  } catch {
    throw new SyncError('not_json', MESSAGES.not_json);
  }
  if (!data.ok) {
    const code = data.error ?? 'server';
    throw new SyncError(code, MESSAGES[code] ?? data.message ?? code);
  }
  return data;
}

/* ---------- merge ---------- */

function dirtyRecords(s: DataState, confirmed: Record<string, number>): Records {
  const out: Records = {};
  for (const type of TYPES) {
    const list = (Object.values(s[type]) as AnyRecord[]).filter((r) => confirmed[`${type}:${r.id}`] !== r.updatedAt);
    if (list.length) out[type] = list;
  }
  return out;
}

const countOf = (r: Records) => TYPES.reduce((n, t) => n + (r[t]?.length ?? 0), 0);

function applyRemote(records: Records, confirmed: Record<string, number>) {
  useData.setState((s) => {
    const next: Partial<DataState> = {};
    for (const type of TYPES) {
      const incoming = records[type];
      if (!incoming?.length) continue;
      let map = s[type] as Record<ID, AnyRecord>;
      let copied = false;
      for (const rec of incoming) {
        const local = map[rec.id];
        if (!local || rec.updatedAt > local.updatedAt) {
          if (!copied) {
            map = { ...map };
            copied = true;
          }
          map[rec.id] = rec;
          confirmed[`${type}:${rec.id}`] = rec.updatedAt;
        } else if (rec.updatedAt === local.updatedAt) {
          confirmed[`${type}:${rec.id}`] = rec.updatedAt;
        }
        // a newer local copy stays dirty and goes up on the next push
      }
      if (copied) (next as Record<RecType, unknown>)[type] = map;
    }
    return next;
  });
}

/** Splits dirty records into requests of at most BATCH records. */
function* batches(records: Records) {
  let cur: Records = {};
  let n = 0;
  for (const type of TYPES) {
    for (const rec of records[type] ?? []) {
      (cur[type] ??= []).push(rec);
      if (++n >= BATCH) {
        yield cur;
        cur = {};
        n = 0;
      }
    }
  }
  if (n) yield cur;
}

/* ---------- the sync loop ---------- */

let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function syncOnce() {
  const cfg = loadConfig();
  if (!cfg) {
    useSync.setState({ status: 'off', configured: false });
    return;
  }
  // Demo data must never reach the real table.
  if (useData.getState().seeded === 'demo') return;
  if (!navigator.onLine) {
    useSync.setState({ status: 'offline' });
    return;
  }
  useSync.setState({ status: 'syncing', configured: true });
  try {
    for (const batch of batches(dirtyRecords(useData.getState(), cfg.confirmed))) {
      await call(cfg, 'push', { records: batch });
      for (const type of TYPES) for (const rec of batch[type] ?? []) cfg.confirmed[`${type}:${rec.id}`] = rec.updatedAt;
      saveConfig(cfg);
    }
    const res = await call<{ rev: number; records: Records }>(cfg, 'pull', { since: cfg.lastRev });
    applyRemote(res.records, cfg.confirmed);
    cfg.lastRev = res.rev;
    saveConfig(cfg);
    useData.getState().ensureSchedule();
    useSync.setState({
      status: 'idle',
      lastSyncAt: Date.now(),
      error: undefined,
      pending: countOf(dirtyRecords(useData.getState(), cfg.confirmed)),
    });
  } catch (e) {
    const offline = e instanceof SyncError && e.code === 'network' && !navigator.onLine;
    useSync.setState({ status: offline ? 'offline' : 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Sets up the triggers once; they do nothing until a table is connected. */
export function startSync() {
  useSync.setState({ configured: !!loadConfig() });

  let timer: number | undefined;
  useData.subscribe((s, prev) => {
    if (!TYPES.some((t) => s[t] !== prev[t])) return;
    const cfg = loadConfig();
    if (!cfg) return;
    const pending = countOf(dirtyRecords(s, cfg.confirmed));
    useSync.setState({ pending });
    if (pending === 0) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(syncNow, 1500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  window.addEventListener('online', () => syncNow());
  window.setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, 60_000);
  syncNow();
}

/* ---------- connecting ---------- */

const URL_RE = /(https?:\/\/[^\s"'<>]+\/exec)\b/;
const KEY_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})\b/;

/** Pulls the address and the access code out of whatever was pasted. */
export function parseConnection(text: string): { url: string; key: string } | null {
  const url = text.match(URL_RE)?.[1];
  const key = text.toUpperCase().match(KEY_RE)?.[1];
  return url && key ? { url, key } : null;
}

export interface RemoteInfo {
  rev: number;
  counts: Record<RecType, number>;
}

export function checkConnection(url: string, key: string) {
  return call<RemoteInfo>({ url, key }, 'ping');
}

/**
 * 'replace' — wipe this device and take the table;
 * 'merge' — send this device's records and take the table's (newest wins).
 */
export async function connect(url: string, key: string, mode: 'replace' | 'merge') {
  if (mode === 'replace' || useData.getState().seeded === 'demo') useData.getState().clearAll();
  saveConfig({ url, key, lastRev: 0, confirmed: {} });
  useSync.setState({ configured: true, status: 'idle', error: undefined });
  await call({ url, key }, 'hello', { url }).catch(() => undefined);
  await syncNow();
}

export function disconnect() {
  localStorage.removeItem(STORAGE);
  useSync.setState({ configured: false, status: 'off', pending: 0, error: undefined, lastSyncAt: undefined });
}

export function connectionCode(): string | null {
  const cfg = loadConfig();
  return cfg ? `${cfg.url} ${cfg.key}` : null;
}
