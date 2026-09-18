import type { GlobalSetting, Store } from '@prisma/client';
import { prisma } from './prisma';
import { DEFAULT_HOURS, parseHoursConfig, sessionsForDate, type HoursConfig, type ResolvedSession } from './hours';

/** 全店共通設定（無ければ既定値で作成） */
export async function getGlobalSetting(): Promise<GlobalSetting> {
  const s = await prisma.globalSetting.findUnique({ where: { id: 1 } });
  if (s) return s;
  return prisma.globalSetting.create({ data: { id: 1, hours: DEFAULT_HOURS as object } });
}

/** 店舗に適用する営業時間設定（個別設定があればそちら） */
export function hoursForStore(store: Pick<Store, 'hoursOverride'>, setting: GlobalSetting): HoursConfig {
  return (
    parseHoursConfig(store.hoursOverride) ??
    parseHoursConfig(setting.hours) ??
    DEFAULT_HOURS
  );
}

export function storeSessions(
  store: Pick<Store, 'hoursOverride'>,
  setting: GlobalSetting,
  date: string,
  closed = false,
): ResolvedSession[] {
  return sessionsForDate(hoursForStore(store, setting), date, {
    closeOnHolidays: setting.closeOnHolidays, closed,
    adminExtraSlots: setting.adminExtraSlots, slotMinutes: setting.slotMinutes,
  });
}

/** 物理ベッド番号の一覧 1..beds */
export function allBeds(store: Pick<Store, 'beds'>): number[] {
  return Array.from({ length: store.beds }, (_, i) => i + 1);
}

/** シフトの区分 */
export const SHIFT_STATUSES = ['WORK', 'OFF', 'AM_OFF', 'PM_OFF', 'PAID', 'AM_PAID', 'PM_PAID'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];
export const SHIFT_LABEL: Record<ShiftStatus, string> = {
  WORK: '〇', OFF: '休', AM_OFF: '前休', PM_OFF: '後休', PAID: '有給', AM_PAID: '前有', PM_PAID: '後有',
};
export function worksAm(status: string | undefined): boolean {
  return !status || status === 'WORK' || status === 'PM_OFF' || status === 'PM_PAID';
}
export function worksPm(status: string | undefined): boolean {
  return !status || status === 'WORK' || status === 'AM_OFF' || status === 'AM_PAID';
}

export interface DayCapacity {
  am: number; pm: number;            // 顧客に見せる枠数（手動調整があればそれ）
  autoAm: number; autoPm: number;    // シフトからの自動計算値
  namesAm: string[]; namesPm: string[];
}

/**
 * シフトから午前/午後の施術者数を求める。
 * members: 稼働中の施術者、statusByStaff: その日のシフト（行が無い人は〇）。
 * 施術者が 1 人も登録されていない店舗は既定値（defaultActiveBeds）。
 */
export function capacityFromShifts(
  store: Pick<Store, 'defaultActiveBeds' | 'beds'>,
  members: { id: string; name: string }[],
  statusByStaff: Map<string, string>,
  override?: { capacityAm?: number | null; capacityPm?: number | null } | null,
): DayCapacity {
  let namesAm: string[] = [], namesPm: string[] = [];
  let autoAm: number, autoPm: number;
  if (members.length === 0) {
    autoAm = autoPm = Math.min(store.defaultActiveBeds, store.beds);
  } else {
    namesAm = members.filter((m) => worksAm(statusByStaff.get(m.id))).map((m) => m.name);
    namesPm = members.filter((m) => worksPm(statusByStaff.get(m.id))).map((m) => m.name);
    autoAm = Math.min(namesAm.length, store.beds);
    autoPm = Math.min(namesPm.length, store.beds);
  }
  const am = override?.capacityAm ?? autoAm;
  const pm = override?.capacityPm ?? autoPm;
  return { am: Math.min(am, store.beds), pm: Math.min(pm, store.beds), autoAm, autoPm, namesAm, namesPm };
}

/** 複数日分の枠数をまとめて計算（週間・月間表示用） */
export async function capacitiesFor(
  store: Pick<Store, 'id' | 'beds' | 'defaultActiveBeds'>,
  dates: string[],
  overrides: Map<string, { capacityAm: number | null; capacityPm: number | null }>,
): Promise<Map<string, DayCapacity>> {
  const members = await prisma.staffMember.findMany({ where: { storeId: store.id, role: 'THERAPIST', active: true }, orderBy: { order: 'asc' } });
  const shifts = members.length
    ? await prisma.shift.findMany({ where: { storeId: store.id, date: { in: dates } } })
    : [];
  const byDate = new Map<string, Map<string, string>>();
  for (const sh of shifts) (byDate.get(sh.date) ?? byDate.set(sh.date, new Map()).get(sh.date)!).set(sh.staffId, sh.status);
  const out = new Map<string, DayCapacity>();
  for (const d of dates) out.set(d, capacityFromShifts(store, members, byDate.get(d) ?? new Map(), overrides.get(d)));
  return out;
}

export async function capacityFor(store: Pick<Store, 'id' | 'beds' | 'defaultActiveBeds'>, date: string): Promise<DayCapacity> {
  const day = await prisma.dayStatus.findUnique({ where: { storeId_date: { storeId: store.id, date } } });
  const m = new Map<string, { capacityAm: number | null; capacityPm: number | null }>();
  if (day) m.set(date, { capacityAm: day.capacityAm, capacityPm: day.capacityPm });
  return (await capacitiesFor(store, [date], m)).get(date)!;
}
