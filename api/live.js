// «Сейчас слушают» + реакции. Использует те же BOT_TOKEN и базу Upstash, что и остальные файлы в папке api.
const crypto = require('crypto');
const DB = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(cmds) {
  const r = await fetch(DB + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + TK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('db');
  return (await r.json()).map(x => x.result);
}
function verify(initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash'); if (!hash) return null; p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  if (crypto.createHmac('sha256', secret).update(str).digest('hex') !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch (e) { return null; }
}
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.BOT_TOKEN || !DB || !TK) return res.status(500).json({ error: 'env' });
  let b = req.body || {}; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const u = verify(b.initData); if (!u) return res.status(401).json({ error: 'auth' });
  const id = String(u.id), name = String(u.first_name || u.username || 'Аноним').slice(0, 30);
  try {
    if (b.action === 'set') {
      await redis([['SET', 'live:' + id, JSON.stringify({ id, name, track: String(b.track || '').slice(0, 80) }), 'EX', '150'], ['SADD', 'live:users', id]]);
      return res.json({ ok: 1 });
    }
    if (b.action === 'off') { await redis([['DEL', 'live:' + id], ['SREM', 'live:users', id]]); return res.json({ ok: 1 }); }
    if (b.action === 'list') {
      const [ids] = await redis([['SMEMBERS', 'live:users']]); if (!ids || !ids.length) return res.json({ items: [] });
      const vals = (await redis([['MGET', ...ids.map(i => 'live:' + i)]]))[0], items = [], dead = [];
      ids.forEach((i, k) => { if (!vals[k]) dead.push(i); else { const o = JSON.parse(vals[k]); if (o.track) items.push({ id: o.id, name: o.name, track: o.track, me: o.id === id }); } });
      if (dead.length) redis([['SREM', 'live:users', ...dead]]).catch(() => {});
      return res.json({ items: items.slice(0, 30) });
    }
    if (b.action === 'react') {
      const to = String(b.to || ''); if (!/^\d+$/.test(to) || to === id) return res.status(400).json({ error: 'bad' });
      const e = ['🔥', '❤️', '👏'].includes(b.emoji) ? b.emoji : '🔥';
      await redis([['LPUSH', 'react:' + to, JSON.stringify({ name, emoji: e, track: String(b.track || '').slice(0, 60) })], ['LTRIM', 'react:' + to, '0', '19'], ['EXPIRE', 'react:' + to, '3600']]);
      return res.json({ ok: 1 });
    }
    if (b.action === 'reacts') {
      const [items] = await redis([['LRANGE', 'react:' + id, '0', '19'], ['DEL', 'react:' + id]]);
      return res.json({ items: (items || []).map(x => JSON.parse(x)) });
    }
    return res.status(400).json({ error: 'bad' });
  } catch (e) { return res.status(502).json({ error: 'db' }); }
};
