declare module 'japanese-holidays' {
  /** 祝日なら祝日名、そうでなければ undefined */
  export function isHoliday(date: Date, furikae?: boolean): string | undefined;
  export function isHolidayAt(date: Date, furikae?: boolean): string | undefined;
  export function getHolidaysOf(year: number, furikae?: boolean): { month: number; date: number; name: string }[];
}
