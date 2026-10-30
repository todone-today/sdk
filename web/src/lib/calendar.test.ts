import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, addMonths, lanes, shiftMonths, monthCells, toClock, toMinutes, weekStart } from "./calendar.ts";

test("walks dates across month and year ends", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-01");
  assert.equal(weekStart("2026-11-01"), "2026-10-26"); // a Sunday belongs to the week starting Monday
  assert.equal(toClock(toMinutes("09:45") + 30), "10:15");
});

test("month grid is whole weeks starting Monday", () => {
  const cells = monthCells("2026-10-30");
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0], "2026-09-28");
  assert.ok(cells.includes("2026-10-31"));
});

test("overlapping blocks share lanes, separate ones don't", () => {
  const r = lanes([
    { id: "a", start: 540, end: 600 },
    { id: "b", start: 570, end: 630 },
    { id: "c", start: 600, end: 660 },
    { id: "d", start: 700, end: 720 },
  ]);
  const by = Object.fromEntries(r.map((x) => [x.id, [x.lane, x.lanes]]));
  assert.deepEqual(by, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
});

test("shifts by months and years, keeping the day inside the month", () => {
  assert.equal(shiftMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(shiftMonths("2026-10-31", 12), "2027-10-31");
  assert.equal(shiftMonths("2028-02-29", 12), "2029-02-28");
});
