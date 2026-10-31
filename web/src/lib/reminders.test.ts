import { test } from "node:test";
import assert from "node:assert/strict";
import { dueNotes, localNow } from "./reminders.ts";
import { parse } from "./tasks.ts";

const items = parse(
  "- [ ] Dentist 📅 2026-11-02 ⏰ 09:30\n- [ ] Call 📅 2026-11-02 ⏰ 14:00\n- [x] Done one 📅 2026-11-02 ⏰ 09:30\n- [ ] Late one 📅 2026-10-30\n",
).map((task) => ({ task, list: "Life" }));

test("reminds shortly before a task's time, once per occurrence", () => {
  const n = dueNotes(items, "2026-11-02", 9 * 60 + 20);
  assert.deepEqual(
    n.map((x) => [x.title, x.body]),
    [["Dentist", "At 09:30 · Life"]],
  );
  assert.match(n[0].key, /^t:.+:2026-11-02:09:30$/);
  assert.equal(dueNotes(items, "2026-11-02", 9 * 60).length, 0); // 30 minutes out: not yet
  assert.equal(dueNotes(items, "2026-11-02", 9 * 60 + 35)[0].body, "Started 09:30 · Life"); // a late run still sends it
});

test("a morning digest of today and what's late", () => {
  const n = dueNotes(items, "2026-11-02", 8 * 60 + 5);
  assert.deepEqual(
    n.map((x) => [x.key, x.title, x.body]),
    [["d:2026-11-02", "2 due today, 1 late", "Late one · Dentist · Call"]],
  );
});

test("local time in the person's zone", () => {
  const now = new Date("2026-11-01T22:45:00Z");
  assert.deepEqual(localNow(now, "Asia/Kolkata"), { today: "2026-11-02", nowMin: 4 * 60 + 15 });
  assert.deepEqual(localNow(now, "America/New_York"), { today: "2026-11-01", nowMin: 17 * 60 + 45 });
});
