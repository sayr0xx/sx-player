// Принимает видеоклип из приложения и отправляет его пользователю в чат с ботом (оттуда в один тап сохраняется в галерею).
const crypto = require('crypto');
const TOKENS = [process.env.BOT_TOKEN, process.env.INBOX_BOT_TOKEN].filter(Boolean); // как в топе: подойдёт любой из двух токенов
function verify(initData) { // возвращает пользователя и тот токен, которым подтверждены данные (этот бот и пишет пользователю)
  if (!initData) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash'); if (!hash) return null; p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  for (const t of TOKENS) {
    const secret = crypto.createHmac('sha256', 'WebAppData').update(t).digest();
    if (crypto.createHmac('sha256', secret).update(str).digest('hex') !== hash) continue;
    if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400) return null;
    try { return { user: JSON.parse(p.get('user')), token: t }; } catch (e) { return null; }
  }
  return null;
}
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!TOKENS.length) return res.status(500).json({ error: 'env' });
  const v = verify(req.headers['x-init-data']); if (!v) return res.status(401).json({ error: 'auth' });
  const u = v.user, tok = v.token;
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 4.6e6) return res.status(413).json({ error: 'big' }); chunks.push(c); }
  const buf = Buffer.concat(chunks); if (!buf.length) return res.status(400).json({ error: 'empty' });
  const mp4 = req.query.ext === 'mp4', title = String(req.query.title || '').slice(0, 100);
  const fd = new FormData();
  fd.append('chat_id', String(u.id)); fd.append('caption', (title ? title + '\n' : '') + 'sayr0xx player');
  fd.append(mp4 ? 'video' : 'document', new Blob([buf], { type: mp4 ? 'video/mp4' : 'video/webm' }), 'sayr0xx-clip.' + (mp4 ? 'mp4' : 'webm'));
  if (mp4) fd.append('supports_streaming', 'true');
  try {
    const r = await fetch(`https://api.telegram.org/bot${tok}/${mp4 ? 'sendVideo' : 'sendDocument'}`, { method: 'POST', body: fd });
    if (!r.ok) return res.status(502).json({ error: 'tg' });
    return res.json({ ok: 1 });
  } catch (e) { return res.status(502).json({ error: 'tg' }); }
};
module.exports.config = { api: { bodyParser: false } };
