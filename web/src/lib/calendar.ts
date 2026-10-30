// Date and layout helpers for the calendar views. Dates are "YYYY-MM-DD", times "HH:MM", all in local time.

const parts = (iso: string) => [+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)] as const;
const utc = (iso: string, plus = 0) => new Date(Date.UTC(parts(iso)[0], parts(iso)[1], parts(iso)[2] + plus));

export const addDays = (iso: string, n: number) => utc(iso, n).toISOString().slice(0, 10);
export const addMonths = (iso: string, n: number) =>
  new Date(Date.UTC(parts(iso)[0], parts(iso)[1] + n, 1)).toISOString().slice(0, 10);
// Same day n months on, kept inside the month: Jan 31 + 1 month is Feb 28.
export function shiftMonths(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  const last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + n, Math.min(d, last))).toISOString().slice(0, 10);
}
export const weekday = (iso: string) => (utc(iso).getUTCDay() + 6) % 7; // Monday = 0
export const weekStart = (iso: string) => addDays(iso, -weekday(iso));
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

// Whole weeks covering the month, Monday first.
export function monthCells(iso: string): string[] {
  const first = monthStart(iso);
  const days = new Date(Date.UTC(parts(first)[0], parts(first)[1] + 1, 0)).getUTCDate();
  const lead = weekday(first);
  return Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => addDays(first, i - lead));
}

export const toMinutes = (at: string) => +at.slice(0, 2) * 60 + +at.slice(3, 5);
export const toClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const label = (iso: string, o: Intl.DateTimeFormatOptions) =>
  utc(iso).toLocaleDateString("en", { ...o, timeZone: "UTC" });

// Overlapping blocks sit side by side: each gets a lane and how many lanes its overlapping group uses.
export function lanes<T extends { start: number; end: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const out: (T & { lane: number; lanes: number })[] = [];
  let group: (T & { lane: number; lanes: number })[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const close = () => group.forEach((g) => (g.lanes = ends.length));
  for (const it of [...items].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (it.start >= groupEnd) {
      close();
      group = [];
      ends = [];
    }
    let lane = ends.findIndex((e) => e <= it.start);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = it.end;
    groupEnd = Math.max(groupEnd, it.end);
    const placed = { ...it, lane, lanes: 1 };
    group.push(placed);
    out.push(placed);
  }
  close();
  return out;
}
