// サーバー（PHP API）が返すデータの型

export interface ResolvedSession { start: number; lastStart: number; lastAdmin: number }

export interface GridCell { time: number; bed: number; text: string; visited: boolean; menus?: string[]; web?: { id: string; kind: string; phone: string; cardNo: string | null } | null }
export interface CancelRow { id: string; time: number; bed: number; name: string; contText: string | null; kind: string; source: string; byCode: string; memo: string | null; nextDate: string | null; nextTime?: number | null; createdAt: string }
export interface SlotBlock { id: string; start: number; end: number; beds: number[]; label: string }
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
  blocks: SlotBlock[];
  /** 予約表で選べるメニュー（本部の「選択肢の設定」で変更） */
  menuOptions?: string[];
}

export interface DayResponse { data: DayData; storeName: string; storeCode: string; published: boolean; today: string }

export interface Me {
  session: { code: string; role: 'store' | 'hq'; name?: string; canManage?: boolean };
  store: { id: string; code: string; name: string; active: boolean } | null;
  stores: { code: string; name: string; active: boolean }[];
  today: string;
  smsEnabled: boolean;
}
