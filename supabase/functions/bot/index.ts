/*
 * The bot, as the app sees it. Called with the signed-in person's session.
 *
 *   { action: 'status' } — admins and managers: is there a bot, which one, does
 *                          Telegram reach it.
 *   { action: 'setup' }  — admins: points Telegram at the webhook and gives the
 *                          bot its commands and description, in Ukrainian. Safe
 *                          to repeat; needed again only after a new token.
 *   { action: 'send', kind, messages: [{ studentId, text }] }
 *                        — admins and managers: each text goes to every chat
 *                          connected to its student; every attempt is logged.
 *                          The answer says, per student, how many got it.
 */
import { botToken, callerRole, callerRpc, CORS, json, TelegramError, tg, webhookSecret, webhookUrl } from '../_shared/bot.ts';

interface Me {
  username: string;
  first_name: string;
}

interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

const DESCRIPTION =
  'Повідомлення про уроки української: нагадування, скасування й перенесення.\n\n' +
  'Щоб підключитися, відкрийте посилання, яке надіслала вчителька, і натисніть «Почати».';
const SHORT_DESCRIPTION = 'Нагадування та зміни в розкладі уроків української.';

async function status(token: string) {
  const me = await tg<Me>(token, 'getMe');
  const hook = await tg<WebhookInfo>(token, 'getWebhookInfo');
  return {
    configured: true,
    username: me.username,
    name: me.first_name,
    connected: hook.url === webhookUrl(),
    pending: hook.pending_update_count,
    // Telegram keeps the last delivery error even after things recover; only a recent one matters.
    lastError: hook.last_error_date && Date.now() / 1000 - hook.last_error_date < 3600 ? hook.last_error_message : undefined,
  };
}

const KINDS = ['cancel', 'cancelMany', 'free'];

interface Outgoing {
  studentId: string;
  text: string;
}

interface Result {
  studentId: string;
  /** chats connected to the student that can receive messages */
  chats: number;
  sent: number;
  blocked: number;
  failed: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One message to one chat; waits once when Telegram asks to slow down. */
async function deliver(token: string, chatId: number, text: string) {
  const body = { chat_id: chatId, text, link_preview_options: { is_disabled: true } };
  try {
    await tg(token, 'sendMessage', body);
  } catch (e) {
    if (!(e instanceof TelegramError) || e.code !== 429) throw e;
    await sleep(Math.min(e.retryAfter || 1, 10) * 1000);
    await tg(token, 'sendMessage', body);
  }
}

async function send(req: Request, token: string, body: { kind?: string; messages?: unknown }) {
  const kind = KINDS.includes(body.kind ?? '') ? (body.kind as string) : '';
  const list = Array.isArray(body.messages) ? (body.messages as Outgoing[]) : [];
  const messages = list.filter((m) => m && typeof m.studentId === 'string' && typeof m.text === 'string' && m.text.trim());
  if (!kind || messages.length === 0 || messages.length > 200) return json({ error: 'Нічого надсилати' }, 400);
  if (messages.some((m) => m.text.length > 4000)) return json({ error: 'Повідомлення задовге — до 4000 символів' }, 400);

  const ids = [...new Set(messages.map((m) => m.studentId))];
  const targets = await callerRpc<{ studentId: string; chatId: number }[]>(req, 'bot_targets', { students: ids });
  const results = new Map<string, Result>();
  const log: Record<string, unknown>[] = [];

  for (const m of messages) {
    const chats = targets.filter((t) => t.studentId === m.studentId);
    let r = results.get(m.studentId);
    if (!r) results.set(m.studentId, (r = { studentId: m.studentId, chats: chats.length, sent: 0, blocked: 0, failed: 0 }));
    const text = m.text.trim();
    for (const t of chats) {
      try {
        await deliver(token, t.chatId, text);
        r.sent++;
        log.push({ kind, studentId: m.studentId, chatId: t.chatId, text, status: 'sent' });
      } catch (e) {
        const blocked = e instanceof TelegramError && e.code === 403;
        if (blocked) r.blocked++;
        else r.failed++;
        log.push({ kind, studentId: m.studentId, chatId: t.chatId, text, status: blocked ? 'blocked' : 'failed', error: e instanceof Error ? e.message : String(e) });
      }
      // Well under Telegram's limit of about 30 messages a second.
      await sleep(40);
    }
  }

  if (log.length) {
    try {
      await callerRpc(req, 'bot_log', { entries: log });
    } catch (e) {
      console.error('bot_log failed', e);
    }
  }
  return json({ results: [...results.values()] });
}

async function setup(token: string) {
  await tg(token, 'setWebhook', {
    url: webhookUrl(),
    secret_token: await webhookSecret(token),
    allowed_updates: ['message', 'my_chat_member'],
    max_connections: 10,
  });
  await tg(token, 'setMyCommands', {
    commands: [
      { command: 'stop', description: 'Не отримувати повідомлень' },
      { command: 'help', description: 'Що вміє бот' },
    ],
  });
  await tg(token, 'setMyDescription', { description: DESCRIPTION });
  await tg(token, 'setMyShortDescription', { short_description: SHORT_DESCRIPTION });
  return status(token);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const role = await callerRole(req);
  if (role !== 'admin' && role !== 'manager') return json({ error: 'Немає прав керувати ботом' }, 403);

  let body: { action?: string; kind?: string; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const token = botToken();
  if (!token) return json({ configured: false });

  try {
    if (body.action === 'status') return json(await status(token));
    if (body.action === 'send') return await send(req, token, body);
    if (body.action === 'setup') {
      if (role !== 'admin') return json({ error: 'Підключати бота може лише адміністратор' }, 403);
      return json(await setup(token));
    }
    return json({ error: 'Невідома дія' }, 400);
  } catch (e) {
    // Most likely a wrong or revoked token.
    return json({ error: `Telegram відповів: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
