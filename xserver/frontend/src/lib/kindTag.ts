// 予約表の「新患・再来・新自・新三」ボタン：氏名の後ろの（初診）（再来）（新自）（新三）を付け外しする（純粋関数）
export type KindTag = '新患' | '再来' | '新自' | '新三';
export const KIND_TAGS: { tag: KindTag; suffix: string; cont: string; color: string }[] = [
  { tag: '新患', suffix: '（初診）', cont: '上記初診対応', color: '#fde0de' },
  { tag: '再来', suffix: '（再来）', cont: '上記再来対応', color: '#d9e7fb' },
  { tag: '新自', suffix: '（新自）', cont: '上記初診対応', color: '#fde9c4' },
  // 新三＝新・第三者行為（交通事故以外で、ほかの人によるケガ）。色は新自と同じ
  { tag: '新三', suffix: '（新三）', cont: '上記初診対応', color: '#fde9c4' },
];

// 末尾の括弧書き（WEB予約の（初診）（初自）（再）や手入力の (初) なども含む）
const TAIL = /\s*[（(](初診|初|初自|新自|新三|再|再来)[）)]\s*$/;
const TAG_OF: Record<string, KindTag> = { 初診: '新患', 初: '新患', 初自: '新自', 新自: '新自', 新三: '新三', 再: '再来', 再来: '再来' };

/** セルの末尾に付いている区分（無ければ null） */
export function kindTagOf(text: string): KindTag | null {
  const m = TAIL.exec(text);
  return m ? TAG_OF[m[1]] : null;
}

/** ボタンを押したあとのセルの文字と、下のセルに入れる 2 枠目の文字（外したときは null） */
export function applyKindTag(text: string, tag: KindTag): { text: string; cont: string | null } {
  const base = text.replace(TAIL, '').trimEnd();
  if (kindTagOf(text) === tag) return { text: base, cont: null };
  const t = KIND_TAGS.find((x) => x.tag === tag)!;
  return { text: `${base}${t.suffix}`, cont: t.cont };
}
