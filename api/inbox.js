// Vercel Edge Function: «входящие» музыки из бота.
// Бот кладёт сюда треки (action: "push", с секретом), Mini App забирает их (action: "list" / "done", с подписью Telegram).
// Переменные в Vercel: BOT_TOKEN, INBOX_SECRET (придумай сам), KV_REST_API_URL + KV_REST_API_TOKEN (от Upstash),
// и необязательная INBOX_BOT_TOKEN (токен бота-«приёмника», если основной бот недоступен для правок).
export const config = { runtime: 'edge' };

const enc = new TextEncoder();
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
async function verifyInitData(raw, botToken) { // проверка подписи Telegram.WebApp.initData
  const p = new URLSearchParams(raw), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const str = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const calc = [...(await hmac(await hmac('WebAppData', botToken), str))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (calc.length !== hash.length) return null;
  let d = 0; for (let i = 0; i < calc.length; i++) d |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  if (d) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch (e) { return null; }
}
async function verifyAny(raw, tokens) { for (const t of tokens) { const u = await verifyInitData(raw, t); if (u) return u; } return null; }
async function redis(cmds) {
  const env = process.env, url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, tok = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const r = await fetch(url + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}

export default async function handler(req) {
  if (req.method !== 'POST') return J({ error: 'POST only' }, 405);
  const env = process.env;
  const tokens = [env.BOT_TOKEN, env.INBOX_BOT_TOKEN].filter(Boolean);
  if (!tokens.length || !(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL)) return J({ error: 'not configured' }, 500);
  let b; try { b = await req.json(); } catch (e) { return J({ error: 'bad json' }, 400); }
  try {
    if (b.action === 'push') { // от бота
      if (!env.INBOX_SECRET || req.headers.get('x-bot-secret') !== env.INBOX_SECRET) return J({ error: 'forbidden' }, 403);
      const uid = String(b.user_id || '');
      if (!/^\d{1,15}$/.test(uid) || !b.file_id || !b.file_unique_id) return J({ error: 'bad fields' }, 400);
      const item = { id: String(b.file_unique_id).slice(0, 64), fid: String(b.file_id).slice(0, 300), title: String(b.title || 'Без названия').slice(0, 80), artist: String(b.artist || '').slice(0, 60), dur: Math.max(0, Math.round(Number(b.duration) || 0)), size: Math.max(0, Number(b.size) || 0), b: 'a', t: Date.now() };
      const k = 'sx:in:' + uid;
      await redis([['HSET', k, item.id, JSON.stringify(item)], ['EXPIRE', k, 2592000]]);
      return J({ ok: true });
    }
    const user = await verifyAny(String(b.initData || ''), tokens); // от Mini App
    if (!user || !user.id) return J({ error: 'bad initData' }, 401);
    const k = 'sx:in:' + user.id;
    if (b.action === 'done' && Array.isArray(b.ids) && b.ids.length) await redis([['HDEL', k, ...b.ids.slice(0, 50).map(String)]]);
    const [flat] = await redis([['HGETALL', k]]);
    const items = [];
    for (let i = 1; i < (flat || []).length; i += 2) { try { const o = JSON.parse(flat[i]); items.push({ id: o.id, title: o.title, artist: o.artist, dur: o.dur, size: o.size, t: o.t }); } catch (e) {} }
    items.sort((a, c) => a.t - c.t);
    return J({ items });
  } catch (e) {
    return J({ error: 'storage' }, 502);
  }
}
