// 予約表 1 日分のデータ読込（管理画面・印刷で共用）
import type { GlobalSetting, Store } from '@prisma/client';
import { prisma } from './prisma';
import { allBeds, capacityFromStaff, storeSessions } from './settings';
import { slotTimes } from './hours';

export interface GridCell { time: number; bed: number; text: string; web?: { kind: string; phone: string; cardNo: string | null } }

export async function loadDay(store: Store, setting: GlobalSetting, date: string) {
  const [day, staffRows, cells] = await Promise.all([
    prisma.dayStatus.findUnique({ where: { storeId_date: { storeId: store.id, date } } }),
    prisma.staffDay.findMany({ where: { storeId: store.id, date } }),
    prisma.cell.findMany({ where: { storeId: store.id, date, bed: { gt: 0 } }, include: { reservation: { select: { kind: true, phone: true, cardNo: true } } } }),
  ]);
  const sessions = storeSessions(store, setting, date, day?.closed);
  const nameAt = (role: string, slot: number) => staffRows.find((r) => r.role === role && r.slot === slot)?.name ?? '';
  const therapists = Array.from({ length: store.maxTherapists }, (_, i) => nameAt('THERAPIST', i + 1));
  const reception = Array.from({ length: store.maxReception }, (_, i) => nameAt('RECEPTION', i + 1));
  const therapistRows = staffRows.filter((r) => r.role === 'THERAPIST').map((r) => r.name);
  return {
    date,
    day: { published: day?.published ?? null, closed: day?.closed ?? false, memo: day?.memo ?? '' },
    sessions,
    times: slotTimes(sessions, setting.slotMinutes),
    slotMinutes: setting.slotMinutes,
    beds: allBeds(store),
    therapists,
    reception,
    capacity: capacityFromStaff(store, therapistRows),
    defaultCapacity: Math.min(store.defaultActiveBeds, store.beds),
    cells: cells.map<GridCell>((c) => ({
      time: c.time, bed: c.bed, text: c.text,
      web: c.reservation ? { kind: c.reservation.kind, phone: c.reservation.phone, cardNo: c.reservation.cardNo } : undefined,
    })),
  };
}

export type DayData = Awaited<ReturnType<typeof loadDay>>;
