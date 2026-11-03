// Pure helpers for the integrations: the calendar feed and the Discord messages.
import { addDays, toClock, toMinutes } from "./calendar.ts";
import type { Remote } from "./sync.ts";
import type { List, Task } from "./tasks.ts";

const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

// RFC 5545: lines longer than 75 octets continue on the next line after a space.
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  return [...out, cur].join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const day = (iso: string) => iso.replace(/-/g, "");
const next = (iso: string) => day(new Date(Date.parse(`${iso}T00:00:00Z`) + 864e5).toISOString().slice(0, 10));
// Floating local time (no Z): the event sits at that clock time in whatever zone the calendar is in.
const local = (iso: string, at: string, plus = 0) =>
  new Date(Date.parse(`${iso}T${at}:00Z`) + plus * 6e4).toISOString().slice(0, 16).replace(/[-:]/g, "") + "00";

// Open tasks with a due date become events: timed (start + estimate) when they have a time, else all-day.
export function toICS(name: string, lists: Pick<List, "name" | "tasks">[], now = new Date()): string {
  const events = lists.flatMap((l) =>
    l.tasks
      .flatMap((t) => [t, ...t.sub])
      .filter((t): t is Task & { due: string } => !!t.due && !t.done)
      .map((t) => [
        "BEGIN:VEVENT",
        `UID:${t.id}@todone`,
        `DTSTAMP:${stamp(now)}`,
        ...(t.at
          ? [`DTSTART:${local(t.due, t.at)}`, `DTEND:${local(t.due, t.at, t.est || 30)}`]
          : [`DTSTART;VALUE=DATE:${day(t.due)}`, `DTEND;VALUE=DATE:${next(t.due)}`]),
        `SUMMARY:${esc(t.title)}`,
        `DESCRIPTION:${esc(`In ${l.name}`)}`,
        "END:VEVENT",
      ]),
  );
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//todone//EN",
      `X-WR-CALNAME:${esc(name)}`,
      ...events.flat(),
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n"
  );
}

// What changed worth telling a team: tasks added and tasks finished.
export function changes(before: Task[], after: Task[]): { added: string[]; done: string[] } {
  const all = (ts: Task[]) => ts.flatMap((t) => [t, ...t.sub]);
  const old = new Map(all(before).map((t) => [t.id, t]));
  const now = all(after);
  return {
    added: now.filter((t) => !old.has(t.id)).map((t) => t.title),
    done: now.filter((t) => t.done && old.has(t.id) && !old.get(t.id)!.done).map((t) => t.title),
  };
}

// Only calendars this app creates: Google treats this scope as less sensitive than full calendar access.
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

// Only Discord's own webhook endpoint, so a saved URL can't point the server at anything else.
export const validDiscordWebhook = (u: string) =>
  /^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(u);

// Event start/end for a task: timed from its time for its estimate (30 minutes if none), else all-day.
export function eventTimes(t: Task, timeZone: string) {
  if (!t.at) return { start: { date: t.due }, end: { date: addDays(t.due!, 1) } };
  const end = toMinutes(t.at) + (t.est || 30);
  const endDay = addDays(t.due!, Math.floor(end / 1440));
  return {
    start: { dateTime: `${t.due}T${t.at}:00`, timeZone },
    end: { dateTime: `${endDay}T${toClock(end % 1440)}:00`, timeZone },
  };
}

export type Event = {
  id: string;
  status: string;
  summary?: string;
  recurringEventId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

export function fromEvent(e: Event): Remote | null {
  if (e.status === "cancelled") return { id: e.id, title: "", deleted: true };
  if (e.recurringEventId || !e.summary?.trim() || !e.start) return null; // repeating events stay in Google
  if (e.start.date) return { id: e.id, title: e.summary.trim().slice(0, 500), due: e.start.date };
  const s = e.start.dateTime!;
  const est = Math.round((Date.parse(e.end!.dateTime!) - Date.parse(s)) / 6e4);
  return { id: e.id, title: e.summary.trim().slice(0, 500), due: s.slice(0, 10), at: s.slice(11, 16), est };
}
