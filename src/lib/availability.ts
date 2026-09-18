// 空き状況の判定（純粋関数。DB に依存しない）
import type { ResolvedSession } from './hours';

export type SlotStatus = 'open' | 'phone' | 'closed';

export interface SlotAvailability {
  time: number;
  status: SlotStatus;
  remaining: number; // 空きベッド数（内部用。顧客 API には status のみ返す）
}

export interface AvailabilityInput {
  sessions: ResolvedSession[];
  slotMinutes: number;
  beds: number[];                // 物理ベッド番号（1..beds）。管理側はどのベッドにも入力できる
  capacity: number;              // 顧客に見せる枠数（＝その日の施術者数）
  occupied: Set<string>;         // "time:bed" が埋まっている
  neededSlots: number;           // 必要な連続枠数（初回 2 / 通院中 1）
  phoneMarkRemaining: number;    // 残りがこの数以下なら電話マーク
  /** 今日なら現在時刻（分）。未来日は null。過去日は Infinity を渡す */
  nowMinutes: number | null;
  webCutoffMinutes: number;
  phoneCutoffMinutes: number;
}

export const cellKey = (time: number, bed: number) => `${time}:${bed}`;

/** そのベッドが time から neededSlots 枠連続で空いているか */
export function bedFreeAt(
  input: Pick<AvailabilityInput, 'sessions' | 'slotMinutes' | 'occupied' | 'neededSlots'>,
  time: number,
  bed: number,
): boolean {
  const session = input.sessions.find((s) => time >= s.start && time <= s.lastStart);
  if (!session) return false;
  for (let k = 0; k < input.neededSlots; k++) {
    const t = time + k * input.slotMinutes;
    if (t > session.lastStart) return false; // 次の枠が営業時間外
    if (input.occupied.has(cellKey(t, bed))) return false;
  }
  return true;
}

/** 必要枠数ぶん連続で空いている物理ベッド番号の一覧（小さい番号順） */
export function freeBedsAt(input: AvailabilityInput, time: number): number[] {
  return input.beds.filter((b) => bedFreeAt(input, time, b)).sort((a, b) => a - b);
}

/** 指定時刻に埋まっているベッド数 */
export function occupiedCountAt(input: Pick<AvailabilityInput, 'beds' | 'occupied'>, time: number): number {
  return input.beds.filter((b) => input.occupied.has(cellKey(time, b))).length;
}

/**
 * 顧客に見せる残り枠数。
 * 「施術者数 − その時刻に埋まっているベッド数」を必要枠すべてで満たし、かつ
 * 連続で空いている物理ベッドが存在する数。管理側が施術者数を超えて入力していれば 0 になる。
 */
export function remainingAt(input: AvailabilityInput, time: number): number {
  const free = freeBedsAt(input, time).length;
  if (free === 0) return 0;
  let byCapacity = Infinity;
  for (let k = 0; k < input.neededSlots; k++) {
    byCapacity = Math.min(byCapacity, input.capacity - occupiedCountAt(input, time + k * input.slotMinutes));
  }
  return Math.max(0, Math.min(free, byCapacity));
}

export function statusFor(input: AvailabilityInput, time: number, remaining: number): SlotStatus {
  if (input.nowMinutes !== null) {
    const lead = time - input.nowMinutes;
    if (lead < input.phoneCutoffMinutes) return 'closed';
    if (remaining <= 0) return 'closed';
    if (lead < input.webCutoffMinutes) return 'phone';
  }
  if (remaining <= 0) return 'closed';
  if (remaining <= input.phoneMarkRemaining) return 'phone';
  return 'open';
}

export function computeAvailability(input: AvailabilityInput): SlotAvailability[] {
  const out: SlotAvailability[] = [];
  for (const s of input.sessions) {
    for (let t = s.start; t <= s.lastStart; t += input.slotMinutes) {
      const remaining = remainingAt(input, t);
      out.push({ time: t, status: statusFor(input, t, remaining), remaining });
    }
  }
  return out;
}

/** 予約表の氏名セルとして数えるか（「〃」「✖」などは数えない） */
const NOT_A_PATIENT = new Set(['〃', '"', '✖', '×', 'X', 'x', '-', 'ー', '－', '休', '休み']);
export function isPatientText(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  return t.length > 0 && !NOT_A_PATIENT.has(t);
}

/** セルとして「埋まっている」とみなすか（空文字以外はすべて埋まり扱い） */
export function isOccupiedText(text: string | null | undefined): boolean {
  return (text ?? '').trim().length > 0;
}
