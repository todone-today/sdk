import { test } from "node:test";
import assert from "node:assert/strict";
import { keepIds, locate, nestUnder, putBack, unnest, parse, serialize, parseMinutes, relDue, validTasks } from "./tasks.ts";

test("round-trips the CLI format", () => {
  const md = "- [ ] Write launch post ⏱ 2h 📅 2026-11-02\n  - [x] Outline ⏳ 50m\n  - [ ] Pick a title ⏱ 30m\n- [x] done\n";
  const tasks = parse(md);
  assert.equal(tasks.length, 2);
  assert.deepEqual(
    { title: tasks[0].title, est: tasks[0].est, due: tasks[0].due, subs: tasks[0].sub.length },
    { title: "Write launch post", est: 120, due: "2026-11-02", subs: 2 },
  );
  assert.equal(tasks[0].sub[0].spent, 50);
  assert.equal(serialize(tasks), md);
});

test("keeps a time of day", () => {
  const md = "- [ ] Standup ⏱ 15m 📅 2026-11-02 ⏰ 09:30\n";
  const [t] = parse(md);
  assert.equal(t.at, "09:30");
  assert.equal(t.title, "Standup");
  assert.equal(serialize([t]), md);
  assert.ok(validTasks([t]));
  assert.ok(!validTasks([{ ...t, at: "25:00" }]));
});

test("ignores non-task lines and orphan indents", () => {
  const tasks = parse("# Todo\n\nnotes\n  - [ ] orphan\n");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "orphan");
});

test("reads estimates and due dates", () => {
  assert.equal(parseMinutes("1h30m"), 90);
  assert.equal(parseMinutes("1.5h"), 90);
  assert.equal(parseMinutes("lots"), null);
  assert.equal(relDue("2026-10-29", "2026-10-30"), "1d late");
  assert.equal(relDue("2026-10-31", "2026-10-30"), "tomorrow");
});

test("accepts parsed tasks and rejects bad shapes", () => {
  assert.ok(validTasks(parse("- [ ] a ⏱ 2h 📅 2026-11-02\n  - [x] b\n")));
  assert.ok(validTasks([]));
  assert.ok(!validTasks([{ id: "a", title: "", done: false, sub: [] }]));
  assert.ok(!validTasks([{ id: "a", title: "x", done: "no", sub: [] }]));
  assert.ok(!validTasks([{ id: "a", title: "x", done: false, est: -1, sub: [] }]));
  const deep = { id: "c", title: "x", done: false, sub: [] };
  const mid = { id: "b", title: "x", done: false, sub: [deep] };
  assert.ok(!validTasks([{ id: "a", title: "x", done: false, sub: [mid] }]));
});

test("re-imported Markdown keeps task ids by title", () => {
  const before = parse("- [ ] a\n  - [ ] b\n- [ ] c\n");
  const after = keepIds(before, parse("- [x] a\n- [ ] new\n  - [ ] b\n"));
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[1].sub[0].id, before[0].sub[0].id);
  assert.notEqual(after[1].id, before[1].id);
});

test("dropping a task on another nests it, one level deep", () => {
  const ts = parse("- [ ] a\n- [ ] b\n  - [ ] b1\n- [ ] c\n");
  const [a, b, c] = ts;
  let r = nestUnder(ts, b.id, a.id);
  assert.deepEqual(r.map((t) => t.title), ["a", "c"]);
  assert.deepEqual(r[0].sub.map((t) => t.title), ["b", "b1"]);
  r = nestUnder(ts, b.sub[0].id, c.id);
  assert.deepEqual([r[1].sub.length, r[2].sub[0].title], [0, "b1"]);
  assert.equal(nestUnder(ts, a.id, a.id), ts);
  assert.equal(nestUnder(ts, a.id, b.sub[0].id), ts); // only main tasks take subtasks
  r = unnest(ts, b.sub[0].id);
  assert.deepEqual(r.map((t) => t.title), ["a", "b", "c", "b1"]);
});

test("a deleted task goes back where it was", () => {
  const ts = parse("- [ ] a\n  - [ ] a1\n  - [ ] a2\n- [ ] b\n- [ ] c\n");
  for (const id of [ts[1].id, ts[0].sub[1].id, ts[0].id]) {
    const spot = locate(ts, id)!;
    const without = ts.flatMap((t) => (t.id === id ? [] : [{ ...t, sub: t.sub.filter((x) => x.id !== id) }]));
    assert.equal(serialize(putBack(without, spot)), serialize(ts));
  }
});

test("reads what an AI tends to write", () => {
  const [a, b] = parse("```\n- [ ] Call mum ⏰ 9:30 📅 2026-11-02\n- [ ] Gym ⏱️ 1h\n```\n");
  assert.deepEqual([a.title, a.at, a.due], ["Call mum", "09:30", "2026-11-02"]);
  assert.deepEqual([b.title, b.est], ["Gym", 60]);
});
