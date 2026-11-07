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
  pri?: 1 | 2 | 3; // priority: 1 high, 2 medium, 3 low (Obsidian Tasks: ⏫ 🔼 🔽)
  rep?: string; // repeats: "every day", "every weekday", "every 2 weeks", ... (Obsidian Tasks: 🔁)
  note?: string; // the description, simple Markdown
  files?: FileRef[]; // attachments; `enc`: stored end-to-end encrypted
  share?: string; // while shared by link (not end-to-end encrypted): the share's id
  history?: Kept[]; // a shared task's conversation, kept (encrypted) after sharing stopped
  sub: Task[];
};
export type FileRef = { id: string; name: string; type: string; size: number; enc?: true };
export type Kept = { who: string; at: number; text: string; files?: FileRef[] };

// kind "ideas" is the workspace's brainstorm board, kind "bin" its recently deleted tasks (kept 7 days); both are
// stored like lists but kept out of lists and the calendar.
export type List = {
  id: string;
  name: string;
  tasks: Task[];
  updated: number;
  version: number;
  kind?: "ideas" | "bin";
  position?: number;
  icon?: string; // a name from the app's icon set; inside the encrypted data unless the list is plain
  // Switched off end-to-end encryption: stored readable, so integrations, feeds and public links can use it.
  plain?: boolean;
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

// Priority markers, high to low, as Obsidian Tasks writes them.
export const PRI_MARK = ["⏫", "🔼", "🔽"];

const LINE = /^([ \t]*)- \[([ xX])\] (.*)$/;

function meta(text: string): Omit<Task, "id" | "done" | "sub"> {
  let s = text;
  const t: Omit<Task, "id" | "done" | "sub"> = { title: "" };
  s = s.replace(/ ?🔁 ([a-z0-9 ]+?)(?= [^\sa-z0-9]|$)/iu, (m, r) =>
    validRepeat(r.trim()) ? ((t.rep = r.trim().toLowerCase()), "") : m,
  );
  s = s.replace(/ ?📅 (\d{4}-\d{2}-\d{2})/u, (_, d) => ((t.due = d), ""));
  s = s.replace(/ ?(⏫|🔼|🔽)/u, (_, p) => ((t.pri = (PRI_MARK.indexOf(p) + 1) as 1 | 2 | 3), ""));
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
    (t.pri ? ` ${PRI_MARK[t.pri - 1]}` : "") +
    (t.rep ? ` 🔁 ${t.rep}` : "") +
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
const ID = /^[\w-]{8,64}$/;
const fileRef = (f: unknown): f is FileRef => {
  const r = f as FileRef;
  return (
    !!r &&
    typeof r === "object" &&
    ID.test(String(r.id)) &&
    str(r.name, 200) &&
    str(r.type, 100) &&
    Number.isInteger(r.size) &&
    r.size > 0 &&
    r.size <= 60_000_000 &&
    (r.enc === undefined || r.enc === true)
  );
};
const files = (x: unknown) => x === undefined || (Array.isArray(x) && x.length <= 50 && x.every(fileRef));
const extras = (t: Record<string, unknown>) =>
  (t.note === undefined || (typeof t.note === "string" && t.note.length <= 20_000)) &&
  files(t.files) &&
  (t.share === undefined || (typeof t.share === "string" && ID.test(t.share))) &&
  (t.history === undefined ||
    (Array.isArray(t.history) &&
      t.history.length <= 500 &&
      t.history.every(
        (h) =>
          !!h &&
          typeof h === "object" &&
          str(h.who, 80) &&
          Number.isFinite(h.at) &&
          typeof h.text === "string" &&
          h.text.length <= 4000 &&
          files(h.files),
      )));
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
        (t.pri === undefined || t.pri === 1 || t.pri === 2 || t.pri === 3) &&
        (t.rep === undefined || (typeof t.rep === "string" && validRepeat(t.rep))) &&
        mins(t.spent) &&
        extras(t) &&
        (depth ? Array.isArray(t.sub) && t.sub.length === 0 : validTasks(t.sub, 1)),
    )
  );
}

export const validName = (x: unknown): x is string => str(x, 60);
export const validIcon = (x: unknown) => x === undefined || x === null || (typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x));

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
    if (t.id === id) return ((found = t), []);
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
    if (place === "inside") return rest.map((t) => (t.id === targetId ? { ...t, sub: [...t.sub, ...flat] } : t));
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

// Repeating tasks: "every day", "every weekday", "every weekend", "every week", "every 2 weeks", "every month", ...
const REPEAT = /^every (?:weekday|weekend|(?:(\d{1,3}) )?(day|week|month|year)s?)$/i;
export const validRepeat = (r: string) => REPEAT.test(r.trim());

const D = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
const iso = (d: Date) => d.toISOString().slice(0, 10);

// The next due day after `from` for a repeat rule; months keep the day inside the month (Jan 31 -> Feb 28).
export function nextDue(from: string, rule: string): string {
  if (/week(day|end)/i.test(rule)) {
    const weekend = /weekend/i.test(rule);
    const d = D(from);
    do d.setUTCDate(d.getUTCDate() + 1);
    while ((d.getUTCDay() === 0 || d.getUTCDay() === 6) !== weekend);
    return iso(d);
  }
  const [, n = "1", unit] = REPEAT.exec(rule.trim())!;
  const k = +n;
  const d = D(from);
  if (unit.toLowerCase() === "day") d.setUTCDate(d.getUTCDate() + k);
  else if (unit.toLowerCase() === "week") d.setUTCDate(d.getUTCDate() + 7 * k);
  else {
    const months = unit.toLowerCase() === "month" ? k : 12 * k;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return iso(d);
}

// Ticks a task (or unticks it). Finishing a repeating task keeps it done and adds the next one right after it,
// due on the next day of its rule, with its steps unticked; the finished one stops repeating.
export function tick(tasks: Task[], id: string, today: string): Task[] {
  const next = (t: Task): Task => ({
    ...t,
    id: uid(),
    done: false,
    spent: undefined,
    due: nextDue(t.due ?? today, t.rep!),
    sub: t.sub.map((x) => ({ ...x, id: uid(), done: false, spent: undefined })),
  });
  const walk = (ts: Task[]): Task[] =>
    ts.flatMap((t) => {
      if (t.id !== id) return [{ ...t, sub: walk(t.sub) }];
      // Finishing a task finishes its steps; unticking leaves them as they were.
      const finish = (t: Task): Task => ({ ...t, done: true, sub: t.sub.map((x) => ({ ...x, done: true })) });
      if (t.done) return [{ ...t, done: false }];
      if (!t.rep) return [finish(t)];
      return [{ ...finish(t), rep: undefined }, next(t)];
    });
  return walk(tasks);
}

// How a repeat rule reads on a chip: "Daily", "Weekdays", "Every 2 weeks".
export function repeatLabel(rule: string): string {
  const r = rule.trim().toLowerCase();
  const named: Record<string, string> = {
    "every day": "Daily",
    "every weekday": "Weekdays",
    "every weekend": "Weekends",
    "every week": "Weekly",
    "every month": "Monthly",
    "every year": "Yearly",
  };
  return named[r] ?? r[0].toUpperCase() + r.slice(1);
}

// A repeating task whose next day hasn't come: it waits out of sight (in Open and the counts) until then.
export const waiting = (t: Task, today: string) => !t.done && !!t.rep && !!t.due && t.due > today;

// Markdown with "## List name" headings split into lists; tasks before any heading have no list (null).
export function parseLists(md: string): { name: string | null; tasks: Task[] }[] {
  const groups: { name: string | null; text: string }[] = [{ name: null, text: "" }];
  for (const line of md.split("\n")) {
    const h = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) groups.push({ name: h[1].trim().slice(0, 60), text: "" });
    else groups[groups.length - 1].text += line + "\n";
  }
  return groups.map((g) => ({ name: g.name, tasks: parse(g.text) })).filter((g) => g.tasks.length);
}
