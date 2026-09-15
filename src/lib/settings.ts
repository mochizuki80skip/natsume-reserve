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

/** 日付の稼働ベッド番号（BedStatus が無ければ既定台数） */
export async function activeBedsFor(store: Pick<Store, 'id' | 'beds' | 'defaultActiveBeds'>, date: string): Promise<number[]> {
  const rows = await prisma.bedStatus.findMany({ where: { storeId: store.id, date } });
  if (rows.length === 0) {
    return Array.from({ length: Math.min(store.defaultActiveBeds, store.beds) }, (_, i) => i + 1);
  }
  const map = new Map(rows.map((r) => [r.bed, r.active]));
  const out: number[] = [];
  for (let b = 1; b <= store.beds; b++) {
    // 行が無いベッドは既定台数の範囲内なら稼働扱い
    const active = map.has(b) ? map.get(b)! : b <= store.defaultActiveBeds;
    if (active) out.push(b);
  }
  return out;
}
