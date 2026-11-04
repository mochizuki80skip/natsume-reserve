// スプレッドシートのファイル（Excel .xlsx・CSV）を選ぶ → 表のあるシート（月のシート「2027.1」など）を選ぶ。
// ファイルはこのパソコンの中だけで読む（どこにも送らない）
import { useRef, useState } from 'react';
import { findSection, readSheetFile, type Section, type SectionKind, type Sheet } from '@/lib/sheetFile';

const LABEL: Record<SectionKind, string> = { karte: '新患継続率', churn: '離反', mado: '月間窓口表', henrei: '返戻' };

export default function SheetFilePicker({ kind, onPick }: { kind: SectionKind; onPick: (sheet: Sheet, sec: Section) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<{ sheet: Sheet; sec: Section }[] | null>(null);
  const [picked, setPicked] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function onFile(f: File) {
    setErr(''); setFound(null); setPicked(''); setBusy(true);
    try {
      const sheets = await readSheetFile(f);
      const list = sheets.map((sheet) => ({ sheet, sec: findSection(sheet.grid, kind) })).filter((x): x is { sheet: Sheet; sec: Section } => !!x.sec);
      if (!list.length) { setErr(`このファイルには「${LABEL[kind]}」の表が見つかりませんでした（見出しの行で見分けています。見出しの文字を変えていないか確かめてください）`); return; }
      setFound(list);
      if (list.length === 1) { setPicked(list[0].sheet.name); onPick(list[0].sheet, list[0].sec); }
    } catch (e) { setErr((e as Error).message || 'ファイルを読めませんでした'); } finally { setBusy(false); }
  }
  return (
    <div className="rounded border border-dashed border-brand/60 bg-brand-light/30 px-3 py-2 text-sm" role="group" aria-label="ファイルから取り込む">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="rounded border-2 border-brand bg-white px-3 py-1 font-bold text-brand-dark disabled:opacity-50">📂 {busy ? '読んでいます…' : 'Excel・CSV のファイルから'}</button>
        <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" aria-label="スプレッドシートのファイル" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        <span className="text-xs text-slate-600">スプレッドシートを Excel（.xlsx）か CSV で保存したファイルを選びます。ファイルはこのパソコンの中だけで読みます。</span>
      </div>
      {found && found.length > 1 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5" role="group" aria-label="シートを選ぶ">
          <span className="text-xs font-bold">シートを選ぶ：</span>
          {found.map((x) => (
            <button key={x.sheet.name} type="button" aria-pressed={picked === x.sheet.name} onClick={() => { setPicked(x.sheet.name); onPick(x.sheet, x.sec); }}
              className={`rounded border-2 border-brand px-2 py-0.5 text-xs font-bold ${picked === x.sheet.name ? 'bg-brand text-white' : 'bg-white text-brand-dark'}`}>{x.sheet.name}</button>
          ))}
        </div>
      )}
      {picked && <p className="mt-1 text-xs text-slate-600">シート「{picked}」の{LABEL[kind]}を読みました。下の内容を確かめてください。</p>}
      {err && <p className="mt-1 text-xs text-red-700" role="alert">{err}</p>}
    </div>
  );
}
