// 予約表 1 日分のデータ読込（管理画面・印刷で共用）
import type { GlobalSetting, Store } from '@prisma/client';
import { prisma } from './prisma';
import { storeSessions } from './settings';
import { slotTimes } from './hours';

export interface GridCell { time: number; bed: number; text: string; web?: { kind: string; phone: string; cardNo: string | null } }
export interface GridBed { bed: number; active: boolean; label: string }

export async function loadDay(store: Store, setting: GlobalSetting, date: string) {
  const [day, bedRows, cells] = await Promise.all([
    prisma.dayStatus.findUnique({ where: { storeId_date: { storeId: store.id, date } } }),
    prisma.bedStatus.findMany({ where: { storeId: store.id, date } }),
    prisma.cell.findMany({ where: { storeId: store.id, date }, include: { reservation: { select: { kind: true, phone: true, cardNo: true } } } }),
  ]);
  const sessions = storeSessions(store, setting, date, day?.closed);
  const bedMap = new Map(bedRows.map((r) => [r.bed, r]));
  const beds: GridBed[] = Array.from({ length: store.beds }, (_, i) => {
    const b = i + 1;
    const row = bedMap.get(b);
    return { bed: b, active: row ? row.active : b <= store.defaultActiveBeds, label: row?.label ?? '' };
  });
  return {
    date,
    day: { published: day?.published ?? null, closed: day?.closed ?? false, memo: day?.memo ?? '' },
    sessions,
    times: slotTimes(sessions, setting.slotMinutes),
    slotMinutes: setting.slotMinutes,
    beds,
    cells: cells.map<GridCell>((c) => ({
      time: c.time, bed: c.bed, text: c.text,
      web: c.reservation ? { kind: c.reservation.kind, phone: c.reservation.phone, cardNo: c.reservation.cardNo } : undefined,
    })),
  };
}

export type DayData = Awaited<ReturnType<typeof loadDay>>;
