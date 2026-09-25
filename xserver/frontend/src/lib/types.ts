// サーバー（PHP API）が返すデータの型

export interface ResolvedSession { start: number; lastStart: number; lastAdmin: number }

export interface GridCell { time: number; bed: number; text: string; visited: boolean; web?: { id: string; kind: string; phone: string; cardNo: string | null } | null }
export interface CancelRow { id: string; time: number; bed: number; name: string; contText: string | null; kind: string; source: string; byCode: string; memo: string | null; nextDate: string | null; createdAt: string }
export interface DayCapacity { am: number; pm: number; autoAm: number; autoPm: number; namesAm: string[]; namesPm: string[] }

export interface DayData {
  date: string;
  day: { published: boolean | null; closed: boolean; memo: string; capacityAm: number | null; capacityPm: number | null };
  sessions: ResolvedSession[];
  times: number[];
  customerTimes: number[];
  slotMinutes: number;
  beds: number[];
  capacity: DayCapacity;
  hasStaff: boolean;
  receptionNames: string[];
  shiftLabels: { name: string; role: string; status: string }[];
  cells: GridCell[];
  cancels: CancelRow[];
}

export interface DayResponse { data: DayData; storeName: string; storeCode: string; published: boolean; today: string }

export interface Me {
  session: { code: string; role: 'store' | 'hq' };
  store: { id: string; code: string; name: string; active: boolean } | null;
  stores: { code: string; name: string; active: boolean }[];
  today: string;
  smsEnabled: boolean;
}
