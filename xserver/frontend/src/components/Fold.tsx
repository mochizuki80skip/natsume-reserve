// 本部管理の各項目を折りたたむ枠。見出し（h2）か右上のボタンで開け閉めする。開け閉めはこの端末に覚えておく
import { useEffect, useState, type ReactNode } from 'react';

const KEY = 'hqFold:';
const read = (id: string, def: boolean) => { try { const v = localStorage.getItem(KEY + id); return v === null ? def : v === '1'; } catch { return def; } };

const save = (id: string, open: boolean) => { try { localStorage.setItem(KEY + id, open ? '1' : '0'); } catch { /* 覚えられなくても動く */ } };

/** すべての項目をまとめて開く・閉じる */
export function setAllFolds(open: boolean) { window.dispatchEvent(new CustomEvent('hqfold', { detail: open })); }

export function FoldAllButtons() {
  return (
    <div className="flex gap-2 text-xs" role="group" aria-label="項目の開け閉め">
      <button type="button" onClick={() => setAllFolds(false)} className="rounded border bg-white px-2 py-0.5">すべて閉じる</button>
      <button type="button" onClick={() => setAllFolds(true)} className="rounded border bg-white px-2 py-0.5">すべて開く</button>
    </div>
  );
}

export default function Fold({ id, title, defaultOpen = true, children }: { id: string; title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => read(id, defaultOpen));
  const toggle = () => setOpen((o) => { save(id, !o); return !o; });
  useEffect(() => {
    const on = (e: Event) => { const v = (e as CustomEvent<boolean>).detail; save(id, v); setOpen(v); };
    window.addEventListener('hqfold', on);
    return () => window.removeEventListener('hqfold', on);
  }, [id]);
  return (
    <div className="fold relative" data-closed={open ? undefined : ''} data-fold={id}
      onClick={(e) => { if ((e.target as HTMLElement).closest('h2') && (e.currentTarget as HTMLElement).contains(e.target as Node)) toggle(); }}>
      <button type="button" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-expanded={open} aria-label={`${title}を${open ? '閉じる' : '開く'}`}
        className="absolute right-3 top-3 z-10 rounded border bg-white px-2 py-0.5 text-xs font-bold text-brand-dark shadow-sm hover:bg-brand-light">{open ? '▲ 閉じる' : '▼ 開く'}</button>
      {children}
    </div>
  );
}
