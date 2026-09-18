// 顧客向けの空き状況計算（氏名などの個人情報は一切返さない）
import type { GlobalSetting, Store } from '@prisma/client';
import { prisma } from './prisma';
import { allBeds, capacitiesFor, capacityFor, storeSessions, type DayCapacity } from './settings';
import { cellKey, computeAvailability, isOccupiedText, type AvailabilityInput, type SlotStatus } from './availability';
import { addDays, datesOfMonth, nowJst } from './time';
import { isAm, isJpHoliday } from './hours';

export type Kind = 'NEW' | 'REVISIT' | 'RETURN'; // 初診 / 再来（1ヶ月以上）/ 通院中

export type DayMark = 'open' | 'full' | 'closed' | 'unpublished';

export function neededSlots(setting: GlobalSetting, kind: Kind): number {
  return kind === 'RETURN' ? setting.returnVisitSlots : setting.newVisitSlots; // 再来は初診と同じ枠数
}

/** 日付を顧客に公開するか（DayStatus と店舗の既定公開日数から判定） */
export function isPublished(store: Pick<Store, 'publishDaysAhead'>, date: string, today: string, published: boolean | null | undefined): boolean {
  if (published === true) return true;
  if (published === false) return false;
  return date >= today && date <= addDays(today, store.publishDaysAhead);
}

function nowMinutesFor(date: string, today: string, minutes: number): number | null {
  if (date < today) return Infinity;
  if (date === today) return minutes;
  return null;
}

export async function buildInput(
  store: Store,
  setting: GlobalSetting,
  date: string,
  kind: Kind,
  opts: { closed?: boolean; cells?: { time: number; bed: number; text: string }[]; capacity?: DayCapacity } = {},
): Promise<AvailabilityInput> {
  const { date: today, minutes } = nowJst();
  const sessions = storeSessions(store, setting, date, opts.closed);
  const cells = opts.cells ?? (await prisma.cell.findMany({ where: { storeId: store.id, date, bed: { gt: 0 } } }));
  const occupied = new Set<string>();
  for (const c of cells) if (c.bed > 0 && isOccupiedText(c.text)) occupied.add(cellKey(c.time, c.bed));
  return {
    sessions,
    slotMinutes: setting.slotMinutes,
    beds: allBeds(store),
    capacityAm: (opts.capacity ?? (await capacityFor(store, date))).am,
    capacityPm: (opts.capacity ?? (await capacityFor(store, date))).pm,
    occupied,
    neededSlots: neededSlots(setting, kind),
    phoneMarkRemaining: setting.phoneMarkRemaining,
    nowMinutes: nowMinutesFor(date, today, minutes),
    webCutoffMinutes: setting.webCutoffMinutes,
    phoneCutoffMinutes: setting.phoneCutoffMinutes,
  };
}

/** 1 日分の枠ごとの状態（〇 / 電話 / ×） */
export async function slotsForCustomer(store: Store, setting: GlobalSetting, date: string, kind: Kind) {
  const { date: today } = nowJst();
  const day = await prisma.dayStatus.findUnique({ where: { storeId_date: { storeId: store.id, date } } });
  if (!isPublished(store, date, today, day?.published)) return { published: false as const, slots: [] };
  const input = await buildInput(store, setting, date, kind, { closed: day?.closed });
  return {
    published: true as const,
    slots: computeAvailability(input).map((s) => ({
      time: s.time,
      status: s.status as SlotStatus,
      period: isAm(input.sessions, s.time) ? 'AM' : 'PM',
    })),
  };
}

/** 月ごとの日付一覧と日単位のマーク（〇=空きあり / ×=満枠 / 休 / 非公開） */
export async function calendarForCustomer(store: Store, setting: GlobalSetting, ym: string, kind: Kind) {
  const { date: today } = nowJst();
  const dates = datesOfMonth(ym);
  const [days, cells] = await Promise.all([
    prisma.dayStatus.findMany({ where: { storeId: store.id, date: { in: dates } } }),
    prisma.cell.findMany({ where: { storeId: store.id, date: { in: dates }, bed: { gt: 0 } }, select: { date: true, time: true, bed: true, text: true } }),
  ]);
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const cellsByDate = new Map<string, typeof cells>();
  for (const c of cells) (cellsByDate.get(c.date) ?? cellsByDate.set(c.date, []).get(c.date)!).push(c);
  const caps = await capacitiesFor(store, dates, new Map(days.map((d) => [d.date, { capacityAm: d.capacityAm, capacityPm: d.capacityPm }])));

  const result: { date: string; mark: DayMark }[] = [];
  for (const date of dates) {
    const day = dayMap.get(date);
    if (!isPublished(store, date, today, day?.published)) { result.push({ date, mark: 'unpublished' }); continue; }
    const input = await buildInput(store, setting, date, kind, { closed: day?.closed, cells: cellsByDate.get(date) ?? [], capacity: caps.get(date)! });
    if (input.sessions.length === 0) { result.push({ date, mark: 'closed' }); continue; }
    const slots = computeAvailability(input);
    const any = slots.some((s) => s.status !== 'closed');
    result.push({ date, mark: any ? 'open' : 'full' });
  }
  return result;
}

export type DayLabel = '定休日' | '祝日' | '休診' | '受付終了' | '受付期間外' | null;

/** 1 週間分（weekStart から 7 日）の枠状態。氏名は含まない */
export async function weekForCustomer(store: Store, setting: GlobalSetting, weekStart: string, kind: Kind) {
  const { date: today } = nowJst();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [days, cells] = await Promise.all([
    prisma.dayStatus.findMany({ where: { storeId: store.id, date: { in: dates } } }),
    prisma.cell.findMany({ where: { storeId: store.id, date: { in: dates }, bed: { gt: 0 } }, select: { date: true, time: true, bed: true, text: true } }),
  ]);
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const cellsByDate = new Map<string, typeof cells>();
  for (const c of cells) (cellsByDate.get(c.date) ?? cellsByDate.set(c.date, []).get(c.date)!).push(c);
  const caps = await capacitiesFor(store, dates, new Map(days.map((d) => [d.date, { capacityAm: d.capacityAm, capacityPm: d.capacityPm }])));

  const out: { date: string; label: DayLabel; slots: { time: number; status: SlotStatus }[] }[] = [];
  for (const date of dates) {
    const day = dayMap.get(date);
    const sessions = storeSessions(store, setting, date, day?.closed);
    let label: DayLabel = null;
    if (sessions.length === 0) label = day?.closed ? '休診' : setting.closeOnHolidays && isJpHoliday(date) ? '祝日' : '定休日';
    else if (date < today) label = '受付終了';
    else if (!isPublished(store, date, today, day?.published)) label = '受付期間外';
    if (label) { out.push({ date, label, slots: [] }); continue; }
    const input = await buildInput(store, setting, date, kind, { closed: day?.closed, cells: cellsByDate.get(date) ?? [], capacity: caps.get(date)! });
    out.push({ date, label: null, slots: computeAvailability(input).map((s) => ({ time: s.time, status: s.status })) });
  }
  return { today, weekStart, publishDaysAhead: store.publishDaysAhead, days: out };
}
