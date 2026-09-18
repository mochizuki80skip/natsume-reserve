// 予約表 1 日分のデータ読込（管理画面・印刷で共用）
import type { GlobalSetting, Store } from '@prisma/client';
import { prisma } from './prisma';
import { allBeds, capacityFromShifts, storeSessions } from './settings';
import { slotTimes } from './hours';

export interface GridCell { time: number; bed: number; text: string; visited: boolean; web?: { id: string; kind: string; phone: string; cardNo: string | null } }
export interface CancelRow { id: string; time: number; bed: number; name: string; contText: string | null; kind: string; source: string; byCode: string; memo: string | null; createdAt: string }

export async function loadDay(store: Store, setting: GlobalSetting, date: string) {
  const [day, members, shifts, cells, cancels] = await Promise.all([
    prisma.dayStatus.findUnique({ where: { storeId_date: { storeId: store.id, date } } }),
    prisma.staffMember.findMany({ where: { storeId: store.id, active: true }, orderBy: { order: 'asc' } }),
    prisma.shift.findMany({ where: { storeId: store.id, date } }),
    prisma.cell.findMany({ where: { storeId: store.id, date, bed: { gt: 0 } }, include: { reservation: { select: { id: true, kind: true, phone: true, cardNo: true } } } }),
    prisma.cancelLog.findMany({ where: { storeId: store.id, date }, orderBy: [{ time: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  const fmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const sessions = storeSessions(store, setting, date, day?.closed);
  const statusByStaff = new Map(shifts.map((s) => [s.staffId, s.status]));
  const therapists = members.filter((m) => m.role === 'THERAPIST');
  const reception = members.filter((m) => m.role === 'RECEPTION');
  const cap = capacityFromShifts(store, therapists, statusByStaff, day);
  return {
    date,
    day: { published: day?.published ?? null, closed: day?.closed ?? false, memo: day?.memo ?? '', capacityAm: day?.capacityAm ?? null, capacityPm: day?.capacityPm ?? null },
    sessions,
    times: slotTimes(sessions, setting.slotMinutes, true),   // 管理側は 12:00 / 19:30 まで
    customerTimes: slotTimes(sessions, setting.slotMinutes), // 顧客が予約できる枠
    slotMinutes: setting.slotMinutes,
    beds: allBeds(store),
    capacity: cap,
    hasStaff: therapists.length > 0,
    receptionNames: reception.map((m) => m.name),
    shiftLabels: members.map((m) => ({ name: m.name, role: m.role, status: statusByStaff.get(m.id) ?? 'WORK' })),
    cells: cells.map<GridCell>((c) => ({
      time: c.time, bed: c.bed, text: c.text, visited: c.visited,
      web: c.reservation ? { id: c.reservation.id, kind: c.reservation.kind, phone: c.reservation.phone, cardNo: c.reservation.cardNo } : undefined,
    })),
    cancels: cancels.map<CancelRow>((c) => ({ id: c.id, time: c.time, bed: c.bed, name: c.name, contText: c.contText, kind: c.kind, source: c.source, byCode: c.byCode, memo: c.memo, createdAt: fmt.format(c.createdAt) })),
  };
}

export type DayData = Awaited<ReturnType<typeof loadDay>>;
