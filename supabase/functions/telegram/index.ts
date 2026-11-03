/*
 * The bot's webhook: Telegram delivers every message to the bot here.
 *
 * Step 1 of the bot only connects families: «Почати» on a student's link ties
 * the chat to that student, /stop unties it. Anything else gets a short answer
 * that nobody reads replies here.
 *
 * Telegram is answered 200 even when something fails, otherwise it would keep
 * resending the same update; failures go to the function's logs.
 */
import { botToken, json, serviceRpc, webhookSecret } from '../_shared/bot.ts';

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

interface Update {
  message?: { chat: Chat; from?: User; text?: string };
  my_chat_member?: { chat: Chat; new_chat_member: { status: string } };
}

const TEXT = {
  joined: (name: string) =>
    `Вітаю! Ви підключили повідомлення про уроки: ${name}.\n\n` +
    'Сюди приходитимуть нагадування, скасування й перенесення уроків. Щоб відписатися, надішліть /stop.',
  howToJoin: 'Вітаю! Щоб отримувати повідомлення про уроки, відкрийте посилання, яке вам надіслала вчителька.',
  oldLink: 'Це посилання вже не діє. Попросіть у вчительки нове.',
  stopped: 'Готово, повідомлення сюди більше не надходитимуть. Щоб повернути їх, відкрийте посилання від вчительки ще раз.',
  notJoined: 'Ви зараз не отримуєте повідомлень про уроки. Щоб підключитися, відкрийте посилання від вчительки.',
  help:
    'Цей бот надсилає повідомлення про уроки: нагадування, скасування й перенесення.\n\n' +
    'Щоб підключитися, відкрийте посилання від вчительки. Щоб відписатися, надішліть /stop.',
  noReplies: 'Це бот лише для повідомлень про уроки, відповіді тут ніхто не читає. Якщо треба щось сказати, напишіть вчительці напряму.',
};

const CODE = /^[A-Za-z0-9]{16,64}$/;

/** What to answer, as a Bot API call Telegram makes for us from the response; null — nothing. */
async function handle(u: Update): Promise<Record<string, unknown> | null> {
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
      const from = msg.from;
      const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ');
      const student = await serviceRpc<string | null>('bot_link', { p_code: arg, p_chat: chat, p_name: name, p_username: from?.username ?? '' });
      return reply(student ? TEXT.joined(student) : TEXT.oldLink);
    }
    case '/stop': {
      const left = await serviceRpc<number>('bot_stop', { p_chat: chat });
      return reply(left > 0 ? TEXT.stopped : TEXT.notJoined);
    }
    case '/help':
      return reply(TEXT.help);
    default:
      return reply(TEXT.noReplies);
  }
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
    const answer = await handle(update);
    if (answer) return json(answer);
  } catch (e) {
    console.error('telegram update failed', e);
  }
  return new Response('ok');
});
