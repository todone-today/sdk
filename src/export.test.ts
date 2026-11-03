import { test } from "node:test";
import assert from "node:assert/strict";
import { toCSV } from "./export.ts";
import { parse } from "./tasks.ts";

test("CSV has a row per task and step, quoting what needs it", () => {
  const tasks = parse(
    '- [ ] Plan, then "ship" ⏫ ⏱ 1h 📅 2026-11-02 ⏰ 09:30\n  - [x] Outline\n- [ ] Stretch 🔁 every day\n',
  );
  const csv = toCSV({
    exportedAt: "2026-11-01T00:00:00Z",
    workspaces: [{ name: "Personal", team: false, lists: [{ name: "Work", ideas: false, tasks }] }],
  });
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[1], 'Personal,Work,"Plan, then ""ship""",,no,2026-11-02,09:30,60,high,');
  assert.equal(lines[2], 'Personal,Work,Outline,"Plan, then ""ship""",yes,,,,,');
  assert.equal(lines[3], "Personal,Work,Stretch,,no,,,,,every day");
});
