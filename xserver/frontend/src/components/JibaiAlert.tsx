// 自賠請求の提出のアラート。その月の最終営業日の営業終了の時刻から、提出するまで（締め切り：翌月 5 日）。
// 画面を開いたままでも営業終了の時刻を過ぎたら出るよう、10 分ごとに確かめる。
// ログインしたあと 1 日 1 回、画面の上に知らせる（店舗：自分の店舗／本部・管轄MG：未提出の店舗の一覧）。メニューには赤い印
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JibaiAlert as Alert } from '@/lib/types';

const ymJa = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
const mdJa = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
export const jibaiAlertText = (a: { ym: string; deadline: string; daysLeft: number; overdue: boolean }) =>
  a.overdue ? `締め切り（${mdJa(a.deadline)}）を過ぎています` : a.daysLeft === 0 ? `締め切りは今日（${mdJa(a.deadline)}）です` : `締め切り：${mdJa(a.deadline)}（あと ${a.daysLeft} 日）`;

export default function JibaiAlertDialog({ alert: first, role, today }: { alert: Alert | null | undefined; role: string; today: string }) {
  const key = `natsume.jibaiAlert.${today}`;
  const [alert, setAlert] = useState(first);
  useEffect(() => { setAlert(first); }, [first]);
  useEffect(() => {
    if (role !== 'store' && role !== 'hq' && role !== 'mg') return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/admin/me').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setAlert(j.jibaiAlert ?? null); }).catch(() => {});
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [role]);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== '1'; } catch { return true; } });
  const nav = useNavigate();
  if (!alert || !open) return null;
  const close = () => { setOpen(false); try { localStorage.setItem(key, '1'); } catch { /* 覚えられなくても動く */ } };
  const stores = 'stores' in alert ? alert.stores : null;
  const one = stores ? null : (alert as Exclude<Alert, { stores: unknown }>);
  const overdue = stores ? stores.some((s) => s.overdue) : !!one?.overdue;
  return (
    <div className="no-print fixed inset-0 z-[45] flex items-center justify-center bg-black/30 p-4" role="alertdialog" aria-label="自賠請求の提出のお知らせ">
      <div className={`w-full max-w-md rounded-lg border-2 bg-white p-4 text-sm shadow-xl ${overdue ? 'border-red-500' : 'border-amber-400'}`}>
        <h2 className={`text-base font-bold ${overdue ? 'text-red-700' : 'text-amber-800'}`}>⚠ 自賠請求の提出のお知らせ</h2>
        {one && (
          <p className="mt-2"><b>{ymJa(one.ym)}分</b>の自賠請求が、まだ提出されていません。<br /><b className={one.overdue ? 'text-red-700' : ''}>{jibaiAlertText(one)}</b><br />
            <span className="text-xs text-slate-600">請求する患者様がいない月は「請求者なし（0 件で提出）」を押してください。</span></p>
        )}
        {stores && (
          <>
            <p className="mt-2">{role === 'mg' ? '管轄の店舗で、' : ''}自賠請求をまだ提出していない店舗があります（<b>{stores.length} 店舗</b>）。</p>
            <ul className="mt-1 max-h-48 overflow-auto rounded border bg-slate-50 px-3 py-1 text-xs">
              {stores.map((s) => <li key={s.code} className={s.overdue ? 'font-bold text-red-700' : ''}>{s.name}：{ymJa(s.ym)}分（{jibaiAlertText(s)}）</li>)}
            </ul>
          </>
        )}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => { close(); nav(stores ? `/admin/hq/jibai?ym=${stores[0].ym}` : `/admin/jibai?ym=${one!.ym}`); }} className="rounded bg-brand px-4 py-1.5 font-bold text-white">{stores ? '自賠集計を開く' : '自賠請求を開く'}</button>
          <button type="button" onClick={close} className="rounded border px-4 py-1.5">あとで</button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">このお知らせは 1 日 1 回出ます。提出すると出なくなります。</p>
      </div>
    </div>
  );
}
