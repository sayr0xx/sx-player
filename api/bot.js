// Vercel Edge Function: бот-«приёмник». Ты пересылаешь ему песни из чата с основным ботом —
// они попадают во «входящие», и Mini App сам забирает их в библиотеку.
// Переменные в Vercel: INBOX_BOT_TOKEN (токен нового бота от @BotFather), INBOX_SECRET (придумай сам: латинские буквы, цифры, _ и -),
// KV_REST_API_URL + KV_REST_API_TOKEN (Upstash).
// Подключить бота: один раз открой в браузере  https://ТВОЙ-САЙТ.vercel.app/api/bot?setup=ТВОЙ_INBOX_SECRET
export const config = { runtime: 'edge' };

const T = (s, status = 200) => new Response(s, { status, headers: { 'cache-control': 'no-store' } });
async function redis(cmds) {
  const env = process.env, url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, tok = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const r = await fetch(url + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}

export default async function handler(req) {
  const env = process.env, token = env.INBOX_BOT_TOKEN, secret = env.INBOX_SECRET, url = new URL(req.url);
  if (req.method === 'GET') { // установка вебхука одним открытием ссылки
    if (!token || !secret) return T('not configured: INBOX_BOT_TOKEN / INBOX_SECRET', 500);
    if (url.searchParams.get('setup') !== secret) return T('forbidden', 403);
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url.origin + '/api/bot', secret_token: secret, allowed_updates: ['message'] }) });
    return T(await r.text());
  }
  if (req.method !== 'POST') return T('POST only', 405);
  if (!token || !secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return T('forbidden', 403);
  let u; try { u = await req.json(); } catch (e) { return T('bad json', 400); }
  const m = u.message;
  if (!m || !m.from || !m.chat || m.chat.type !== 'private') return T('ok');
  const send = (text, extra) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: m.chat.id, text, disable_notification: true, ...extra }) }).catch(() => {});
  const a = m.audio || (m.document && /^audio\//.test(m.document.mime_type || '') ? m.document : null);
  if (!a) { await send('Привет! Перешли мне песни из чата с музыкальным ботом (можно выделить сразу несколько) — они сами появятся в твоём плеере.'); return T('ok'); }
  if ((a.file_size || 0) > 20 * 1024 * 1024) { await send('⚠️ Файл больше 20 МБ — Telegram не даёт боту его скачать.'); return T('ok'); }
  const item = { id: String(a.file_unique_id).slice(0, 64), fid: String(a.file_id).slice(0, 300), title: String(a.title || a.file_name || 'Без названия').replace(/\.[^.]+$/, '').slice(0, 80),
    artist: String(a.performer || '').slice(0, 60), dur: Math.max(0, Math.round(Number(a.duration) || 0)), size: Math.max(0, Number(a.file_size) || 0), b: 'b', t: Date.now() };
  const k = 'sx:in:' + m.from.id;
  try { await redis([['HSET', k, item.id, JSON.stringify(item)], ['EXPIRE', k, 2592000]]); }
  catch (e) { await send('⚠️ Не удалось сохранить — попробуй ещё раз позже.'); return T('ok'); }
  await send('✅ Добавлено в плеер: ' + (item.artist ? item.artist + ' — ' : '') + item.title, { reply_markup: { inline_keyboard: [[{ text: 'Открыть плеер', web_app: { url: url.origin + '/' } }]] } });
  return T('ok');
}
