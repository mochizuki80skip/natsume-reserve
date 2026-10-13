// 更新のお知らせ
// ・UpdateBanner：本部が新しい版を入れると、開いたままの画面の上に「画面が新しくなりました」と出す（version.json を 2 分ごとに確認）
// ・WhatsNew：新しい版を開いたとき、まだ見ていない変更内容を一度だけ出す
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_VERSION } from '@/version';
import { CHANGELOG, LATEST_CHANGE_ID, type Audience, type ChangeEntry } from '@/changelog';

const SEEN_KEY = 'natsume.seenChangeId';
const forRole = (role: string) => (c: ChangeEntry) => role === 'hq' || c.audience.includes('店舗' as Audience);

export function ChangeList({ list }: { list: ChangeEntry[] }) {
  return (
    <div className="space-y-3">
      {list.map((c) => (
        <section key={c.id}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-bold">{c.title}</h3>
            <span className="text-[11px] text-slate-500">{c.date.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日')}</span>
            {c.audience.map((a) => <span key={a} className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">{a}</span>)}
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {c.items.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function UpdateBanner({ role }: { role: string }) {
  const [next, setNext] = useState<{ version: string; notes: ChangeEntry[] } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (APP_VERSION === 'dev') return;
    let alive = true;
    async function check() {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const j = await r.json() as { version?: string; notes?: ChangeEntry[] };
        if (j.version && j.version !== APP_VERSION) setNext({ version: j.version, notes: (j.notes ?? []).filter((c) => c.id > LATEST_CHANGE_ID).filter(forRole(role)) });
      } catch { /* 確認できないときは次の回に */ }
    }
    void check();
    const id = setInterval(check, 2 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [role]);
  if (!next) return null;
  return (
    <div role="status" className="no-print border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <b>画面が新しくなりました</b>
        <span className="text-xs">キリのよいところで「更新する」を押してください（入力した内容は保存されてから更新されます）。</span>
        <span className="ml-auto flex gap-2">
          {next.notes.length > 0 && <button type="button" onClick={() => setOpen(!open)} className="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs">{open ? '閉じる' : '変更内容を見る'}</button>}
          <button type="button" onClick={() => window.location.reload()} className="rounded bg-amber-600 px-3 py-0.5 text-xs font-bold text-white">更新する</button>
        </span>
      </div>
      {open && <div className="mx-auto mt-2 max-w-6xl rounded border border-amber-200 bg-white p-3"><ChangeList list={next.notes} /></div>}
    </div>
  );
}

export function WhatsNew({ role }: { role: string }) {
  const [list, setList] = useState<ChangeEntry[]>([]);
  useEffect(() => {
    let seen: number | null = null;
    try { const v = localStorage.getItem(SEEN_KEY); seen = v === null ? null : Number(v); } catch { return; }
    const mine = CHANGELOG.filter(forRole(role));
    // 初めてのときは、いちばん新しい日の分だけ見せる
    const latestDate = mine[0]?.date;
    setList(seen === null ? mine.filter((c) => c.date === latestDate) : mine.filter((c) => c.id > (seen as number)));
  }, [role]);
  if (list.length === 0) return null;
  const close = () => { try { localStorage.setItem(SEEN_KEY, String(LATEST_CHANGE_ID)); } catch { /* 保存できなくても閉じる */ } setList([]); };
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div role="dialog" aria-label="更新のお知らせ" className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-bold">更新のお知らせ</h2>
        <ChangeList list={list.slice(0, 6)} />
        <div className="mt-4 flex items-center justify-between gap-2">
          <Link to="/admin/updates" onClick={close} className="text-sm text-brand underline">これまでのお知らせ</Link>
          <button type="button" onClick={close} className="rounded bg-brand px-4 py-1.5 text-sm font-bold text-white">確認しました</button>
        </div>
      </div>
    </div>
  );
}
