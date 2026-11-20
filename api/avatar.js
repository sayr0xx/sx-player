// Vercel Edge Function: публичная аватарка участника топа.
// Наружу не отдаёт ни Telegram ID, ни токен бота: картинку запрашивают по случайному коду (pid), а показываем её только тем, кто сам вступил в топ.
export const config = { runtime: 'edge' };

async function redis(cmds) {
  const env = process.env, url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, tok = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const r = await fetch(url + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}
const no = (status, cache) => new Response('no', { status, headers: { 'cache-control': cache || 'no-store' } });

export default async function handler(req) {
  const p = new URL(req.url).searchParams.get('p') || '';
  if (!/^[0-9a-f]{16}$/.test(p)) return no(400);
  const tokens = [process.env.BOT_TOKEN, process.env.INBOX_BOT_TOKEN].filter(Boolean);
  if (!tokens.length) return no(500);
  try {
    const [id] = await redis([['HGET', 'sx:pids', p]]); if (!id) return no(404);
    const [score] = await redis([['ZSCORE', 'sx:lb', id]]); if (score === null) return no(404); // только участники топа
    for (const tok of tokens) {
      try {
        const ph = await (await fetch(`https://api.telegram.org/bot${tok}/getUserProfilePhotos?user_id=${id}&limit=1`)).json();
        const sizes = ph.ok && ph.result.photos && ph.result.photos[0]; if (!sizes) continue; // нет публичного фото
        const pick = sizes[Math.min(1, sizes.length - 1)]; // средний размер
        const f = await (await fetch(`https://api.telegram.org/bot${tok}/getFile?file_id=${pick.file_id}`)).json(); if (!f.ok) continue;
        const img = await fetch(`https://api.telegram.org/file/bot${tok}/${f.result.file_path}`);
        if (img.ok && img.body) return new Response(img.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=21600, s-maxage=21600' } });
      } catch (e) {}
    }
    return no(404, 'public, max-age=600');
  } catch (e) { return no(502); }
}
