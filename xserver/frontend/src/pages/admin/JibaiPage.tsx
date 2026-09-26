// 店舗：自賠責請求の速報登録（スクショをブラウザ内で読み取り → 確認・修正 → 提出）。本部は店舗切替で同じ画面から経理確認を行う
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, useFetch } from '@/lib/api';
import { addMonths, formatDateTime, formatYm, LOG_ACTION_JA, yen, type JibaiClaim, type JibaiLog, type JibaiMonth } from '@/lib/jibai';
import { readInvoiceImage, warmUpOcr, type InvoiceReadResult, type OcrProgress } from '@/lib/jibaiOcr';
import { useAdmin } from './Layout';

interface Resp {
  ym: string; currentYm: string; store: { code: string; name: string }; isHq: boolean; month: JibaiMonth | null;
  claims: JibaiClaim[]; total: number; verifiedTotal: number; months: string[]; logs: JibaiLog[]; nameRetentionDays: number;
}

interface Row {
  key: string; id: string | null; patientNo: string; patientName: string; days: string; amount: string; source: 'OCR' | 'MANUAL';
  dirty: boolean; saved: JibaiClaim | null;
  ocr: { headerImage: string | null; amountImage: string | null; warnings: string[]; elapsedMs: number; fileName: string } | null;
}

let keySeq = 0;
const newKey = () => `k${Date.now()}_${keySeq++}`;

function rowFromClaim(c: JibaiClaim): Row {
  return { key: c.id, id: c.id, patientNo: c.patientNo, patientName: c.patientName ?? '', days: c.days === null ? '' : String(c.days), amount: String(c.amount), source: c.source, dirty: false, saved: c, ocr: null };
}

async function send(url: string, method: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j;
}

export default function JibaiPage() {
  const { me } = useAdmin();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const ymParam = sp.get('ym') ?? '';
  const { data, error, reload } = useFetch<Resp>(`/api/admin/jibai?ym=${encodeURIComponent(ymParam)}`);
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [queueLeft, setQueueLeft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const queueRef = useRef<{ file: Blob; name: string }[]>([]);
  const runningRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // サーバーのデータが変わったら、保存済みの行を置き換え、未保存の新規行は残す
  useEffect(() => {
    if (!data) return;
    setRows((prev) => [...data.claims.map(rowFromClaim), ...prev.filter((r) => !r.id)]);
  }, [data]);

  // 初回のモデル読み込み（数 MB）を先に始めておく
  useEffect(() => {
    warmUpOcr((p) => setProgress(p.message)).then(() => setProgress(null)).catch((e: unknown) => setMsg({ text: `読み取りエンジンの準備に失敗しました：${e instanceof Error ? e.message : String(e)}`, kind: 'err' }));
  }, []);

  const ym = data?.ym ?? ymParam;
  const editable = !!data && (data.isHq || data.month?.status !== 'SUBMITTED');

  const processQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift()!;
        setQueueLeft(queueRef.current.length);
        const onProgress = (p: OcrProgress) => setProgress(`${item.name}：${p.message}`);
        let r: InvoiceReadResult;
        try {
          r = await readInvoiceImage(item.file, onProgress);
        } catch (e: unknown) {
          setMsg({ text: `${item.name} の読み取りに失敗しました：${e instanceof Error ? e.message : String(e)}`, kind: 'err' });
          continue;
        }
        const warnings = [...r.warnings];
        if (r.ym && ym && r.ym !== ym) warnings.push(`スクショの対象月は ${formatYm(r.ym)} です（この画面は ${formatYm(ym)}）`);
        setRows((prev) => [...prev, {
          key: newKey(), id: null, patientNo: r.patientNo, patientName: r.patientName, days: r.days === null ? '' : String(r.days), amount: r.amount === null ? '' : String(r.amount),
          source: 'OCR', dirty: true, saved: null, ocr: { headerImage: r.headerImage, amountImage: r.amountImage, warnings, elapsedMs: r.elapsedMs, fileName: item.name },
        }]);
      }
    } finally {
      runningRef.current = false;
      setProgress(null);
      setQueueLeft(0);
    }
  }, [ym]);

  const addFiles = useCallback((files: { file: Blob; name: string }[]) => {
    const imgs = files.filter((f) => f.file.type.startsWith('image/'));
    if (imgs.length === 0) { setMsg({ text: '画像ファイル（PNG・JPEG）を選んでください', kind: 'err' }); return; }
    queueRef.current.push(...imgs);
    setQueueLeft(queueRef.current.length);
    void processQueue();
  }, [processQueue]);

  // クリップボードからの貼り付け（Win + Shift + S で撮ったスクショをそのまま Ctrl + V）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!editable) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const items = Array.from(e.clipboardData?.items ?? []).filter((i) => i.type.startsWith('image/'));
      if (items.length === 0) return;
      e.preventDefault();
      addFiles(items.map((i, n) => ({ file: i.getAsFile()!, name: `貼り付け${n + 1}` })).filter((x) => x.file));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles, editable]);

  const update = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, dirty: true } : r)));

  async function saveAll() {
    if (!data) return;
    const targets = rows.filter((r) => r.dirty || !r.id);
    if (targets.length === 0) { setMsg({ text: '保存する変更はありません', kind: 'ok' }); return; }
    for (const r of targets) {
      if (!/^\d+$/.test(r.amount.trim())) { setMsg({ text: `「${r.patientNo || '（患者番号なし）'}」の合計金額を数字で入力してください`, kind: 'err' }); return; }
      if (r.days.trim() !== '' && !/^\d{1,2}$/.test(r.days.trim())) { setMsg({ text: `「${r.patientNo || '（患者番号なし）'}」の実日数は 0〜31 の数字で入力してください`, kind: 'err' }); return; }
    }
    setSaving(true);
    try {
      const j = (await send('/api/admin/jibai/claims', 'PUT', {
        ym: data.ym,
        claims: targets.map((r) => ({ id: r.id, patientNo: r.patientNo.trim(), patientName: r.patientName.trim(), days: r.days.trim() === '' ? null : Number(r.days), amount: Number(r.amount), source: r.source })),
      })) as { added: number; updated: number };
      setMsg({ text: `保存しました（追加 ${j.added} 件・更新 ${j.updated} 件）`, kind: 'ok' });
      setRows((prev) => prev.filter((r) => r.id)); // 新規行はサーバーの一覧に置き換わる
      reload();
    } catch (e: unknown) {
      setMsg({ text: e instanceof Error ? e.message : '保存に失敗しました', kind: 'err' });
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(r: Row) {
    if (!r.id) { setRows((prev) => prev.filter((x) => x.key !== r.key)); return; }
    if (!confirm(`「${r.patientNo} ${r.patientName}」の明細を削除します。よろしいですか？`)) return;
    try {
      await send('/api/admin/jibai/claims', 'DELETE', { id: r.id });
      setMsg({ text: '削除しました', kind: 'ok' });
      reload();
    } catch (e: unknown) {
      setMsg({ text: e instanceof Error ? e.message : '削除に失敗しました', kind: 'err' });
    }
  }

  async function submitMonth(action: 'submit' | 'submit_empty' | 'reopen') {
    if (!data) return;
    if (rows.some((r) => r.dirty || !r.id)) { setMsg({ text: '先に「変更を保存」を押してください', kind: 'err' }); return; }
    const label = action === 'reopen' ? '提出を取り消して修正できるようにします。' : action === 'submit_empty' ? `${formatYm(data.ym)} は自賠請求 0 件として提出します。` : `${formatYm(data.ym)} の ${rows.length} 件・${yen(total)} を提出します。提出後は本部の集計に反映されます。`;
    if (!confirm(`${label}よろしいですか？`)) return;
    try {
      await send('/api/admin/jibai/submit', 'POST', { ym: data.ym, action });
      setMsg({ text: action === 'reopen' ? '提出を取り消しました。修正後にもう一度提出してください' : '提出しました', kind: 'ok' });
      reload();
    } catch (e: unknown) {
      setMsg({ text: e instanceof Error ? e.message : '失敗しました', kind: 'err' });
    }
  }

  async function verify(r: Row, verifiedAmount: number | null, note: string) {
    if (!r.id) return;
    try {
      await send('/api/admin/jibai/verify', 'PUT', { id: r.id, verifiedAmount, note });
      setMsg({ text: verifiedAmount === null ? '経理確認を取り消しました' : '経理確認を登録しました', kind: 'ok' });
      reload();
    } catch (e: unknown) {
      setMsg({ text: e instanceof Error ? e.message : '失敗しました', kind: 'err' });
    }
  }

  if (error) return <p className="text-sm text-red-700">{error.message}</p>;
  if (!data) return <p className="text-sm text-slate-500">読み込み中…</p>;

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const verifiedTotal = rows.reduce((s, r) => s + (r.saved?.verifiedAmount ?? 0), 0);
  const verifiedCount = rows.filter((r) => r.saved?.verifiedAmount !== null && r.saved?.verifiedAmount !== undefined).length;
  const unsaved = rows.filter((r) => r.dirty || !r.id).length;
  const dupNos = new Set(rows.map((r) => r.patientNo.trim()).filter((n, i, a) => n !== '' && a.indexOf(n) !== i));
  const go = (m: string) => navigate(`/admin/jibai?ym=${m}`);
  const submitted = data.month?.status === 'SUBMITTED';
  const inputCls = 'w-full rounded border px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-500';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h1 className="mr-2 text-xl font-bold">自賠請求（速報）</h1>
        <button type="button" onClick={() => go(addMonths(ym, -1))} className="rounded border bg-white px-3 py-1">‹ 前月</button>
        <select value={ym} onChange={(e) => go(e.target.value)} className="rounded border px-2 py-1">
          {Array.from(new Set([ym, data.currentYm, addMonths(data.currentYm, -1), ...data.months])).sort().reverse().map((m) => <option key={m} value={m}>{formatYm(m)}</option>)}
        </select>
        <button type="button" onClick={() => go(addMonths(ym, 1))} className="rounded border bg-white px-3 py-1">翌月 ›</button>
        <button type="button" onClick={() => go(data.currentYm)} className="rounded border bg-white px-3 py-1">今月</button>
        <span className="ml-auto text-slate-600">{data.store.name}（{data.store.code}）</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border bg-white px-4 py-3">
        <div><span className="text-xs text-slate-500">対象月</span><div className="text-lg font-bold">{formatYm(ym)}</div></div>
        <div><span className="text-xs text-slate-500">件数</span><div className="text-lg font-bold tabular-nums">{rows.length} 件</div></div>
        <div><span className="text-xs text-slate-500">速報合計</span><div className="text-lg font-bold tabular-nums text-brand-dark">{yen(total)}</div></div>
        {(data.isHq || verifiedCount > 0) && <div><span className="text-xs text-slate-500">経理確認済み</span><div className="text-lg font-bold tabular-nums">{verifiedCount} 件 / {yen(verifiedTotal)}</div></div>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {submitted ? (
            <>
              <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-800">提出済み {formatDateTime(data.month?.submittedAt)}（{data.month?.submittedBy}）</span>
              <button type="button" onClick={() => submitMonth('reopen')} className="rounded border bg-white px-3 py-1 text-sm">提出を取り消す</button>
            </>
          ) : rows.length === 0 && unsaved === 0 ? (
            <button type="button" onClick={() => submitMonth('submit_empty')} className="rounded border bg-white px-3 py-1 text-sm">0 件で提出（自賠請求なし）</button>
          ) : (
            <button type="button" onClick={() => submitMonth('submit')} disabled={unsaved > 0} className="rounded bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50" title={unsaved > 0 ? '先に「変更を保存」を押してください' : ''}>この月を提出する</button>
          )}
        </div>
      </div>

      {msg && <p className={`rounded px-3 py-2 text-sm ${msg.kind === 'ok' ? 'bg-brand-light' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

      {editable && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files).map((f) => ({ file: f, name: f.name }))); }}
          className={`rounded border-2 border-dashed px-4 py-4 text-sm ${dragOver ? 'border-brand bg-brand-light' : 'border-slate-300 bg-white'}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => fileInput.current?.click()} className="rounded bg-brand px-4 py-1.5 font-bold text-white">スクショを選ぶ</button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files ?? []).map((f) => ({ file: f, name: f.name }))); e.target.value = ''; }} />
            <span className="text-slate-600">レセコンの請求書画面（印刷前のプレビュー）を患者様 1 人につき 1 枚、ここにドラッグ＆ドロップするか、Win + Shift + S で撮ったスクショを <b>Ctrl + V</b> で貼り付けてください。複数枚まとめて可。</span>
          </div>
          {(progress || queueLeft > 0) && <p className="mt-2 text-brand-dark">⏳ {progress ?? '読み取り待ち…'}{queueLeft > 0 ? `（残り ${queueLeft} 枚）` : ''}</p>}
          <p className="mt-2 text-xs text-slate-500">読み取りはこのパソコンの中だけで行い、画像はどこにも送信・保存されません。読み取り後に金額と患者番号を目視で確認し、違っていれば直してから保存してください。</p>
        </div>
      )}
      {!editable && <p className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">提出済みのため編集できません。修正が必要なときは「提出を取り消す」を押してください。</p>}

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 text-left text-xs text-slate-600">
              <th className="px-2 py-1">#</th>
              <th className="px-2 py-1">患者番号</th>
              <th className="px-2 py-1">氏名</th>
              <th className="px-2 py-1 text-right">実日数</th>
              <th className="px-2 py-1 text-right">合計金額（円）</th>
              <th className="px-2 py-1">読み取り確認</th>
              {data.isHq && <th className="px-2 py-1">経理確認</th>}
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const dup = r.patientNo.trim() !== '' && dupNos.has(r.patientNo.trim());
              const verified = r.saved?.verifiedAmount ?? null;
              const lockAmount = !data.isHq && verified !== null;
              return (
                <tr key={r.key} className={`border-t align-top ${r.dirty || !r.id ? 'bg-yellow-50' : ''}`}>
                  <td className="px-2 py-1 text-xs text-slate-500">{i + 1}{(r.dirty || !r.id) && <span className="ml-1 rounded bg-yellow-200 px-1 text-[10px] text-yellow-900">未保存</span>}</td>
                  <td className="px-2 py-1"><input value={r.patientNo} disabled={!editable} onChange={(e) => update(r.key, { patientNo: e.target.value })} className={`${inputCls} w-28 font-mono ${dup ? 'border-amber-500' : ''}`} placeholder="003862a" />{dup && <div className="text-[11px] text-amber-700">同じ番号が複数あります</div>}</td>
                  <td className="px-2 py-1"><input value={r.patientName} disabled={!editable} onChange={(e) => update(r.key, { patientName: e.target.value })} className={`${inputCls} w-36`} placeholder="氏名" /></td>
                  <td className="px-2 py-1"><input value={r.days} disabled={!editable} onChange={(e) => update(r.key, { days: e.target.value })} inputMode="numeric" className={`${inputCls} w-14 text-right`} /></td>
                  <td className="px-2 py-1"><input value={r.amount} disabled={!editable || lockAmount} onChange={(e) => update(r.key, { amount: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" className={`${inputCls} w-28 text-right font-bold tabular-nums`} />{r.amount !== '' && <div className="text-right text-[11px] text-slate-500">{yen(Number(r.amount))}</div>}</td>
                  <td className="px-2 py-1 text-xs">
                    {r.ocr ? (
                      <div className="space-y-1">
                        {r.ocr.headerImage && <img src={r.ocr.headerImage} alt="患者番号・氏名の欄" className="max-h-10 rounded border" />}
                        {r.ocr.amountImage && <img src={r.ocr.amountImage} alt="合計の欄" className="max-h-8 rounded border" />}
                        {r.ocr.warnings.map((w, n) => <div key={n} className="text-amber-700">⚠ {w}</div>)}
                        <div className="text-slate-400">{r.ocr.fileName}（{(r.ocr.elapsedMs / 1000).toFixed(1)} 秒）</div>
                      </div>
                    ) : r.saved ? (
                      <span className="text-slate-500">{r.saved.source === 'OCR' ? '読み取り' : '手入力'}・{r.saved.createdBy} {formatDateTime(r.saved.createdAt)}</span>
                    ) : <span className="text-slate-500">手入力</span>}
                  </td>
                  {data.isHq && (
                    <td className="px-2 py-1">
                      {r.saved ? <VerifyCell row={r} onVerify={(v, note) => verify(r, v, note)} /> : <span className="text-xs text-slate-400">保存後に確認できます</span>}
                    </td>
                  )}
                  <td className="px-2 py-1 text-right">
                    {editable && !(lockAmount) && <button type="button" onClick={() => removeRow(r)} className="text-xs text-red-700 hover:underline">削除</button>}
                    {verified !== null && !data.isHq && <span className="block text-[11px] text-green-700">経理確認済み</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={data.isHq ? 8 : 7} className="px-2 py-6 text-center text-slate-500">まだ明細がありません。{editable ? 'スクショを追加するか、「手入力で追加」を押してください。' : ''}</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-slate-50 font-bold">
                <td className="px-2 py-1" colSpan={4}>合計（{rows.length} 件）</td>
                <td className="px-2 py-1 text-right tabular-nums">{yen(total)}</td>
                <td colSpan={data.isHq ? 3 : 2} className="px-2 py-1 text-xs font-normal text-slate-500">{data.isHq && verifiedCount > 0 ? `経理確認 ${verifiedCount} 件 / 確定 ${yen(verifiedTotal)}（速報との差 ${(verifiedTotal - rows.filter((x) => x.saved?.verifiedAmount !== null && x.saved?.verifiedAmount !== undefined).reduce((s, x) => s + (Number(x.amount) || 0), 0)).toLocaleString('ja-JP')}円）` : ''}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setRows((prev) => [...prev, { key: newKey(), id: null, patientNo: '', patientName: '', days: '', amount: '', source: 'MANUAL', dirty: true, saved: null, ocr: null }])} className="rounded border bg-white px-3 py-1.5 text-sm">＋ 手入力で追加</button>
          <button type="button" onClick={saveAll} disabled={saving || unsaved === 0} className="rounded bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">{saving ? '保存中…' : `変更を保存${unsaved > 0 ? `（${unsaved} 件）` : ''}`}</button>
          <span className="text-xs text-slate-500">保存してから「この月を提出する」を押すと本部の集計に反映されます。氏名は保存から約 {data.nameRetentionDays} 日後に自動で消え、金額は残ります。</span>
        </div>
      )}

      <div>
        <button type="button" onClick={() => setShowLogs((v) => !v)} className="text-xs text-slate-500 hover:underline">{showLogs ? '▼' : '▶'} 操作記録（{data.logs.length} 件）</button>
        {showLogs && (
          <ul className="mt-1 space-y-0.5 rounded border bg-white px-3 py-2 text-xs text-slate-600">
            {data.logs.map((l) => <li key={l.id}><span className="font-mono text-slate-400">{formatDateTime(l.createdAt)}</span> {l.byCode} {LOG_ACTION_JA[l.action] ?? l.action} {l.detail ?? ''}</li>)}
            {data.logs.length === 0 && <li>まだ操作はありません</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 本部の経理確認セル：確定金額・メモを入れて「確認」。速報と同額なら「同額で確認」1 クリック */
function VerifyCell({ row, onVerify }: { row: Row; onVerify: (verifiedAmount: number | null, note: string) => void }) {
  const saved = row.saved!;
  const [v, setV] = useState(saved.verifiedAmount === null ? row.amount : String(saved.verifiedAmount));
  const [note, setNote] = useState(saved.note);
  const diff = saved.verifiedAmount === null ? null : saved.verifiedAmount - saved.amount;
  return (
    <div className="space-y-1 text-xs">
      {saved.verifiedAmount !== null && (
        <div className="text-green-700">✓ 確定 {yen(saved.verifiedAmount)}{diff !== 0 && diff !== null && <span className="ml-1 text-amber-700">（差 {diff > 0 ? '+' : ''}{diff.toLocaleString('ja-JP')}円）</span>}<span className="ml-1 text-slate-400">{saved.verifiedBy} {formatDateTime(saved.verifiedAt)}</span></div>
      )}
      <div className="flex items-center gap-1">
        <input value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className="w-24 rounded border px-1 py-0.5 text-right tabular-nums" placeholder="確定金額" />
        <button type="button" onClick={() => v !== '' && onVerify(Number(v), note)} className="rounded bg-brand px-2 py-0.5 text-white">確認</button>
        {saved.verifiedAmount !== null && <button type="button" onClick={() => onVerify(null, note)} className="rounded border bg-white px-2 py-0.5">取消</button>}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== saved.note && onVerify(saved.verifiedAmount, note)} className="w-full rounded border px-1 py-0.5" placeholder="メモ（差額の理由など）" />
    </div>
  );
}
