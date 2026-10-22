// 台灣時間固定 UTC+8、沒有日光節約，直接用位移換算。

const OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function shifted(value: string | Date): string {
  const ms = (typeof value === "string" ? Date.parse(value) : value.getTime()) + OFFSET_MS;
  return new Date(ms).toISOString();
}

export function isDateString(s: string): boolean {
  return DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function isMonthString(s: string): boolean {
  return MONTH_RE.test(s) && isDateString(`${s}-01`);
}

/** 台灣時間的日期 YYYY-MM-DD */
export function taipeiDate(value: string | Date = new Date()): string {
  return shifted(value).slice(0, 10);
}

/** 台灣時間 date 當天 00:00 對應的 UTC ISO 字串 */
export function taipeiDayStartIso(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - OFFSET_MS).toISOString();
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** YYYY-MM → 該月第一天和最後一天 */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** 顯示用：2026/10/21 14:30 */
export function formatTaipei(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = shifted(iso);
  return `${s.slice(0, 4)}/${s.slice(5, 7)}/${s.slice(8, 10)} ${s.slice(11, 16)}`;
}

/** <input type="datetime-local"> 的值（台灣時間）→ UTC ISO；格式不對回傳 null */
export function taipeiLocalInputToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) return null;
  const ms = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms - OFFSET_MS).toISOString();
}

/** UTC ISO → <input type="datetime-local"> 的值（台灣時間，到分鐘） */
export function isoToTaipeiLocalInput(iso: string): string {
  return shifted(iso).slice(0, 16);
}
