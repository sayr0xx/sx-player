// Vercel Edge Function: публичная аватарка участника топа.
// Наружу не отдаёт ни Telegram ID, ни токен бота: картинку запрашивают по случайному коду (pid), а показываем её только тем, кто сам вступил в топ.
// Порядок: 1) фото через бота, 2) запасной вариант — публичная ссылка на фото из данных Mini App. Добавь ?debug=1, чтобы увидеть, на каком шаге сбой.
export const config = { runtime: 'edge' };

async function redis(cmds) {
  const env = process.env, url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, tok = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const r = await fetch(url + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}
const no = (status, cache) => new Response('no', { status, headers: { 'cache-control': cache || 'no-store' } });

export default async function handler(req) {
  const q = new URL(req.url).searchParams, p = q.get('p') || '', dbg = q.get('debug') === '1', info = {};
  const out = (status, cache) => dbg ? new Response(JSON.stringify(info), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }) : no(status, cache);
  if (!/^[0-9a-f]{16}$/.test(p)) return no(400);
  const tokens = [process.env.BOT_TOKEN, process.env.INBOX_BOT_TOKEN].filter(Boolean);
  if (!tokens.length) return no(500);
  try {
    const [id] = await redis([['HGET', 'sx:pids', p]]); info.codeKnown = !!id; if (!id) return out(404);
    const [score] = await redis([['ZSCORE', 'sx:lb', id]]); info.inTop = score !== null; if (score === null) return out(404); // только участники топа
    info.bot = [];
    for (const tok of tokens) {
      try {
        const ph = await (await fetch(`https://api.telegram.org/bot${tok}/getUserProfilePhotos?user_id=${id}&limit=1`)).json();
        if (!ph.ok) { info.bot.push('ошибка: ' + ph.description); continue; }
        const sizes = ph.result.photos && ph.result.photos[0]; if (!sizes) { info.bot.push('фото не видно боту (нет фото или скрыто приватностью)'); continue; }
        const pick = sizes[Math.min(1, sizes.length - 1)]; // средний размер
        const f = await (await fetch(`https://api.telegram.org/bot${tok}/getFile?file_id=${pick.file_id}`)).json(); if (!f.ok) { info.bot.push('getFile: ' + f.description); continue; }
        const img = await fetch(`https://api.telegram.org/file/bot${tok}/${f.result.file_path}`);
        if (img.ok && img.body) { if (dbg) { info.bot.push('ок'); return out(); } return new Response(img.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=21600, s-maxage=21600' } }); }
        info.bot.push('скачивание: ' + img.status);
      } catch (e) { info.bot.push('сбой: ' + e.message); }
    }
    const [pu] = await redis([['HGET', 'sx:photos', id]]); info.photoUrl = !!pu; // запасной путь
    if (pu && /^https:\/\/t\.me\/i\/userpic\//.test(pu)) {
      try { const img = await fetch(pu); info.photoUrlStatus = img.status; if (img.ok && img.body && !dbg) return new Response(img.body, { headers: { 'content-type': img.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=21600, s-maxage=21600' } }); } catch (e) { info.photoUrlStatus = 'сбой'; }
    }
    return out(404, 'public, max-age=600');
  } catch (e) { info.error = e.message; return out(502); }
}
