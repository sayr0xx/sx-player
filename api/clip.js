// Принимает видеоклип из приложения и отправляет его пользователю в чат с ботом (оттуда в один тап сохраняется в галерею).
const crypto = require('crypto');
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
  if (!process.env.BOT_TOKEN) return res.status(500).json({ error: 'env' });
  const u = verify(req.headers['x-init-data']); if (!u) return res.status(401).json({ error: 'auth' });
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 4.6e6) return res.status(413).json({ error: 'big' }); chunks.push(c); }
  const buf = Buffer.concat(chunks); if (!buf.length) return res.status(400).json({ error: 'empty' });
  const mp4 = req.query.ext === 'mp4', title = String(req.query.title || '').slice(0, 100);
  const fd = new FormData();
  fd.append('chat_id', String(u.id)); fd.append('caption', (title ? title + '\n' : '') + 'sayr0xx player');
  fd.append(mp4 ? 'video' : 'document', new Blob([buf], { type: mp4 ? 'video/mp4' : 'video/webm' }), 'sayr0xx-clip.' + (mp4 ? 'mp4' : 'webm'));
  if (mp4) fd.append('supports_streaming', 'true');
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${mp4 ? 'sendVideo' : 'sendDocument'}`, { method: 'POST', body: fd });
    if (!r.ok) return res.status(502).json({ error: 'tg' });
    return res.json({ ok: 1 });
  } catch (e) { return res.status(502).json({ error: 'tg' }); }
};
module.exports.config = { api: { bodyParser: false } };
