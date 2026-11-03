/*
 * What both bot functions share: the Telegram Bot API, the service calls into
 * the database, and the webhook secret.
 *
 * The bot's token lives only in the function secrets (TELEGRAM_BOT_TOKEN), never
 * in the database or the app. The webhook secret is derived from it, so there is
 * nothing else to set up and a new token gives a new secret.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

export const botToken = () => Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

/** Where Telegram delivers the bot's messages. */
export const webhookUrl = () => `${SUPABASE_URL}/functions/v1/telegram`;

/** What the database calls every minute to send due reminders. */
export const remindUrl = () => `${SUPABASE_URL}/functions/v1/remind`;

async function sha256(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The header Telegram sends with every update; proves it really is Telegram. */
export const webhookSecret = (token: string) => sha256(`uroky-telegram-webhook:${token}`);

/** The header the database's minute-by-minute call carries; proves it comes from there. */
export const cronKey = (token: string) => sha256(`uroky-cron:${token}`);

export class TelegramError extends Error {
  constructor(
    message: string,
    /** 403 — the person blocked the bot; 400 — e.g. the chat doesn't exist; 429 — too fast */
    readonly code: number,
    /** with 429: seconds to wait */
    readonly retryAfter = 0,
  ) {
    super(message);
  }
}

/** Calls a Bot API method and returns its result. */
export async function tg<T = unknown>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
    error_code?: number;
    parameters?: { retry_after?: number };
  };
  if (!json.ok) {
    throw new TelegramError(json.description ?? `${method}: ${res.status}`, json.error_code ?? res.status, json.parameters?.retry_after ?? 0);
  }
  return json.result as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One message to one chat; waits once when Telegram asks to slow down. */
export async function deliver(token: string, chatId: number, text: string) {
  const body = { chat_id: chatId, text, link_preview_options: { is_disabled: true } };
  try {
    await tg(token, 'sendMessage', body);
  } catch (e) {
    if (!(e instanceof TelegramError) || e.code !== 429) throw e;
    await sleep(Math.min(e.retryAfter || 1, 10) * 1000);
    await tg(token, 'sendMessage', body);
  }
}

/** The project's secret key: the new named one, or the legacy service_role key. */
function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    if (keys.default) return keys.default;
  } catch {
    /* not set: fall back to the legacy key */
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

function serviceHeaders(): Record<string, string> {
  const key = serviceKey();
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  // A legacy key is a JWT and goes in Authorization too; a new sb_secret_ key goes in apikey alone.
  if (!key.startsWith('sb_')) headers.authorization = `Bearer ${key}`;
  return headers;
}

/** Reads a table as the service (past row level security); `query` is a PostgREST query. */
export async function serviceGet<T = unknown>(table: string, query: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: serviceHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`${table}: ${res.status} ${text}`);
  return JSON.parse(text) as T[];
}

/** Calls a database function as the service (past row level security). */
export async function serviceRpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Calls a database function with the sign-in of whoever called this function
 * from the app, so the database applies exactly their rights.
 */
export async function callerRpc<T = unknown>(req: Request, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const auth = req.headers.get('authorization');
  const apikey = req.headers.get('apikey');
  if (!auth || !apikey) throw new Error('not signed in');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey, authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** The caller's role: 'admin', 'manager', 'teacher' or null. */
export async function callerRole(req: Request): Promise<string | null> {
  try {
    return await callerRpc<string | null>(req, 'my_role');
  } catch {
    return null;
  }
}

export const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
