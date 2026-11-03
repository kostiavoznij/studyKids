/*
 * The bot, as the app sees it. Called with the signed-in person's session.
 *
 *   { action: 'status' } — admins and managers: is there a bot, which one, does
 *                          Telegram reach it.
 *   { action: 'setup' }  — admins: points Telegram at the webhook and gives the
 *                          bot its commands and description, in Ukrainian. Safe
 *                          to repeat; needed again only after a new token.
 */
import { botToken, callerRole, CORS, json, tg, webhookSecret, webhookUrl } from '../_shared/bot.ts';

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

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const token = botToken();
  if (!token) return json({ configured: false });

  try {
    if (body.action === 'status') return json(await status(token));
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
