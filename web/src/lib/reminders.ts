// Which notifications are due right now for one person, in their own time zone. Each has a key, so the
// sender can make sure it goes out once: a reminder per task occurrence, a digest per day.
import type { Task } from "./tasks.ts";

export type Note = { key: string; title: string; body: string };
type Item = { task: Task; list: string };

export const DIGEST_AT = 8 * 60; // the morning summary, 08:00 local
const toMin = (at: string) => +at.slice(0, 2) * 60 + +at.slice(3, 5);

// The date and minute of the day in a time zone.
export function localNow(now: Date, timeZone: string): { today: string; nowMin: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { today: `${p.year}-${p.month}-${p.day}`, nowMin: +p.hour * 60 + +p.minute };
}

// Tasks starting within `ahead` minutes (or that started in the last few, if the run was late),
// and once a day around 08:00, what's due today and what's late.
export function dueNotes(items: Item[], today: string, nowMin: number, ahead = 15): Note[] {
  const open = items.filter((i) => !i.task.done);
  const notes: Note[] = open
    .filter(
      (i) => i.task.due === today && i.task.at && toMin(i.task.at) - nowMin <= ahead && toMin(i.task.at) - nowMin > -10,
    )
    .map(({ task: t, list }) => ({
      key: `t:${t.id}:${t.due}:${t.at}`,
      title: t.title,
      body: `${toMin(t.at!) > nowMin ? `At ${t.at}` : `Started ${t.at}`} · ${list}`,
    }));
  if (nowMin >= DIGEST_AT && nowMin < DIGEST_AT + 60) {
    const todays = open.filter((i) => i.task.due === today);
    const late = open.filter((i) => i.task.due && i.task.due < today);
    if (todays.length || late.length)
      notes.push({
        key: `d:${today}`,
        title: `${todays.length} due today${late.length ? `, ${late.length} late` : ""}`,
        body: [...late, ...todays]
          .slice(0, 4)
          .map((i) => i.task.title)
          .join(" · "),
      });
  }
  return notes;
}
