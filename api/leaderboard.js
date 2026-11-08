const crypto = require('crypto');
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmds) {
  const r = await fetch(REDIS_URL + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + REDIS_TOKEN }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}

function checkInitData(raw, botToken) {
  const p = new URLSearchParams(raw), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const str = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.BOT_TOKEN || !REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'not configured' });
  const { initData, sec, remove } = req.body || {};
  const user = typeof initData === 'string' && checkInitData(initData, process.env.BOT_TOKEN);
  if (!user || !user.id) return res.status(401).json({ error: 'bad initData' });
  const id = String(user.id);
  const name = (user.username ? '@' + user.username : user.first_name || 'user').slice(0, 24);
  try {
    if (remove) await redis([['ZREM', 'sx:lb', id], ['HDEL', 'sx:names', id]]);
    else if (Number.isFinite(sec) && sec >= 0 && sec <= 3.2e8) {
      await redis([['ZADD', 'sx:lb', 'GT', String(Math.floor(sec)), id], ['HSET', 'sx:names', id, name]]);
    }
    const [flat, rank, mine] = await redis([['ZREVRANGE', 'sx:lb', 0, 9, 'WITHSCORES'], ['ZREVRANK', 'sx:lb', id], ['ZSCORE', 'sx:lb', id]]);
    const ids = flat.filter((_, i) => i % 2 === 0);
    const names = ids.length ? (await redis([['HMGET', 'sx:names', ...ids]]))[0] : [];
    const top = ids.map((uid, i) => ({ name: names[i] || 'user', sec: Number(flat[i * 2 + 1]), me: uid === id }));
    res.status(200).json({ top, me: rank === null ? null : { rank: rank + 1, sec: Number(mine) } });
  } catch (e) {
    res.status(502).json({ error: 'storage' });
  }
};
