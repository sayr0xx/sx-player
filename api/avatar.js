
export const config = { runtime: 'edge' };

const NO_CACHE = {
  'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
  'cdn-cache-control': 'no-store',
  'vercel-cdn-cache-control': 'no-store',
  'pragma': 'no-cache'
};

async function redis(cmds) {
  const env = process.env;
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const tok = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;

  const r = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok },
    body: JSON.stringify(cmds),
    cache: 'no-store'
  });

  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}

const no = (status) => new Response('no', {
  status,
  headers: NO_CACHE
});

export default async function handler(req) {
  const q = new URL(req.url).searchParams;
  const p = q.get('p') || '';
  const dbg = q.get('debug') === '1';
  const info = {};

  const out = (status) => dbg
    ? new Response(JSON.stringify(info), {
        status,
        headers: {
          ...NO_CACHE,
          'content-type': 'application/json'
        }
      })
    : no(status);

  if (!/^[0-9a-f]{16}$/.test(p)) return no(400);

  const tokens = [
    process.env.BOT_TOKEN,
    process.env.INBOX_BOT_TOKEN
  ].filter(Boolean);

  if (!tokens.length) return no(500);

  try {
    const [id] = await redis([
      ['HGET', 'sx:pids', p]
    ]);

    info.codeKnown = !!id;
    if (!id) return out(404);

    const [score] = await redis([
      ['ZSCORE', 'sx:lb', id]
    ]);

    info.inTop = score !== null;
    if (score === null) return out(404);

    info.bot = [];

    for (const tok of tokens) {
      try {
        const ph = await (await fetch(
          `https://api.telegram.org/bot${tok}/getUserProfilePhotos?user_id=${id}&limit=1`,
          { cache: 'no-store' }
        )).json();

        if (!ph.ok) {
          info.bot.push('ошибка: ' + ph.description);
          continue;
        }

        const sizes = ph.result.photos && ph.result.photos[0];

        if (!sizes) {
          info.bot.push('фото не видно боту');
          continue;
        }

        const pick = sizes[Math.min(1, sizes.length - 1)];

        const f = await (await fetch(
          `https://api.telegram.org/bot${tok}/getFile?file_id=${pick.file_id}`,
          { cache: 'no-store' }
        )).json();

        if (!f.ok) {
          info.bot.push('getFile: ' + f.description);
          continue;
        }

        const img = await fetch(
          `https://api.telegram.org/file/bot${tok}/${f.result.file_path}`,
          { cache: 'no-store' }
        );

        if (img.ok && img.body) {
          if (dbg) {
            info.bot.push('ок');
            return out(200);
          }

          return new Response(img.body, {
            headers: {
              ...NO_CACHE,
              'content-type': img.headers.get('content-type') || 'image/jpeg'
            }
          });
        }

        info.bot.push('скачивание: ' + img.status);

      } catch (e) {
        info.bot.push('сбой: ' + e.message);
      }
    }

    const [pu] = await redis([
      ['HGET', 'sx:photos', id]
    ]);

    info.photoUrl = !!pu;

    if (pu && /^https:\/\/t\.me\/i\/userpic\//.test(pu)) {
      try {
        const img = await fetch(pu, { cache: 'no-store' });
        info.photoUrlStatus = img.status;

        if (img.ok && img.body && !dbg) {
          return new Response(img.body, {
            headers: {
              ...NO_CACHE,
              'content-type': img.headers.get('content-type') || 'image/jpeg'
            }
          });
        }
      } catch (e) {
        info.photoUrlStatus = 'сбой';
      }
    }

    return out(404);

  } catch (e) {
    info.error = e.message;
    return out(502);
  }
}
