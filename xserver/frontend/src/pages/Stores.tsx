// 店舗えらびページ /stores（紹介カードの QR の行き先は /stores?from=card、紹介元（業者）の専用 QR は /stores?ref=…）
// 全店舗をエリアごとに並べ、住所・地図・今日（休診日は次の営業日）の空いている時間帯を出す。店舗を選ぶと WEB 予約へ。
// 本部が「公開する」にするまでは「準備中」の案内だけを出す
import { useEffect, useMemo, useState } from 'react';
import { cityOf } from '@/lib/city';
import PublicFooter from '@/components/PublicFooter';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '@/lib/api';
import { WEEKDAY_JA, weekdayOf } from '@/lib/time';

const SKY = '#1eb4ec';
interface Quiet { date: string; isToday: boolean; closedToday: boolean; am: string | null; pm: string | null }
interface StoreItem { code: string; name: string; phone: string; address: string; lat: number | null; lng: number | null; area: string; quiet: Quiet | null }
interface Resp { open: boolean; today?: string; hours?: { rows: { days: string; text: string }[]; closed: string }; areas?: string[]; stores?: StoreItem[] }

/** 2 点間の距離（km） */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}（${WEEKDAY_JA[weekdayOf(d)]}）`;

function Logo() {
  return (
    <div className="flex justify-center px-4 pb-4 pt-5">
      {/* ロゴは元データ（横長の画像）をそのまま使う。なつめ接骨院グループのロゴができたら差し替え */}
      <img src="/brand/hachimaru-skip-yoko.png" alt="HACHIMARU SKIP　80歳になっても、スキップしよう！" width={960} height={264} className="h-auto w-full max-w-[300px]" />
    </div>
  );
}

export default function Stores() {
  const [params] = useSearchParams();
  const fromCard = params.get('from') === 'card';
  // 紹介元（業者）の専用 QR（/stores?ref=…）。予約ページへそのまま引き継ぐ
  const ref = /^[a-z0-9]{4,16}$/.test(params.get('ref') ?? '') ? params.get('ref')! : '';
  const carry = new URLSearchParams({ ...(fromCard ? { from: 'card' } : {}), ...(ref ? { ref } : {}) }).toString();
  const preview = params.get('preview') === '1'; // 本部の確認用（公開前でも本部でログイン中なら見られる）
  const { data, error } = useFetch<Resp>(`/api/public-stores${preview ? '?preview=1' : ''}`);
  const [q, setQ] = useState('');
  const [area, setArea] = useState(''); // 市・町（住所から）
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState('');

  useEffect(() => { document.title = '店舗のご案内'; }, []);

  const list = useMemo(() => {
    const all = data?.stores ?? [];
    const word = q.trim();
    let xs = all.filter((s) => (!area || cityOf(s.address) === area) && (!word || s.name.includes(word) || s.address.includes(word)));
    if (here) xs = [...xs].sort((a, b) => (a.lat == null ? 1e9 : distanceKm(here, { lat: a.lat, lng: a.lng! })) - (b.lat == null ? 1e9 : distanceKm(here, { lat: b.lat, lng: b.lng! })));
    return xs;
  }, [data, q, area, here]);

  function near() {
    if (here) { setHere(null); return; }
    if (!navigator.geolocation) { setGeoMsg('この端末では位置情報が使えません'); return; }
    setGeoMsg('現在地を調べています…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setHere({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoMsg(''); },
      () => setGeoMsg('位置情報が使えませんでした（スマホの設定で位置情報を許可してください）'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  if (error || (data && !data.open)) {
    return (
      <main className="mx-auto min-h-screen max-w-md bg-white">
        <Logo />
        <div className="px-4 py-4 text-white" style={{ background: SKY }}>
          <h1 className="text-xl font-bold">店舗のご案内</h1>
          <p className="mt-1 text-sm">ご来院ありがとうございます。</p>
        </div>
        <div className="space-y-3 px-4 py-6 text-sm leading-relaxed text-slate-700">
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-base font-bold text-sky-900">店舗一覧のページは、ただいま準備中です。</p>
          <p>まもなく、こちらから全店舗の一覧・空いている時間帯をご覧いただき、WEB でご予約いただけるようになります。</p>
          <p>それまでは、お近くの店舗へお電話でご予約ください。</p>
        </div>
      </main>
    );
  }
  if (!data) return <main className="mx-auto max-w-md px-4 pt-10 text-sm text-slate-500">読み込み中…</main>;

  // 患者様に分かりやすいよう、エリアではなく住所の市・町で分ける（並びは本部の店舗一覧の順に、はじめて出てきた順）
  const areas = [...new Set((data.stores ?? []).map((s) => cityOf(s.address)).filter(Boolean))];
  const groups = here || area || q.trim()
    ? [{ name: '', stores: list }]
    : [...areas.map((a) => ({ name: a, stores: list.filter((s) => cityOf(s.address) === a) })), { name: areas.length ? 'そのほか' : '', stores: list.filter((s) => !cityOf(s.address)) }].filter((g) => g.stores.length);

  return (
    <main className="mx-auto min-h-screen max-w-md bg-sky-50/40 pb-10">
      {preview && <p className="bg-amber-100 px-3 py-1.5 text-center text-xs font-bold text-amber-900">本部の確認用の表示です（「公開する」にするまで患者様には「準備中」と出ます）</p>}
      <div className="bg-white"><Logo /></div>
      <div className="px-4 py-4 text-white" style={{ background: SKY }}>
        <h1 className="text-xl font-bold">ご予約の店舗をお選びください</h1>
        <p className="mt-1 text-sm">店舗を選ぶと、その店舗の WEB 予約の画面に進みます。</p>
      </div>

      {data.hours && (
        <section className="mx-3 mt-3 rounded-xl border bg-white px-3 py-2 text-sm" aria-label="営業時間">
          <h2 className="text-xs font-bold text-slate-500">営業時間（全店共通）</h2>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
            {data.hours.rows.map((r) => <div key={r.days} className="contents"><dt className="font-bold">{r.days}</dt><dd>{r.text}</dd></div>)}
            {data.hours.closed && <><dt className="font-bold">休診日</dt><dd>{data.hours.closed}</dd></>}
          </dl>
        </section>
      )}

      <div className="sticky top-0 z-10 mt-3 space-y-2 border-y bg-white px-3 py-2">
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="店舗名・住所で探す" aria-label="店舗名・住所で探す" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" />
          <button type="button" onClick={near} aria-pressed={!!here} className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-bold ${here ? 'border-sky-700 bg-sky-700 text-white' : 'border-sky-400 bg-sky-50 text-sky-800'}`}>📍 近い順</button>
        </div>
        {areas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-0.5" role="group" aria-label="市・町">
            {['', ...areas].map((a) => (
              <button key={a || 'all'} type="button" aria-pressed={area === a} onClick={() => setArea(a)}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${area === a ? 'border-sky-700 bg-sky-700 text-white' : 'bg-white'}`}>{a || 'すべて'}</button>
            ))}
          </div>
        )}
        {geoMsg && <p className="text-xs text-slate-600">{geoMsg}</p>}
      </div>

      {groups.map((g) => (
        <section key={g.name || 'all'} className="px-3">
          {g.name && <h2 className="px-1 pb-1 pt-3 text-xs font-bold tracking-wide text-slate-500">{g.name}</h2>}
          <div className="mt-2 space-y-2.5">
            {g.stores.map((s) => {
              const dist = here && s.lat != null ? distanceKm(here, { lat: s.lat, lng: s.lng! }) : null;
              const map = s.lat != null ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}` : s.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}` : null;
              const qt = s.quiet;
              return (
                <article key={s.code} className="rounded-2xl border bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-bold leading-snug">{s.name}</h3>
                    {dist !== null && <span className="whitespace-nowrap text-xs font-bold text-sky-800">約 {dist < 10 ? dist.toFixed(1) : Math.round(dist)} km</span>}
                  </div>
                  {s.address && <p className="mt-0.5 text-xs text-slate-500">{s.address}</p>}
                  <div className="mt-2 rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs">
                    {!qt ? <span className="text-slate-600">空き状況はお電話でお問い合わせください</span> : (
                      <>
                        <b className="text-sky-800">{qt.closedToday ? `本日 休診日 → ${md(qt.date)}` : qt.isToday ? '本日' : md(qt.date)}の空いている時間帯</b>
                        <div className="mt-0.5 flex flex-wrap gap-x-4 font-bold tabular-nums">
                          <span>午前 {qt.am ?? '残りわずか'}</span>
                          <span>午後 {qt.pm ?? '残りわずか'}</span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-[2fr_1fr_1fr] gap-1.5 text-sm">
                    <a href={`/s/${encodeURIComponent(s.code)}${carry ? `?${carry}` : ''}`} className="rounded-lg bg-sky-700 px-2 py-2 text-center font-bold text-white no-underline">WEB 予約</a>
                    <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="rounded-lg border border-sky-700 px-2 py-2 text-center font-bold text-sky-800 no-underline">電話</a>
                    {map ? <a href={map} target="_blank" rel="noreferrer" className="rounded-lg border px-2 py-2 text-center text-slate-700 no-underline">地図</a> : <span />}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {list.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">見つかりませんでした</p>}
      <p className="mt-4 px-4 text-[11px] leading-relaxed text-slate-500">
        ※「近い順」はスマホの位置情報を使います（並べ替えにだけ使い、送信・保存はしません）。<br />
        ※「空いている時間帯」は、今日（休診日は次の営業日）の予約の入り方から出した目安です。
      </p>
      <PublicFooter />
    </main>
  );
}
