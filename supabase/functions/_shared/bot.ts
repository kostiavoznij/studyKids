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

/** The header Telegram sends with every update; proves it really is Telegram. */
export async function webhookSecret(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(`uroky-telegram-webhook:${token}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class TelegramError extends Error {
  constructor(
    message: string,
    /** 403 — the person blocked the bot; 400 — e.g. the chat doesn't exist */
    readonly code: number,
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
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!json.ok) throw new TelegramError(json.description ?? `${method}: ${res.status}`, json.error_code ?? res.status);
  return json.result as T;
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

/** Calls a database function as the service (past row level security). */
export async function serviceRpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * The role of whoever called a function from the app: 'admin', 'manager',
 * 'teacher' or null. Asked of the database with their own sign-in, so it is
 * exactly what the app's other requests get.
 */
export async function callerRole(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization');
  const apikey = req.headers.get('apikey');
  if (!auth || !apikey) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_role`, {
    method: 'POST',
    headers: { apikey, authorization: auth, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) return null;
  return (await res.json()) as string | null;
}

export const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
