// SNS 連携の確認用：Instagram API・Google Business Profile API・LINE Messaging API の代わりに応答する小さなサーバー
// 使い方：node e2e/sns-mock.mjs（既定 127.0.0.1:3010）。config.php に 'SNS_API_MOCK' => 'http://127.0.0.1:3010' を入れる
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 3010);
export const calls = [];
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); });
const ymd = (d) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });

// Instagram が画像を取りに来る動きを真似る（公開 URL で JPEG が取れなければ投稿できない）
async function fetchImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`image fetch ${r.status}`);
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('jpeg')) throw new Error(`image content-type ${ct}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1000) throw new Error('image too small');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  const body = await readBody(req);
  const form = Object.fromEntries(new URLSearchParams(body));
  calls.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body: body.slice(0, 2000), auth: req.headers.authorization ?? '' });
  try {
    // ---- Instagram（Instagram ログイン方式）
    if (p === '/ig-oauth/oauth/authorize') { res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=IGCODE&state=${encodeURIComponent(u.searchParams.get('state'))}` }); return res.end(); }
    if (p === '/ig-api/oauth/access_token') return json(res, 200, { access_token: 'short-token', user_id: '17841400000001' });
    if (p === '/ig-graph/access_token') return json(res, 200, { access_token: 'long-token-1', token_type: 'bearer', expires_in: 5183944 });
    if (p === '/ig-graph/refresh_access_token') return json(res, 200, { access_token: 'long-token-2', token_type: 'bearer', expires_in: 5183944 });
    const token = u.searchParams.get('access_token') ?? form.access_token;
    if (p.startsWith('/ig-graph/')) {
      if (!token || !token.startsWith('long-token') && token !== 'pasted-token') return json(res, 400, { error: { message: 'Invalid OAuth access token', code: 190 } });
      const seg = p.split('/').slice(3); // ['v23.0', ...] の後ろ
      if (seg[0] === 'me') return json(res, 200, { user_id: '17841400000001', username: 'natsume_test', followers_count: 1234, media_count: 10 });
      if (seg[1] === 'media' && req.method === 'POST') {
        if (!form.image_url || !form.caption) return json(res, 400, { error: { message: 'image_url and caption required' } });
        await fetchImage(form.image_url);
        return json(res, 200, { id: 'CREATION1' });
      }
      if (seg[0] === 'CREATION1') return json(res, 200, { status_code: 'FINISHED', id: 'CREATION1' });
      if (seg[1] === 'media_publish') { if (form.creation_id !== 'CREATION1') return json(res, 400, { error: { message: 'bad creation_id' } }); return json(res, 200, { id: 'MEDIA1' }); }
      if (seg[0] === 'MEDIA1' && seg.length === 1) return json(res, 200, { id: 'MEDIA1', permalink: 'https://www.instagram.com/p/MEDIA1/', like_count: 12, comments_count: 3 });
      if (seg[0] === 'MEDIA1' && seg[1] === 'insights') {
        const metrics = (u.searchParams.get('metric') ?? '').split(',');
        if (metrics.includes('views')) return json(res, 400, { error: { message: 'views not supported for this media' } });
        return json(res, 200, { data: metrics.map((m) => ({ name: m, values: [{ value: { reach: 450, saved: 7, shares: 2 }[m] ?? 0 }] })) });
      }
      if (seg[1] === 'insights') {
        const out = []; const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
        for (let i = 0; i < 7; i++) { const e = new Date(d); e.setUTCDate(e.getUTCDate() - i + 1); out.push({ value: 100 + i, end_time: e.toISOString().slice(0, 10) + 'T07:00:00+0000' }); }
        return json(res, 200, { data: [{ name: 'reach', period: 'day', values: out.reverse() }] });
      }
      if (seg[1] === 'media') return json(res, 200, { data: [{ id: 'MEDIA1', timestamp: new Date().toISOString(), media_type: 'IMAGE' }] });
      return json(res, 404, { error: { message: `mock: unknown ig path ${p}` } });
    }
    // ---- Google
    if (p === '/google-auth/o/oauth2/v2/auth') { res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=GCODE&state=${encodeURIComponent(u.searchParams.get('state'))}` }); return res.end(); }
    if (p === '/google-token/token') {
      if (form.grant_type === 'authorization_code') return json(res, 200, { access_token: 'g-access-1', refresh_token: 'g-refresh-1', expires_in: 3599 });
      if (form.grant_type === 'refresh_token' && form.refresh_token === 'g-refresh-1') return json(res, 200, { access_token: 'g-access-2', expires_in: 3599 });
      return json(res, 400, { error: 'invalid_grant', error_description: 'mock: bad grant' });
    }
    if (p.startsWith('/gbp-') && !(req.headers.authorization ?? '').startsWith('Bearer g-access')) return json(res, 401, { error: { message: 'mock: missing bearer' } });
    if (p === '/gbp-accounts/v1/accounts') return json(res, 200, { accounts: [{ name: 'accounts/100', accountName: 'なつめ接骨院グループ', type: 'LOCATION_GROUP' }] });
    if (p === '/gbp-info/v1/accounts/100/locations') return json(res, 200, { locations: [
      { name: 'locations/201', title: 'なつめ接骨院 本店', storefrontAddress: { administrativeArea: '静岡県', locality: '沼津市', addressLines: ['大手町1-1-1'] } },
      { name: 'locations/202', title: 'なつめ接骨院 駅前院', storefrontAddress: { administrativeArea: '静岡県', locality: '沼津市', addressLines: ['大手町2-2-2'] } }] });
    if (p === '/gbp-v4/v4/accounts/100/locations/201/localPosts' && req.method === 'POST') {
      const j = JSON.parse(body);
      if (!j.summary || j.languageCode !== 'ja') return json(res, 400, { error: { message: 'summary required' } });
      if (j.media?.[0]?.sourceUrl) await fetchImage(j.media[0].sourceUrl);
      return json(res, 200, { name: 'accounts/100/locations/201/localPosts/LP1', searchUrl: 'https://local.google.com/place?id=1&use=posts&lpsid=LP1', state: 'LIVE' });
    }
    if (p.startsWith('/gbp-perf/v1/locations/201:fetchMultiDailyMetricsTimeSeries')) {
      const metrics = u.searchParams.getAll('dailyMetrics');
      const start = new Date(Date.UTC(+u.searchParams.get('dailyRange.startDate.year'), +u.searchParams.get('dailyRange.startDate.month') - 1, +u.searchParams.get('dailyRange.startDate.day')));
      const days = 10;
      return json(res, 200, { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: metrics.map((m) => ({ dailyMetric: m, timeSeries: { datedValues: Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return { date: ymd(d), value: String(m.includes('IMPRESSIONS') ? 50 + i : 2) }; }) } })) }] });
    }
    if (p === '/gbp-v4/v4/accounts/100/locations/201/reviews') return json(res, 200, { reviews: [
      { name: 'accounts/100/locations/201/reviews/R1', reviewer: { displayName: '山田' }, starRating: 'FIVE', comment: '丁寧でした', createTime: '2026-09-20T03:00:00Z' },
      { name: 'accounts/100/locations/201/reviews/R2', reviewer: { displayName: '佐藤' }, starRating: 'THREE', comment: '待ち時間が長い', createTime: '2026-09-28T03:00:00Z', reviewReply: { comment: 'ありがとうございます', updateTime: '2026-09-29T01:00:00Z' } }] });
    if (p === '/gbp-v4/v4/accounts/100/locations/201/reviews/R1/reply' && req.method === 'PUT') return json(res, 200, { comment: JSON.parse(body).comment });
    // ---- LINE
    if (p === '/line/v2/bot/message/push' || p === '/line/v2/bot/message/multicast') return json(res, 200, {});
    if (p.startsWith('/line/v2/bot/profile/')) return json(res, 200, { displayName: 'テスト太郎', userId: p.split('/').pop() });
    if (p === '/__calls') return json(res, 200, calls);
    if (p === '/__reset') { calls.length = 0; return json(res, 200, { ok: true }); }
    return json(res, 404, { error: { message: `mock: unknown path ${p}` } });
  } catch (e) {
    return json(res, 500, { error: { message: `mock: ${e.message}` } });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`sns mock listening on http://127.0.0.1:${PORT}`));
