import { describe, expect, it } from 'vitest';
import { computeAvailability, freeBedsAt, remainingAt, isPatientText, type AvailabilityInput } from './availability';
import { DEFAULT_HOURS, isAm, sessionsForDate, slotTimes } from './hours';
import { nowJst, formatDateJa } from './time';

const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  sessions: [{ start: 540, lastStart: 705, lastAdmin: 720 }, { start: 900, lastStart: 1155, lastAdmin: 1170 }],
  slotMinutes: 15,
  beds: [1, 2, 3, 4, 5, 6, 7, 8],
  capacityAm: 3,
  capacityPm: 3,
  occupied: new Set(),
  neededSlots: 1,
  phoneMarkRemaining: 1,
  nowMinutes: null,
  webCutoffMinutes: 30,
  phoneCutoffMinutes: 15,
  ...over,
});

describe('hours', () => {
  it('平日は 9:00-11:45 / 15:00-19:15、土曜は午後 14:00-18:15', () => {
    const wed = sessionsForDate(DEFAULT_HOURS, '2026-10-21', { closeOnHolidays: true });
    expect(wed).toEqual([{ start: 540, lastStart: 705, lastAdmin: 705 }, { start: 900, lastStart: 1155, lastAdmin: 1155 }]);
    const sat = sessionsForDate(DEFAULT_HOURS, '2026-10-24', { closeOnHolidays: true });
    expect(sat[1]).toEqual({ start: 840, lastStart: 1095, lastAdmin: 1095 });
    expect(slotTimes(wed, 15)).toHaveLength(12 + 18);
    // 管理側は 12:00 / 19:30 まで表示
    const adm = sessionsForDate(DEFAULT_HOURS, '2026-10-21', { closeOnHolidays: true, adminExtraSlots: 1, slotMinutes: 15 });
    expect(adm.map((x) => x.lastAdmin)).toEqual([720, 1170]);
    expect(slotTimes(adm, 15, true)).toHaveLength(13 + 19);
    expect(slotTimes(adm, 15)).toHaveLength(12 + 18);
  });
  it('木・日・祝日は休診', () => {
    expect(sessionsForDate(DEFAULT_HOURS, '2026-10-22', { closeOnHolidays: true })).toEqual([]); // 木
    expect(sessionsForDate(DEFAULT_HOURS, '2026-10-25', { closeOnHolidays: true })).toEqual([]); // 日
    expect(sessionsForDate(DEFAULT_HOURS, '2026-11-03', { closeOnHolidays: true })).toEqual([]); // 文化の日(火)
    expect(sessionsForDate(DEFAULT_HOURS, '2026-11-03', { closeOnHolidays: false })).toHaveLength(2);
    expect(sessionsForDate(DEFAULT_HOURS, '2026-10-21', { closeOnHolidays: true, closed: true })).toEqual([]);
  });
});

describe('availability', () => {
  it('通院中は 1 枠空いていれば〇、残り 1 台で電話、0 で×', () => {
    const occ = new Set(['540:1', '540:2', '555:1', '555:2', '555:3']);
    const r = computeAvailability(base({ occupied: occ }));
    expect(r.find((s) => s.time === 540)).toMatchObject({ status: 'phone', remaining: 1 });
    expect(r.find((s) => s.time === 555)).toMatchObject({ status: 'closed', remaining: 0 });
    expect(r.find((s) => s.time === 570)).toMatchObject({ status: 'open', remaining: 3 });
  });
  it('初回は同じベッドで 2 枠連続が必要。午前最終枠は取れない', () => {
    // ベッド1: 9:15 埋まり → 9:00 からの 2 枠はベッド 2〜8 で可能。ただし施術者 3 人なので 9:15 の残りは 2
    const occ = new Set(['555:1']);
    const r = computeAvailability(base({ occupied: occ, neededSlots: 2 }));
    expect(freeBedsAt(base({ occupied: occ, neededSlots: 2 }), 540)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(r.find((s) => s.time === 540)).toMatchObject({ status: 'open', remaining: 2 });
    expect(r.find((s) => s.time === 705)).toMatchObject({ status: 'open', remaining: 3 });   // 11:45 は管理側の 12:00 枠を 2 枠目に使える
    expect(r.find((s) => s.time === 690)).toMatchObject({ status: 'open', remaining: 3 });   // 11:30 は 11:45 と連続
    const noExtra = computeAvailability(base({ occupied: occ, neededSlots: 2, sessions: [{ start: 540, lastStart: 705, lastAdmin: 705 }] }));
    expect(noExtra.find((s) => s.time === 705)).toMatchObject({ status: 'closed', remaining: 0 }); // 追加枠が無ければ不可
  });
  it('午前と午後で施術者数が違う（前休＝午前 1 人減）', () => {
    const r = computeAvailability(base({ capacityAm: 1, capacityPm: 3 }));
    expect(r.find((s) => s.time === 540)).toMatchObject({ status: 'phone', remaining: 1 });
    expect(r.find((s) => s.time === 900)).toMatchObject({ status: 'open', remaining: 3 });
  });
  it('当日は 30 分前まで WEB、15 分前までは電話、それ以降は×', () => {
    const r = computeAvailability(base({ nowMinutes: 600 })); // 10:00
    expect(r.find((s) => s.time === 600)!.status).toBe('closed');  // 0 分前
    expect(r.find((s) => s.time === 615)!.status).toBe('phone');   // 15 分前
    expect(r.find((s) => s.time === 630)!.status).toBe('open');    // 30 分前
    expect(r.find((s) => s.time === 585)!.status).toBe('closed');  // 過去
  });
  it('過去日はすべて×', () => {
    const r = computeAvailability(base({ nowMinutes: Infinity }));
    expect(r.every((s) => s.status === 'closed')).toBe(true);
  });
  it('施術者が 0 人（枠数 0）なら×', () => {
    const r = computeAvailability(base({ capacityAm: 0, capacityPm: 0 }));
    expect(r.every((s) => s.status === 'closed')).toBe(true);
  });
  it('管理側が施術者数を超えて入力した時刻は、物理ベッドが空いていても残り 0', () => {
    // 施術者 3 人、9:00 にベッド 4,5,6 に入力（8 床のうち 3 床埋まり）
    const occ = new Set(['540:4', '540:5', '540:6']);
    expect(remainingAt(base({ occupied: occ }), 540)).toBe(0);
    // 9:15 は 2 床だけ埋まり → 残り 1 → 電話マーク
    const occ2 = new Set(['555:7', '555:8']);
    expect(computeAvailability(base({ occupied: occ2 })).find((s) => s.time === 555)).toMatchObject({ status: 'phone', remaining: 1 });
  });
  it('初回は 2 枠とも施術者数の範囲内で空いている必要がある', () => {
    // 9:15 が施術者数いっぱい → 9:00 の初回は不可、9:00 の通院中は可
    const occ = new Set(['555:1', '555:2', '555:3']);
    expect(remainingAt(base({ occupied: occ, neededSlots: 2 }), 540)).toBe(0);
    expect(remainingAt(base({ occupied: occ, neededSlots: 1 }), 540)).toBe(3);
  });
});

describe('helpers', () => {
  it('12:00 の追加枠は午前扱い、14:00 は午後', () => {
    const sess = [{ start: 540, lastStart: 705, lastAdmin: 720 }, { start: 840, lastStart: 1095, lastAdmin: 1110 }];
    expect(isAm(sess, 720)).toBe(true);
    expect(isAm(sess, 840)).toBe(false);
    expect(isAm(sess, 1110)).toBe(false);
  });
  it('氏名セルの判定', () => {
    expect(isPatientText('山田')).toBe(true);
    expect(isPatientText('〃')).toBe(false);
    expect(isPatientText('上記初診対応')).toBe(false);
    expect(isPatientText('✖')).toBe(false);
    expect(isPatientText('  ')).toBe(false);
  });
  it('日本時間と日付表示', () => {
    expect(nowJst(new Date('2026-10-21T00:30:00Z'))).toEqual({ date: '2026-10-21', minutes: 570 });
    expect(nowJst(new Date('2026-10-21T15:30:00Z'))).toEqual({ date: '2026-10-22', minutes: 30 });
    expect(formatDateJa('2026-10-21')).toBe('2026年10月21日（水）');
  });
});
