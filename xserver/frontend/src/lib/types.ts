// サーバー（PHP API）が返すデータの型

export interface ResolvedSession { start: number; lastStart: number; lastAdmin: number }

export interface GridCell { time: number; bed: number; text: string; visited: boolean; menus?: string[]; staff?: string; staffCheck?: boolean; /** 電話で取った予約の電話番号 */ phone?: string | null; web?: { id: string; kind: string; phone: string; cardNo: string | null } | null }
export interface CancelRow { id: string; time: number; bed: number; name: string; contText: string | null; kind: string; source: string; byCode: string; memo: string | null; nextDate: string | null; nextTime?: number | null; createdAt: string }
export interface SlotBlock { id: string; start: number; end: number; beds: number[]; label: string }
export interface DayCapacity { am: number; pm: number; autoAm: number; autoPm: number; namesAm: string[]; namesPm: string[]; firstAm?: number | null; firstPm?: number | null; revisitAm?: number | null; revisitPm?: number | null }

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
  /** 担当に選べる施術者（その日の出勤者が先） */
  staffOptions?: string[];
  /** 予約表の色を持つ施術者（初回・再来を担当する人。color が空なら自動） */
  colorStaff?: { name: string; color: string }[];
  cancels: CancelRow[];
  blocks: SlotBlock[];
  /** 予約表で選べるメニュー（本部の「選択肢の設定」で変更） */
  menuOptions?: string[];
  /** 物販（menuOptions のうち、予約表の帯で別の段に出すもの） */
  goodsOptions?: string[];
  /** 特別な営業日（プレオープン・イベントなど）ならその時間とメモ */
  special?: { date: string; sessions: [string, string][]; memo: string } | null;
}

export interface DayResponse { data: DayData; storeName: string; storeCode: string; published: boolean; today: string }

export interface Me {
  session: { code: string; role: 'store' | 'hq'; name?: string; canManage?: boolean };
  store: { id: string; code: string; name: string; active: boolean; jibaiOnly?: boolean } | null;
  stores: { code: string; name: string; active: boolean; area?: string; hqOnly?: boolean; jibaiOnly?: boolean }[];
  today: string;
  smsEnabled: boolean;
}
