// Tasks in the CLI's Markdown format: "- [ ] title ⏱ 2h 📅 2026-11-02 ⏳ 50m",
// an indented task is a subtask of the task above it (one level).

export type Task = {
  id: string;
  title: string;
  done: boolean;
  due?: string; // YYYY-MM-DD
  est?: number; // minutes
  spent?: number; // minutes in focus
  sub: Task[];
};

export type List = { id: string; name: string; tasks: Task[]; updated: number };

export const uid = () => Math.random().toString(36).slice(2, 10);

// "2" or "1.5h" (hours), "30m", "1h30m" -> minutes; null if unreadable.
export function parseMinutes(s: string): number | null {
  const e = s.toLowerCase().replace(/\s/g, "");
  if (/^\d+(\.\d+)?h?$/.test(e)) return Math.round(parseFloat(e) * 60);
  if (/^\d+m$/.test(e)) return parseInt(e, 10);
  const m = /^(\d+)h(\d+)m?$/.exec(e);
  return m ? +m[1] * 60 + +m[2] : null;
}

export function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h${r ? `${r}m` : ""}` : `${r}m`;
}

const LINE = /^([ \t]*)- \[([ xX])\] (.*)$/;

function meta(text: string): Omit<Task, "id" | "done" | "sub"> {
  let s = text;
  const t: Omit<Task, "id" | "done" | "sub"> = { title: "" };
  s = s.replace(/ ?📅 (\d{4}-\d{2}-\d{2})/u, (_, d) => ((t.due = d), ""));
  s = s.replace(/ ?⏱️? ([0-9hm.]+)/u, (_, e) => ((t.est = parseMinutes(e) ?? undefined), ""));
  s = s.replace(/ ?⏳ ([0-9hm.]+)/u, (_, e) => ((t.spent = parseMinutes(e) ?? undefined), ""));
  t.title = s.trim();
  return t;
}

// Lines that are not tasks (headings, notes) are dropped.
export function parse(md: string): Task[] {
  const tasks: Task[] = [];
  for (const line of md.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const task: Task = { id: uid(), done: m[2] !== " ", sub: [], ...meta(m[3]) };
    const parent = tasks[tasks.length - 1];
    if (m[1] && parent) parent.sub.push(task);
    else tasks.push(task);
  }
  return tasks;
}

function line(t: Task, indent: string): string {
  const fields =
    (t.est ? ` ⏱ ${fmtMinutes(t.est)}` : "") +
    (t.due ? ` 📅 ${t.due}` : "") +
    (t.spent ? ` ⏳ ${fmtMinutes(t.spent)}` : "");
  return `${indent}- [${t.done ? "x" : " "}] ${t.title}${fields}`;
}

export function serialize(tasks: Task[]): string {
  return tasks.flatMap((t) => [line(t, ""), ...t.sub.map((s) => line(s, "  "))]).join("\n") + "\n";
}

// How a due date reads next to a task, the way the CLI says it.
export function relDue(due: string, today: string): string {
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
  const k = day(due) - day(today);
  if (k < 0) return `${-k}d late`;
  if (k === 0) return "today";
  if (k === 1) return "tomorrow";
  const d = new Date(`${due}T00:00:00`);
  if (k < 7) return d.toLocaleDateString("en", { weekday: "short" });
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
