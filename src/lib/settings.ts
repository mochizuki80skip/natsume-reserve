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
  return sessionsForDate(hoursForStore(store, setting), date, { closeOnHolidays: setting.closeOnHolidays, closed });
}

/** 物理ベッド番号の一覧 1..beds */
export function allBeds(store: Pick<Store, 'beds'>): number[] {
  return Array.from({ length: store.beds }, (_, i) => i + 1);
}

/** シフトの施術者名一覧から、顧客に見せる枠数を求める。シフト未入力の日は既定値 */
export function capacityFromStaff(store: Pick<Store, 'defaultActiveBeds' | 'beds'>, therapistNames: string[]): number {
  const entered = therapistNames.filter((n) => n.trim().length > 0).length;
  const cap = therapistNames.length === 0 ? store.defaultActiveBeds : entered;
  return Math.min(cap, store.beds);
}

/** 日付の顧客向け枠数（＝施術者数） */
export async function capacityFor(store: Pick<Store, 'id' | 'beds' | 'defaultActiveBeds'>, date: string): Promise<number> {
  const rows = await prisma.staffDay.findMany({ where: { storeId: store.id, date, role: 'THERAPIST' } });
  return capacityFromStaff(store, rows.map((r) => r.name));
}
