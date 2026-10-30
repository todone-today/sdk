import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, serialize, parseMinutes, relDue } from "./tasks.ts";

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
