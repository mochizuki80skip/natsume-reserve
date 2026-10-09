// 差し込み語の入力欄（店舗ごとの値）。下書きページと差し込み語ページで共用する
import type { VarDef } from './sns';

export interface StoreVars { code: string; name: string; area: string; keywordsFixed: string; keywordsRotation: string; vars: Record<string, string>; igEnabled: boolean; gbpEnabled: boolean; unfilled?: number }

/** 投稿文に残った {…} → 入力欄。null は「この画面では入れられない（SNS設定で入れる／Google では使えない）」 */
export type VarField = { kind: 'name' | 'area' | 'keywordsFixed' } | { kind: 'var'; key: string };

export function fieldFor(token: string, customVars: VarDef[]): VarField | null {
  const k = token.replace(/^\{|\}$/g, '');
  if (k === '店舗名') return { kind: 'name' };
  if (k === 'エリア' || k === '地域') return { kind: 'area' };
  if (k === 'キーワード') return { kind: 'keywordsFixed' };
  if (customVars.some((cv) => cv.key === k)) return { kind: 'var', key: k };
  return null;
}

export function fieldId(f: VarField): string { return f.kind === 'var' ? `var:${f.key}` : f.kind; }

export function fieldLabel(f: VarField, customVars: VarDef[]): string {
  if (f.kind === 'var') {
    const key = f.key;
    const cv = customVars.find((c) => c.key === key);
    return `${cv?.label ?? key} {${key}}`;
  }
  if (f.kind === 'name') return '店舗名 {店舗名}';
  if (f.kind === 'area') return 'エリア {エリア}';
  return '毎回入れるキーワード {キーワード}';
}

export function getValue(s: StoreVars, f: VarField): string {
  if (f.kind === 'var') return s.vars[f.key] ?? '';
  return s[f.kind];
}

export function setValue(s: StoreVars, f: VarField, v: string): StoreVars {
  if (f.kind === 'var') return { ...s, vars: { ...s.vars, [f.key]: v } };
  return { ...s, [f.kind]: v };
}

/** 保存用に 1 店舗分の行を作る */
export function toRow(s: StoreVars) {
  return { code: s.code, name: s.name, area: s.area, keywordsFixed: s.keywordsFixed, keywordsRotation: s.keywordsRotation, vars: s.vars };
}

/** Google では使えない差し込み語（GBP に載っている情報） */
export const GBP_FORBIDDEN = ['{電話}', '{住所}', '{営業時間}', '{予約URL}', '{ハッシュタグ}'];
