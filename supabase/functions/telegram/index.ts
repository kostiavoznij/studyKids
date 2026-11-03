/*
 * The bot's webhook: Telegram delivers every message to the bot here.
 *
 *   «Почати» with a student's code — the chat follows that student (step 1);
 *   «Почати» with an inbox code — the chat receives families' replies (step 4);
 *   /stop — the chat leaves everything; /help — what the bot does.
 *
 * Anything else a family writes is passed on to the inboxes, with who wrote
 * and about which student. Replying to that in the inbox sends the answer back
 * to the family — text, photos, voice, files alike.
 *
 * Telegram is answered 200 even when something fails, otherwise it would keep
 * resending the same update; failures go to the function's logs.
 */
import { botToken, json, serviceRpc, TelegramError, tg, webhookSecret } from '../_shared/bot.ts';

interface User {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface Chat {
  id: number;
  type: string;
}

interface Message {
  message_id: number;
  chat: Chat;
  from?: User;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  photo?: unknown;
  voice?: unknown;
  video?: unknown;
  video_note?: unknown;
  document?: unknown;
  audio?: unknown;
  sticker?: unknown;
}

interface Update {
  message?: Message;
  my_chat_member?: { chat: Chat; new_chat_member: { status: string } };
}

interface ChatInfo {
  students: { id: string; name: string }[];
  inbox: boolean;
  inboxEmail: string | null;
  receivers: number[];
}

const TEXT = {
  joined: (name: string) =>
    `Вітаю! Ви підключили повідомлення про уроки: ${name}.\n\n` +
    'Сюди приходитимуть нагадування, скасування й перенесення уроків. Щоб відписатися, надішліть /stop.',
  inboxJoined:
    'Готово! Сюди приходитимуть повідомлення, які батьки напишуть боту.\n\n' +
    'Щоб відповісти, відповідайте на таке повідомлення (свайп вліво чи «Відповісти»), і бот передасть відповідь батькам. ' +
    'Щоб більше не отримувати, надішліть /stop.',
  howToJoin: 'Вітаю! Щоб отримувати повідомлення про уроки, відкрийте посилання, яке вам надіслала вчителька.',
  oldLink: 'Це посилання вже не діє. Попросіть у вчительки нове.',
  stopped: 'Готово, повідомлення сюди більше не надходитимуть. Щоб повернути їх, відкрийте посилання від вчительки ще раз.',
  notJoined: 'Ви зараз не отримуєте повідомлень про уроки. Щоб підключитися, відкрийте посилання від вчительки.',
  help:
    'Цей бот надсилає повідомлення про уроки: нагадування, скасування й перенесення.\n\n' +
    'Щоб підключитися, відкрийте посилання від вчительки. Щоб відписатися, надішліть /stop.',
  noReplies: 'Це бот лише для повідомлень про уроки, відповіді тут ніхто не читає. Якщо треба щось сказати, напишіть вчительці напряму.',
  passedOn: 'Дякую! Передано вчительці.',
  inboxHowTo: 'Щоб відповісти батькам, відповідайте на їхнє повідомлення тут (свайп вліво чи «Відповісти»).',
  inboxUnknown: 'Не знаю, кому це передати: відповідайте саме на повідомлення від батьків. Старіші за місяць уже не підходять.',
  answered: 'Надіслано батькам ✓',
  answerBlocked: 'Не доставлено: батьки заблокували бота.',
  answerFailed: (why: string) => `Не вдалося надіслати: ${why}`,
};

const CODE = /^[A-Za-z0-9]{16,64}$/;

const fullName = (u?: User) => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || (u?.username ? `@${u.username}` : '');

/** What kind of message it is, for the log and for the inbox header. */
function what(m: Message): string {
  const kind = m.photo ? 'фото' : m.voice ? 'голосове' : m.video || m.video_note ? 'відео' : m.document ? 'файл' : m.audio ? 'аудіо' : m.sticker ? 'стікер' : '';
  if (m.text) return m.text;
  return [kind ? `[${kind}]` : '[повідомлення]', m.caption ?? ''].filter(Boolean).join(' ');
}

/** A family wrote something: pass it on to every inbox. */
async function fromFamily(token: string, msg: Message, info: ChatInfo): Promise<string> {
  if (info.receivers.length === 0) return TEXT.noReplies;
  const header = `💬 ${fullName(msg.from) || 'Батьки'} (${info.students.map((s) => s.name).join(', ')})`;
  const relays: { inboxChat: number; inboxMessage: number; familyChat: number }[] = [];
  for (const inbox of info.receivers) {
    try {
      if (msg.text) {
        const m = await tg<{ message_id: number }>(token, 'sendMessage', { chat_id: inbox, text: `${header}:\n\n${msg.text}`, link_preview_options: { is_disabled: true } });
        relays.push({ inboxChat: inbox, inboxMessage: m.message_id, familyChat: msg.chat.id });
      } else {
        const h = await tg<{ message_id: number }>(token, 'sendMessage', { chat_id: inbox, text: `${header} надсилає:` });
        const c = await tg<{ message_id: number }>(token, 'copyMessage', { chat_id: inbox, from_chat_id: msg.chat.id, message_id: msg.message_id });
        relays.push({ inboxChat: inbox, inboxMessage: h.message_id, familyChat: msg.chat.id }, { inboxChat: inbox, inboxMessage: c.message_id, familyChat: msg.chat.id });
      }
    } catch (e) {
      console.error('passing on to inbox failed', inbox, e);
    }
  }
  if (relays.length) await serviceRpc('bot_relay_put', { entries: relays });
  await serviceRpc('bot_log_auto', {
    entries: info.students.map((s) => ({ kind: 'reply', by: fullName(msg.from) || 'батьки', studentId: s.id, chatId: msg.chat.id, text: what(msg), status: 'received' })),
  });
  return relays.length ? TEXT.passedOn : TEXT.noReplies;
}

/** She answered in her inbox: send it back to the family it replies to. */
async function fromInbox(token: string, msg: Message, info: ChatInfo): Promise<string> {
  const replyTo = msg.reply_to_message?.message_id;
  if (!replyTo) return TEXT.inboxHowTo;
  const family = await serviceRpc<number | null>('bot_relay_get', { p_inbox_chat: msg.chat.id, p_message: replyTo });
  if (!family) return TEXT.inboxUnknown;
  const target = await serviceRpc<ChatInfo>('bot_chat_info', { p_chat: family });
  let status: 'sent' | 'blocked' | 'failed' = 'sent';
  let error = '';
  try {
    await tg(token, 'copyMessage', { chat_id: family, from_chat_id: msg.chat.id, message_id: msg.message_id });
  } catch (e) {
    status = e instanceof TelegramError && e.code === 403 ? 'blocked' : 'failed';
    error = e instanceof Error ? e.message : String(e);
  }
  await serviceRpc('bot_log_auto', {
    entries: target.students.map((s) => ({ kind: 'answer', by: info.inboxEmail ?? '', studentId: s.id, chatId: family, text: what(msg), status, error })),
  });
  return status === 'sent' ? TEXT.answered : status === 'blocked' ? TEXT.answerBlocked : TEXT.answerFailed(error);
}

/** What to answer, as a Bot API call Telegram makes for us from the response; null — nothing. */
async function handle(token: string, u: Update): Promise<Record<string, unknown> | null> {
  const member = u.my_chat_member;
  if (member) {
    if (member.chat.type !== 'private') return null;
    const status = member.new_chat_member.status;
    if (status === 'kicked') await serviceRpc('bot_blocked', { p_chat: member.chat.id, p_blocked: true });
    else if (status === 'member') await serviceRpc('bot_blocked', { p_chat: member.chat.id, p_blocked: false });
    return null;
  }

  const msg = u.message;
  if (!msg || msg.chat.type !== 'private') return null;
  const chat = msg.chat.id;
  const reply = (text: string) => ({ method: 'sendMessage', chat_id: chat, text });
  const [command, arg = ''] = (msg.text ?? '').trim().split(/\s+/, 2);

  switch (command.replace(/@\w+$/, '')) {
    case '/start': {
      if (!arg) return reply(TEXT.howToJoin);
      if (!CODE.test(arg)) return reply(TEXT.oldLink);
      const args = { p_code: arg, p_chat: chat, p_name: fullName(msg.from), p_username: msg.from?.username ?? '' };
      const student = await serviceRpc<string | null>('bot_link', args);
      if (student) return reply(TEXT.joined(student));
      const inbox = await serviceRpc<string | null>('bot_link_inbox', args);
      return reply(inbox ? TEXT.inboxJoined : TEXT.oldLink);
    }
    case '/stop': {
      const left = await serviceRpc<number>('bot_stop', { p_chat: chat });
      return reply(left > 0 ? TEXT.stopped : TEXT.notJoined);
    }
    case '/help':
      return reply(TEXT.help);
  }

  const info = await serviceRpc<ChatInfo>('bot_chat_info', { p_chat: chat });
  // A reply in an inbox is an answer; anything else from a family's chat goes to the inboxes
  // (the same Telegram can be both — that's how one person tests the whole round trip).
  if (info.inbox && msg.reply_to_message) return reply(await fromInbox(token, msg, info));
  if (info.students.length) return reply(await fromFamily(token, msg, info));
  if (info.inbox) return reply(TEXT.inboxHowTo);
  return reply(TEXT.howToJoin);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const token = botToken();
  if (!token) return new Response('no bot token', { status: 503 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== (await webhookSecret(token))) {
    return new Response('forbidden', { status: 403 });
  }
  let update: Update;
  try {
    update = await req.json();
  } catch {
    return new Response('ok');
  }
  try {
    const answer = await handle(token, update);
    if (answer) return json(answer);
  } catch (e) {
    console.error('telegram update failed', e);
  }
  return new Response('ok');
});
