// Tasks in the CLI's Markdown format: "- [ ] title ⏱ 2h 📅 2026-11-02 ⏳ 50m",
// an indented task is a subtask of the task above it (one level).

export type Task = {
  id: string;
  title: string;
  done: boolean;
  due?: string; // YYYY-MM-DD
  at?: string; // HH:MM on the due day: when to do it
  est?: number; // minutes
  spent?: number; // minutes in focus
  sub: Task[];
};

// kind "ideas" is the workspace's brainstorm board; it is stored like a list but kept out of lists and the calendar.
export type List = {
  id: string;
  name: string;
  tasks: Task[];
  updated: number;
  version: number;
  kind?: "ideas";
  position?: number;
};

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
  // "9:30" or "09:30"; anything past 23:59 is left in the title.
  s = s.replace(/ ?⏰ ([01]?\d|2[0-3]):([0-5]\d)/u, (_, h, m) => ((t.at = `${h.padStart(2, "0")}:${m}`), ""));
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
    (t.at ? ` ⏰ ${t.at}` : "") +
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

const str = (x: unknown, max: number) => typeof x === "string" && x.trim() !== "" && x.length <= max;
const mins = (x: unknown) => x === undefined || (Number.isInteger(x) && (x as number) >= 0 && (x as number) < 1e6);

// Checks tasks sent by a browser before they are stored: the shape above, one level of subtasks.
export function validTasks(x: unknown, depth = 0): x is Task[] {
  return (
    Array.isArray(x) &&
    x.length <= 1000 &&
    x.every(
      (t) =>
        t !== null &&
        typeof t === "object" &&
        str(t.id, 40) &&
        str(t.title, 500) &&
        typeof t.done === "boolean" &&
        (t.due === undefined || (typeof t.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due))) &&
        (t.at === undefined || (typeof t.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.at))) &&
        mins(t.est) &&
        mins(t.spent) &&
        (depth ? Array.isArray(t.sub) && t.sub.length === 0 : validTasks(t.sub, 1)),
    )
  );
}

export const validName = (x: unknown): x is string => str(x, 60);

// Markdown carries no ids: tasks that come back with the same title keep the id they had, so links to synced items hold.
export function keepIds(before: Task[], after: Task[]): Task[] {
  const pool = new Map<string, string[]>();
  for (const t of before.flatMap((t) => [t, ...t.sub])) pool.set(t.title, [...(pool.get(t.title) ?? []), t.id]);
  const reuse = (t: Task): Task => ({ ...t, id: pool.get(t.title)?.shift() ?? t.id, sub: t.sub.map(reuse) });
  return after.map(reuse);
}

const pluck = (tasks: Task[], id: string): [Task | undefined, Task[]] => {
  let found: Task | undefined;
  const rest = tasks.flatMap((t) => {
    if (t.id === id) return (found = t), [];
    const sub = t.sub.filter((x) => (x.id === id ? ((found = x), false) : true));
    return [{ ...t, sub }];
  });
  return [found, rest];
};

// Drops a task onto another top-level task as its subtask. Subtasks are one level deep,
// so the moved task's own subtasks come along as siblings.
export function nestUnder(tasks: Task[], id: string, parentId: string): Task[] {
  if (id === parentId || !tasks.some((t) => t.id === parentId)) return tasks;
  const [moved, rest] = pluck(tasks, id);
  if (!moved) return tasks;
  return rest.map((t) => (t.id === parentId ? { ...t, sub: [...t.sub, { ...moved, sub: [] }, ...moved.sub] } : t));
}

// Makes a subtask a main task again, at the end of the list.
export function unnest(tasks: Task[], id: string): Task[] {
  if (tasks.some((t) => t.id === id)) return tasks;
  const [moved, rest] = pluck(tasks, id);
  return moved ? [...rest, moved] : tasks;
}

export type Place = "before" | "after" | "inside";

// Moves tasks (in the order given) next to a target task, or into it as subtasks. Next to a subtask they
// become subtasks of the same parent; next to a main task they stay main tasks. Subtasks are one level deep,
// so a task with subtasks that lands inside or among subtasks brings them along as siblings.
export function moveTasks(tasks: Task[], ids: string[], targetId: string, place: Place): Task[] {
  if (ids.includes(targetId)) return tasks;
  const moved: Task[] = [];
  let rest = tasks;
  for (const id of ids) {
    const [t, r] = pluck(rest, id);
    if (t) moved.push(t);
    rest = r;
  }
  if (!moved.length) return tasks;
  const flat = moved.flatMap((t) => [{ ...t, sub: [] }, ...t.sub]);
  const top = rest.findIndex((t) => t.id === targetId);
  if (top >= 0) {
    if (place === "inside")
      return rest.map((t) => (t.id === targetId ? { ...t, sub: [...t.sub, ...flat] } : t));
    const i = place === "before" ? top : top + 1;
    return [...rest.slice(0, i), ...moved, ...rest.slice(i)];
  }
  const parent = rest.find((t) => t.sub.some((x) => x.id === targetId));
  if (!parent) return tasks;
  return rest.map((t) => {
    if (t !== parent) return t;
    const j = t.sub.findIndex((x) => x.id === targetId) + (place === "before" ? 0 : 1);
    return { ...t, sub: [...t.sub.slice(0, j), ...flat, ...t.sub.slice(j)] };
  });
}

// Takes tasks out of a list, for moving them to another one; returns what was taken and what's left.
export function takeTasks(tasks: Task[], ids: string[]): [Task[], Task[]] {
  const taken: Task[] = [];
  let rest = tasks;
  for (const id of ids) {
    const [t, r] = pluck(rest, id);
    if (t) taken.push(t);
    rest = r;
  }
  return [taken, rest];
}

// How late an open task is, in minutes: past its time today, or any time after its day. null if it isn't.
export function lateBy(t: Pick<Task, "due" | "at" | "done">, today: string, nowMin: number): number | null {
  if (t.done || !t.due || t.due > today) return null;
  if (t.due < today) return Infinity; // a day or more: the date chip already says "Nd late"
  if (!t.at) return null;
  const m = nowMin - (+t.at.slice(0, 2) * 60 + +t.at.slice(3, 5));
  return m > 0 ? m : null;
}

// "20m late", "3h late" for today; days are relDue's job.
export const lateLabel = (m: number) => (m < 60 ? `${m}m late` : `${Math.floor(m / 60)}h late`);
