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
  activeBeds: number[];          // 稼働ベッド番号（1..）
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

/** 空いているベッド番号の一覧（小さい番号順） */
export function freeBedsAt(input: AvailabilityInput, time: number): number[] {
  return input.activeBeds.filter((b) => bedFreeAt(input, time, b)).sort((a, b) => a - b);
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
      const remaining = freeBedsAt(input, t).length;
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
