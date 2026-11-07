// Goals, XP and rewards. A workspace keeps them in one list of kind "goals" (end-to-end encrypted like any list):
// its items are goals, rewards and the XP log, told apart by `t`. Everything here is plain functions on that data.
import type { Task } from "./tasks.ts";

// A goal: a habit is about showing up (`perWeek` times a week), an outcome about getting somewhere (by `by`).
// `obstacle` and `plan` are WOOP's: what could get in the way, and "If ___, then I'll ___".
export type Goal = {
  t: "goal";
  id: string;
  title: string;
  kind: "habit" | "outcome";
  why?: string;
  become?: string; // who I want to become
  by?: string; // YYYY-MM-DD, outcome goals
  perWeek?: number; // 1–7, habit goals
  obstacle?: string;
  plan?: string;
  created: number;
  done?: number; // achieved at (outcome goals)
  reflection?: string;
};
export type Reward = { t: "reward"; id: string; title: string; cost: number };
// The XP log. A win is a finished task (`id` is the task's id); a spend claims a reward (`xp` negative). `by` is
// who earned or spent it. "carried" folds old entries into a total so the log stays small.
export type Win = { t: "win"; id: string; title: string; at: number; xp: number; by?: string; goal?: string; spend?: true };
export type Carried = { t: "carried"; id: string; by?: string; xp: number };
export type GoalItem = Goal | Reward | Win | Carried;

const LOG_MAX = 5000;
const text = (x: unknown, max: number) => x === undefined || (typeof x === "string" && x.length <= max);
const ID = /^[\w-]{8,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validGoalItems(x: unknown): x is GoalItem[] {
  if (!Array.isArray(x) || x.length > LOG_MAX + 200) return false;
  let goals = 0;
  let rewards = 0;
  for (const i of x as Record<string, unknown>[]) {
    if (!i || typeof i !== "object" || typeof i.id !== "string" || !ID.test(i.id)) return false;
    if (i.t === "goal") {
      goals++;
      if (
        typeof i.title !== "string" ||
        !i.title.trim() ||
        i.title.length > 120 ||
        (i.kind !== "habit" && i.kind !== "outcome") ||
        !text(i.why, 1000) ||
        !text(i.become, 300) ||
        !text(i.obstacle, 500) ||
        !text(i.plan, 500) ||
        !text(i.reflection, 2000) ||
        (i.by !== undefined && !(typeof i.by === "string" && DAY.test(i.by))) ||
        (i.perWeek !== undefined && !(Number.isInteger(i.perWeek) && (i.perWeek as number) >= 1 && (i.perWeek as number) <= 7)) ||
        !Number.isFinite(i.created) ||
        (i.done !== undefined && !Number.isFinite(i.done))
      )
        return false;
    } else if (i.t === "reward") {
      rewards++;
      if (
        typeof i.title !== "string" ||
        !i.title.trim() ||
        i.title.length > 80 ||
        !Number.isInteger(i.cost) ||
        (i.cost as number) < 1 ||
        (i.cost as number) > 100_000
      )
        return false;
    } else if (i.t === "win" || i.t === "carried") {
      if (!Number.isFinite(i.xp) || !text(i.by, 80)) return false;
      if (i.t === "win" && (typeof i.title !== "string" || i.title.length > 500 || !Number.isFinite(i.at))) return false;
    } else return false;
  }
  return goals <= 100 && rewards <= 50;
}

// XP for finishing a task: effort, urgency and keeping your word, all from what the task already says.
// 5, + estimate / 5 (up to 4 h), + 6 high / 3 medium priority, + 4 on time, + 2 a step (up to 10), + 5 toward a goal.
// Honest by design: a bigger estimate earns more, and that's the person's call.
export function xpFor(task: Task, doneDay: string) {
  const effort = Math.round(Math.min(task.est ?? 0, 240) / 5);
  const urgency = task.pri === 1 ? 6 : task.pri === 2 ? 3 : 0;
  const onTime = task.due && doneDay <= task.due ? 4 : 0;
  const steps = Math.min(task.sub.length * 2, 10);
  const goal = task.goal ? 5 : 0;
  return { xp: 5 + effort + urgency + onTime + steps + goal, effort, urgency, onTime, steps, goal };
}

// Someone's XP to spend (or everyone's, without `by`).
export const balance = (items: GoalItem[], by?: string) =>
  items.reduce((n, i) => ((i.t === "win" || i.t === "carried") && (by === undefined || i.by === by) ? n + i.xp : n), 0);

// Keeps the log under its cap: the oldest entries become one "carried" total per person.
export function fold(items: GoalItem[], id: () => string): GoalItem[] {
  const log = items.filter((i): i is Win => i.t === "win").sort((a, b) => a.at - b.at);
  if (log.length <= LOG_MAX) return items;
  const old = new Set(log.slice(0, log.length - LOG_MAX + 500));
  const carried = new Map<string, number>();
  for (const i of items)
    if ((i.t === "win" && old.has(i)) || i.t === "carried") carried.set(i.by ?? "", (carried.get(i.by ?? "") ?? 0) + i.xp);
  return [
    ...items.filter((i) => i.t !== "carried" && !(i.t === "win" && old.has(i))),
    ...[...carried].map(([by, xp]): Carried => ({ t: "carried", id: id(), xp, ...(by ? { by } : {}) })),
  ];
}

// Monday of the week a day falls in, as YYYY-MM-DD.
const monday = (d: Date) => {
  const m = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
  return m.toISOString().slice(0, 10);
};

// How a goal is going. Outcome: its tasks (and steps) done of all. Habit: wins per week, the last 8 weeks, oldest
// first, against perWeek. Habits count wins from the log, so deleted tasks still count.
export function goalProgress(goal: Goal, tasks: Task[], items: GoalItem[], now = new Date()) {
  const linked = tasks.flatMap((t) => [t, ...t.sub]).filter((t) => t.goal === goal.id);
  const weeks: { week: string; n: number }[] = [];
  for (let w = 7; w >= 0; w--) {
    const d = new Date(now);
    d.setDate(d.getDate() - w * 7);
    weeks.push({ week: monday(d), n: 0 });
  }
  for (const i of items)
    if (i.t === "win" && !i.spend && i.goal === goal.id) {
      const wk = weeks.find((w) => w.week === monday(new Date(i.at)));
      if (wk) wk.n++;
    }
  return {
    done: linked.filter((t) => t.done).length,
    total: linked.length,
    next: linked.find((t) => !t.done),
    weeks,
    thisWeek: weeks[weeks.length - 1].n,
  };
}

// The log after the lists changed: a win for every finished task not in it yet, and none for a task that's been
// unticked. Tasks that are gone (deleted, binned) keep their XP. `today` dates "on time".
export function reconcile(items: GoalItem[], tasks: Task[], today: string, me?: string): GoalItem[] {
  const all = tasks.flatMap((t) => [t, ...t.sub]);
  const byId = new Map(all.map((t) => [t.id, t]));
  const logged = new Set(items.filter((i) => i.t === "win").map((i) => i.id));
  let changed = false;
  const kept = items.filter((i) => {
    if (i.t !== "win" || i.spend) return true;
    const t = byId.get(i.id);
    if (t && !t.done) return (changed = true), false;
    return true;
  });
  const added: Win[] = [];
  // Only whole tasks earn: a task's steps count toward its XP instead (see xpFor).
  for (const t of tasks)
    if (t.done && t.doneAt && !logged.has(t.id)) {
      const by = t.doneBy ?? me;
      added.push({
        t: "win",
        id: t.id,
        title: t.title,
        at: t.doneAt,
        xp: xpFor(t, today).xp,
        ...(by ? { by } : {}),
        ...(t.goal ? { goal: t.goal } : {}),
      });
    }
  return changed || added.length ? [...kept, ...added] : items;
}
