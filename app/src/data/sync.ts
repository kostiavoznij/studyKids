import { create } from 'zustand';
import { currentRole } from './access';
import { cloud, useAccount, type Role } from './cloud';
import { useData, type DataState } from './store';
import { teacherOf } from './teachers';
import type { ID } from './types';

/*
 * Sync with the server: the account's database (supabase/migrations) or, on
 * devices not yet signed in, the Google Sheet of earlier versions (backend/Code.gs).
 * Both speak the same push/pull of changed records.
 *
 * Every record carries updatedAt. A record is "dirty" when its updatedAt differs
 * from the one the server last confirmed; dirty records are pushed, then every
 * change newer than our last revision is pulled. Both sides keep the later
 * updatedAt, so edits made on two devices settle on the newest one.
 *
 * A table set up with an older Code.gs silently skips record types it doesn't
 * know. The server lists its types in every reply, and records of other types
 * stay dirty on the device until the script is updated. Since the version that
 * added bankMonths the script stores any type (anyType), so new kinds of
 * records no longer need a script update.
 *
 * On the account every role syncs only what the server lets it have: a manager
 * everything but the finance records, a teacher her own lessons (and the
 * students in them) through teacher_pull()/teacher_push(), with the money taken
 * out. When a device's role changes it starts over from an empty copy.
 */

const TYPES = [
  'students',
  'groups',
  'lessons',
  'payments',
  'daysOff',
  'taxes',
  'taxPlans',
  'bankMonths',
  'teachers',
  'teacherPay',
  'teacherPayouts',
  'botTemplates',
] as const;
type RecType = (typeof TYPES)[number];
/** What each role sends up; the server refuses the rest (supabase/migrations/20261104120000_roles.sql). */
const PUSHED: Record<Role, readonly RecType[]> = {
  admin: TYPES,
  manager: ['students', 'groups', 'lessons', 'payments', 'daysOff', 'teachers', 'botTemplates'],
  teacher: ['lessons'],
};
/** what every version of Code.gs stores */
const BASE_TYPES: readonly RecType[] = ['students', 'groups', 'lessons', 'payments', 'daysOff'];
type AnyRecord = { id: ID; updatedAt: number };
type Records = Partial<Record<RecType, AnyRecord[]>>;

interface SyncConfig {
  /** 'cloud' — the account; missing — the Google Sheet at url */
  kind?: 'cloud';
  url?: string;
  key?: string;
  /** last server revision we have seen */
  lastRev: number;
  /** `${type}:${id}` → updatedAt the server already has */
  confirmed: Record<string, number>;
  /** record types the server stores, as it reported last time */
  types?: string[];
  /** the server stores records of any type */
  anyType?: boolean;
  /** the role this copy was pulled for; missing — admin (devices from before there were roles) */
  role?: Role;
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
  /** the table's script is older than the app and can't store some records yet */
  outdated: boolean;
  /** where the data goes: the account or the Google Sheet */
  mode?: 'cloud' | 'sheet';
  /** signed in, but this device has records of its own: waits for her to say what to do with them */
  choosing?: boolean;
}

export const useSync = create<SyncState>(() => ({ status: 'off', configured: false, pending: 0, outdated: false }));

const modeOf = (cfg: SyncConfig | null) => (cfg ? (cfg.kind === 'cloud' ? 'cloud' : 'sheet') : undefined);

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

async function call<T>(cfg: { url?: string; key?: string }, action: string, payload: object = {}): Promise<T> {
  let res: Response;
  try {
    // text/plain keeps this a "simple" request — Apps Script can't answer CORS preflight.
    res = await fetch(cfg.url!, {
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

const CLOUD_PAGE = 500;

/** Supabase answers with an error object instead of throwing. */
function cloudError(error: { message: string; code?: string }): SyncError {
  if (!navigator.onLine || /fetch|network|load failed/i.test(error.message)) return new SyncError('network', 'Немає зв’язку з сервером');
  if (error.code === '42501') return new SyncError('not_allowed', 'Цей акаунт не має доступу до записів');
  if (error.code === 'PGRST301' || /jwt/i.test(error.message)) return new SyncError('auth', 'Увійдіть в акаунт ще раз');
  return new SyncError('server', error.message);
}

async function pushTo(cfg: SyncConfig, records: Records) {
  if (cfg.kind !== 'cloud') {
    await call(cfg, 'push', { records });
    return;
  }
  const { error } = await cloud().rpc(cfg.role === 'teacher' ? 'teacher_push' : 'push_records', { records });
  if (error) throw cloudError(error);
}

interface Pulled {
  rev: number;
  records: Records;
  types?: string[];
  anyType?: boolean;
  /** lessons that are no longer this teacher's */
  gone?: { lessons?: ID[] };
}

async function pullFrom(cfg: SyncConfig, since: number): Promise<Pulled> {
  if (cfg.kind !== 'cloud') return call(cfg, 'pull', { since });
  if (cfg.role === 'teacher') {
    const { data, error } = await cloud().rpc('teacher_pull', { since });
    if (error) throw cloudError(error);
    return { ...(data as Pulled), anyType: true };
  }
  const records: Records = {};
  let rev = since;
  for (;;) {
    const { data, error } = await cloud().from('records').select('type, data, rev').gt('rev', rev).order('rev').limit(CLOUD_PAGE);
    if (error) throw cloudError(error);
    for (const row of data as { type: RecType; data: AnyRecord; rev: number }[]) {
      (records[row.type] ??= []).push(row.data);
      rev = row.rev;
    }
    if (data.length < CLOUD_PAGE) break;
  }
  return { rev, records, anyType: true };
}

/* ---------- merge ---------- */

const serverTypes = (cfg: SyncConfig) => TYPES.filter((t) => cfg.anyType || (cfg.types ?? BASE_TYPES).includes(t));
const isOutdated = (cfg: SyncConfig) => serverTypes(cfg).length < TYPES.length;

function dirtyRecords(s: DataState, confirmed: Record<string, number>, types: readonly RecType[] = TYPES): Records {
  const out: Records = {};
  for (const type of types) {
    const list = (Object.values(s[type]) as AnyRecord[]).filter((r) => confirmed[`${type}:${r.id}`] !== r.updatedAt);
    if (list.length) out[type] = list;
  }
  return out;
}

const countOf = (r: Records) => TYPES.reduce((n, t) => n + (r[t]?.length ?? 0), 0);

/** Record types this device sends up: what the role may change (and, for the Google Sheet, what its script stores). */
const pushedTypes = (cfg: SyncConfig) => (cfg.kind === 'cloud' ? PUSHED[cfg.role ?? 'admin'] : serverTypes(cfg));

/**
 * A teacher's copy keeps only what concerns her: lessons given to someone else
 * go, and so do students and groups that are no longer in any of her lessons.
 */
function pruneForTeacher(gone: ID[], confirmed: Record<string, number>) {
  useData.setState((s) => {
    const lessons = { ...s.lessons };
    for (const id of gone) {
      delete lessons[id];
      delete confirmed[`lessons:${id}`];
    }
    const mine = new Set(Object.keys(s.teachers));
    const students = new Set<ID>();
    const groups = new Set<ID>();
    for (const l of Object.values(lessons)) {
      if (l.deletedAt) continue;
      for (const p of l.participants) students.add(p.studentId);
      if (l.groupId) groups.add(l.groupId);
    }
    const keep = <T extends { id: ID; teacherId?: ID }>(rec: Record<ID, T>, used: Set<ID>, type: string) => {
      const out: Record<ID, T> = {};
      for (const x of Object.values(rec)) {
        if (used.has(x.id) || mine.has(teacherOf(x))) out[x.id] = x;
        else delete confirmed[`${type}:${x.id}`];
      }
      return out;
    };
    return { lessons, students: keep(s.students, students, 'students'), groups: keep(s.groups, groups, 'groups') };
  });
}

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
  if (cfg.kind === 'cloud') {
    const account = useAccount.getState();
    if (account.status === 'loading') return;
    if (account.status !== 'in' || !account.role) {
      useSync.setState({ status: 'error', error: account.status === 'out' ? 'Увійдіть в акаунт' : 'Немає доступу до записів' });
      return;
    }
    // Another role sees other records: start over from what the server gives this one.
    if ((cfg.role ?? 'admin') !== account.role) {
      useData.getState().clearAll();
      Object.assign(cfg, { lastRev: 0, confirmed: {}, role: account.role });
      saveConfig(cfg);
    }
  }
  if (!navigator.onLine) {
    useSync.setState({ status: 'offline' });
    return;
  }
  useSync.setState({ status: 'syncing', configured: true });
  try {
    const known = serverTypes(cfg);
    const pushed = pushedTypes(cfg);
    for (const batch of batches(dirtyRecords(useData.getState(), cfg.confirmed, pushed))) {
      await pushTo(cfg, batch);
      for (const type of pushed) for (const rec of batch[type] ?? []) cfg.confirmed[`${type}:${rec.id}`] = rec.updatedAt;
      saveConfig(cfg);
    }
    const res = await pullFrom(cfg, cfg.lastRev);
    applyRemote(res.records, cfg.confirmed);
    if (cfg.role === 'teacher') pruneForTeacher(res.gone?.lessons ?? [], cfg.confirmed);
    cfg.lastRev = res.rev;
    cfg.types = res.types ?? [...BASE_TYPES];
    cfg.anyType = !!res.anyType;
    saveConfig(cfg);
    // The script was just updated: send what it couldn't take before.
    if (serverTypes(cfg).length > known.length) again = true;
    useData.getState().ensureSchedule();
    useSync.setState({
      status: 'idle',
      lastSyncAt: Date.now(),
      error: undefined,
      pending: countOf(dirtyRecords(useData.getState(), cfg.confirmed, pushedTypes(cfg))),
      outdated: isOutdated(cfg),
    });
  } catch (e) {
    const offline = e instanceof SyncError && e.code === 'network' && !navigator.onLine;
    useSync.setState({ status: offline ? 'offline' : 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Sets up the triggers once; they do nothing until a table or the account is connected. */
export function startSync() {
  const cfg = loadConfig();
  useSync.setState({ configured: !!cfg, outdated: !!cfg && isOutdated(cfg), mode: modeOf(cfg) });

  // Signing in moves this device onto the account. An admin's device with records
  // of its own asks first, so nobody's test data lands in her account by accident;
  // anyone else only ever takes the account's records.
  useAccount.subscribe((a, prev) => {
    if (a.status === prev.status && a.role === prev.role) return;
    if (a.status === 'in' && a.role) {
      if (loadConfig()?.kind === 'cloud' || !hasOwnRecords() || a.role !== 'admin') moveToCloud('replace');
      else useSync.setState({ choosing: true });
    } else {
      useSync.setState({ choosing: false });
      if (loadConfig()?.kind === 'cloud') syncNow();
    }
  });

  let timer: number | undefined;
  useData.subscribe((s, prev) => {
    if (!TYPES.some((t) => s[t] !== prev[t])) return;
    const cfg = loadConfig();
    if (!cfg) return;
    const pending = countOf(dirtyRecords(s, cfg.confirmed, pushedTypes(cfg)));
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
  /** an older script doesn't count the newer types */
  counts: Partial<Record<RecType, number>> & Record<'students' | 'lessons', number>;
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
  useSync.setState({ configured: true, status: 'idle', error: undefined, mode: 'sheet' });
  await call({ url, key }, 'hello', { url }).catch(() => undefined);
  await syncNow();
}

/** Real records on this device (demo data doesn't count). */
export function hasOwnRecords(): boolean {
  const s = useData.getState();
  return s.seeded !== 'demo' && TYPES.some((t) => Object.keys(s[t]).length > 0);
}

/**
 * Moves this device onto the account. 'merge' sends everything on it up, joined
 * with what the account already has (the newer change of each record wins);
 * 'replace' drops this device's records and only takes the account's. Demo data
 * is always dropped. The Google Sheet is left alone as an archive.
 */
export function moveToCloud(mode: 'merge' | 'replace'): Promise<void> {
  if (loadConfig()?.kind !== 'cloud') {
    if (mode === 'replace' || useData.getState().seeded === 'demo') useData.getState().clearAll();
    saveConfig({ kind: 'cloud', lastRev: 0, confirmed: {}, anyType: true, role: currentRole() });
    useSync.setState({ configured: true, status: 'idle', error: undefined, outdated: false, mode: 'cloud' });
  }
  useSync.setState({ choosing: false });
  return syncNow();
}

export function disconnect() {
  localStorage.removeItem(STORAGE);
  useSync.setState({ configured: false, status: 'off', pending: 0, outdated: false, error: undefined, lastSyncAt: undefined, mode: undefined, choosing: false });
}

export function connectionCode(): string | null {
  const cfg = loadConfig();
  return cfg?.url ? `${cfg.url} ${cfg.key}` : null;
}
