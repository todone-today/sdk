import { test } from "node:test";
import assert from "node:assert/strict";
import { balance, fold, goalProgress, logGoal, reconcile, validGoalItems, xpFor, type Goal, type GoalItem } from "./goals.ts";
import { tick, type Task } from "./tasks.ts";

const task = (o: Partial<Task> = {}): Task => ({ id: "task0001", title: "T", done: false, sub: [], ...o });

test("xpFor: effort, urgency, on time, steps, goal", () => {
  assert.equal(xpFor(task(), "2026-11-07").xp, 5);
  const t = task({ est: 30, pri: 1, due: "2026-11-08", goal: "goal0001", sub: [task(), task(), task(), task(), task(), task()] });
  const x = xpFor(t, "2026-11-07");
  assert.deepEqual([x.effort, x.urgency, x.onTime, x.steps, x.goal], [6, 6, 4, 10, 5]);
  assert.equal(x.xp, 36);
  assert.equal(xpFor(task({ est: 999 }), "2026-11-07").effort, 48); // capped at 4 h
  assert.equal(xpFor(task({ due: "2026-11-01" }), "2026-11-07").onTime, 0); // late: no bonus, no penalty
});

test("tick records and clears doneAt/doneBy; a repeat's next copy starts clean", () => {
  let ts = tick([task()], "task0001", "2026-11-07", "u1");
  assert.ok(ts[0].doneAt && ts[0].doneBy === "u1");
  ts = tick(ts, "task0001", "2026-11-07");
  assert.equal(ts[0].doneAt, undefined);
  const r = tick([task({ rep: "every day", due: "2026-11-07" })], "task0001", "2026-11-07", "u1");
  assert.ok(r[0].doneAt);
  assert.equal(r[1].doneAt, undefined);
  assert.equal(r[1].done, false);
});

test("reconcile: wins for finished tasks, taken back on untick, kept when deleted", () => {
  const done = tick([task({ est: 30 })], "task0001", "2026-11-07", "u1");
  let log = reconcile([], done, "2026-11-07");
  assert.equal(log.length, 1);
  assert.equal(balance(log, "u1"), 11);
  assert.equal(reconcile(log, done, "2026-11-07"), log); // nothing new: same array
  assert.equal(reconcile(log, [task()], "2026-11-07").length, 0); // unticked
  assert.equal(reconcile(log, [], "2026-11-07").length, 1); // deleted: XP stays
  assert.equal(reconcile([], [task({ done: true })], "2026-11-07").length, 0); // finished before XP existed
});

test("balance counts spends and carried, per person", () => {
  const items: GoalItem[] = [
    { t: "win", id: "win00001", title: "a", at: 1, xp: 50, by: "u1" },
    { t: "win", id: "win00002", title: "b", at: 2, xp: 20, by: "u2" },
    { t: "win", id: "spend001", title: "Cheat meal", at: 3, xp: -30, by: "u1", spend: true },
    { t: "carried", id: "carry001", xp: 100, by: "u1" },
  ];
  assert.equal(balance(items, "u1"), 120);
  assert.equal(balance(items), 140);
});

test("goalProgress: outcome done of all, habit wins per week", () => {
  const g: Goal = { t: "goal", id: "goal0001", title: "Run", kind: "habit", perWeek: 3, created: 0 };
  const now = new Date(2026, 10, 7);
  const items: GoalItem[] = [
    { t: "win", id: "w0000001", title: "run", at: +new Date(2026, 10, 5), xp: 10, goal: "goal0001" },
    { t: "win", id: "w0000002", title: "run", at: +new Date(2026, 10, 6), xp: 10, goal: "goal0001" },
    { t: "win", id: "w0000003", title: "run", at: +new Date(2026, 9, 20), xp: 10, goal: "goal0001" },
  ];
  const p = goalProgress(g, [task({ goal: "goal0001", done: true }), task({ id: "task0002", goal: "goal0001" })], items, now);
  assert.equal(p.thisWeek, 2);
  assert.equal(p.weeks.length, 8);
  assert.equal(p.weeks.reduce((n, w) => n + w.n, 0), 3);
  assert.deepEqual([p.done, p.total, p.next?.id], [1, 2, "task0002"]);
});

test("validGoalItems: shapes and caps", () => {
  assert.ok(validGoalItems([{ t: "goal", id: "goal0001", title: "Ship", kind: "outcome", by: "2027-03-01", created: 1 }]));
  assert.ok(validGoalItems([{ t: "reward", id: "rew00001", title: "Cheat meal", cost: 150 }]));
  assert.ok(!validGoalItems([{ t: "goal", id: "goal0001", title: "", kind: "outcome", created: 1 }]));
  assert.ok(!validGoalItems([{ t: "goal", id: "goal0001", title: "x", kind: "habit", perWeek: 9, created: 1 }]));
  assert.ok(!validGoalItems([{ t: "reward", id: "rew00001", title: "x", cost: -5 }]));
  assert.ok(!validGoalItems([{ t: "other", id: "xxxxxxxx" }]));
});

test("fold keeps the log under its cap without losing XP", () => {
  let n = 0;
  const items: GoalItem[] = Array.from({ length: 5200 }, (_, i) => ({ t: "win", id: `w${String(i).padStart(8, "0")}`, title: "x", at: i, xp: 2, by: "u1" }));
  const f = fold(items, () => `c${String(n++).padStart(8, "0")}`);
  assert.ok(f.length < 5000);
  assert.equal(balance(f, "u1"), 10400);
});

test("target goals: progress from start to target, in either direction", () => {
  const g: Goal = { t: "goal", id: "goal0009", title: "Weigh 68 kg", kind: "target", unit: "kg", start: 74, target: 68, created: 0 };
  let n = 0;
  const id = () => `id${String(++n).padStart(6, "0")}`;
  const now = new Date(2026, 10, 9, 12);
  let items: GoalItem[] = logGoal([], g, 71, +now, id, "me");
  const p = goalProgress(g, [], items, now);
  assert.equal(p.current, 71);
  assert.equal(p.towards, 0.5);
  assert.equal(balance(items, "me"), 3); // first log of the day earns 3
  items = logGoal(items, g, 70.5, +now + 1000, id, "me");
  assert.equal(balance(items, "me"), 3); // the second that day earns nothing
  assert.ok(validGoalItems([g, ...items]));
});

test("daily goals: today's total, the bonus once on reaching it, and days hit this week", () => {
  const g: Goal = { t: "goal", id: "goal0010", title: "protein", kind: "daily", unit: "g", target: 140, created: 0 };
  let n = 0;
  const id = () => `id${String(++n).padStart(6, "0")}`;
  const now = new Date(2026, 10, 11, 20); // a Wednesday
  let items: GoalItem[] = logGoal([], g, 140, +new Date(2026, 10, 9, 9), id); // Monday: hit
  items = logGoal(items, g, 60, +new Date(2026, 10, 11, 9), id);
  items = logGoal(items, g, 90, +new Date(2026, 10, 11, 13), id); // reaches 150
  items = logGoal(items, g, 20, +new Date(2026, 10, 11, 19), id); // past it: no second bonus
  const p = goalProgress(g, [], items, now);
  assert.equal(p.today, 170);
  assert.equal(p.daysHit, 2);
  assert.equal(balance(items), 3 + 10 + 3 + 10);
});

test("habit check-ins count toward the week once, not again for their XP", () => {
  const g: Goal = { t: "goal", id: "goal0011", title: "Gym", kind: "habit", perWeek: 5, created: 0 };
  let n = 0;
  const id = () => `id${String(++n).padStart(6, "0")}`;
  const now = new Date(2026, 10, 11, 20);
  const items = logGoal(logGoal([], g, 1, +new Date(2026, 10, 10, 7), id), g, 1, +new Date(2026, 10, 11, 7), id);
  assert.equal(goalProgress(g, [], items, now).thisWeek, 2);
});
