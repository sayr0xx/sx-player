// Vercel Edge Function: отдаёт Mini App аудиофайл из Telegram (потоком, без лимита 4,5 МБ).
// Токен бота остаётся на сервере, наружу не уходит. Отдаются только файлы из «входящих» этого пользователя.
export const config = { runtime: 'edge' };

const enc = new TextEncoder();
const TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav' };
const T = (s, status) => new Response(s, { status, headers: { 'cache-control': 'no-store' } });
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
async function verifyInitData(raw, botToken) {
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
  if (req.method !== 'POST') return T('POST only', 405);
  const env = process.env, tokens = [env.BOT_TOKEN, env.INBOX_BOT_TOKEN].filter(Boolean);
  if (!tokens.length) return T('not configured', 500);
  let b; try { b = await req.json(); } catch (e) { return T('bad json', 400); }
  const user = await verifyAny(String(b.initData || ''), tokens);
  if (!user || !user.id) return T('bad initData', 401);
  try {
    const [raw] = await redis([['HGET', 'sx:in:' + user.id, String(b.id || '')]]);
    if (!raw) return T('not found', 404);
    const item = JSON.parse(raw);
    const token = item.b === 'b' ? env.INBOX_BOT_TOKEN : env.BOT_TOKEN; // file_id работает только с токеном того бота, который его получил
    if (!token) return T('not configured', 500);
    const info = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(item.fid)}`)).json();
    if (!info.ok) return T('telegram: ' + (info.description || 'getFile failed'), 502); // например: файл больше 20 МБ
    const up = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`);
    if (!up.ok || !up.body) return T('download failed', 502);
    const ext = String(info.result.file_path).split('.').pop().toLowerCase();
    return new Response(up.body, { headers: { 'content-type': TYPES[ext] || 'audio/mpeg', 'cache-control': 'no-store' } }); // поток
  } catch (e) {
    return T('storage', 502);
  }
}
