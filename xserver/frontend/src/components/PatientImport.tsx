// 店舗設定：患者一覧（診察券番号 → 氏名）の取り込み。CSV はこの画面で読み、番号・氏名・フリガナだけを送る
import { useEffect, useState } from 'react';
import { parsePatientCsv } from '@/lib/patientCsv';

export default function PatientImport() {
  const [info, setInfo] = useState<{ count: number; importedAt: string | null } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetch('/api/admin/patients').then((r) => r.json()).then(setInfo).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      // レセコンの CSV は Shift-JIS。UTF-8 で保存し直したものも読めるようにする
      let text = new TextDecoder('shift_jis').decode(buf);
      try { const u = new TextDecoder('utf-8', { fatal: true }).decode(buf); text = u; } catch { /* Shift-JIS のまま */ }
      const { rows, skipped } = parsePatientCsv(text);
      if (!rows.length) { setMsg({ ok: false, text: '診察券番号と氏名が読み取れませんでした。レセコンから出した CSV を選んでください。' }); return; }
      const r = await fetch('/api/admin/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: j.error ?? '取り込めませんでした' }); return; }
      setMsg({ ok: true, text: `${j.count} 人を取り込みました${skipped ? `（番号か氏名が無い ${skipped} 行は飛ばしました）` : ''}。予約表のセルに診察券番号を入れて Enter を押すと氏名になります。` });
      void load();
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded border bg-white p-4 text-sm">
      <h2 className="font-bold">患者一覧（診察券番号 → 氏名）</h2>
      <p className="mt-1 text-xs text-slate-600">
        レセコンから出した患者一覧の CSV を選ぶと取り込みます（この店舗の分だけ。前の一覧は置き換わります）。
        使うのは診察券番号・氏名・フリガナだけで、住所・電話番号・生年月日などはこのパソコンの中で読み捨て、システムには送りません。
        新しい患者様が増えるので、週 1 回など定期的に取り込み直してください。
      </p>
      <p className="mt-2">今の一覧：<b>{info ? `${info.count} 人` : '…'}</b>{info?.importedAt && <span className="ml-2 text-xs text-slate-500">（{info.importedAt.slice(0, 16)} に取り込み）</span>}</p>
      <label className={`mt-2 inline-block cursor-pointer rounded bg-brand px-4 py-1.5 font-bold text-white ${busy ? 'opacity-50' : ''}`}>
        {busy ? '取り込み中…' : 'CSV を選んで取り込む'}
        <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={onFile} />
      </label>
      {msg && <p className={`mt-2 rounded px-3 py-2 ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
    </section>
  );
}
