import { test } from "node:test";
import assert from "node:assert/strict";
import { numbered, parsePlan, planPrompt } from "./plan.ts";

let n = 0;
const id = () => `id${String(++n).padStart(6, "0")}`;

const ANSWER = `## Work
- [ ] Call Rahul about the homepage 📅 2026-11-14 ⏰ 17:00
- [ ] Kal content approve karwana hai ⏱ 30m
## Goals
- Read most days | habit | 5 a week | list: Personal
- Ship the side project | outcome | by 2026-12-31
- Save money | target | 0 → 50,000 ₹
- Drink water | daily | 8 glasses a day
- Be happier | vibes | always
- Gym | habit | 9 a week
## Rewards
- Movie night | 300 XP
- Free stuff | 0 XP
- [ ] Nice dinner | 800
## Personal
- [ ] Buy milk
`;

test("parsePlan: lists, every goal kind, rewards; bad lines dropped", () => {
  const p = parsePlan(ANSWER, id, 1);
  assert.deepEqual(
    p.lists.map((l) => [l.name, l.tasks.map((t) => t.title)]),
    [
      ["Work", ["Call Rahul about the homepage", "Kal content approve karwana hai"]],
      ["Personal", ["Buy milk"]],
    ],
  );
  assert.equal(p.lists[0].tasks[0].at, "17:00");
  const g = Object.fromEntries(p.goals.map((x) => [x.title, x]));
  assert.deepEqual(Object.keys(g), ["Read most days", "Ship the side project", "Save money", "Drink water"]);
  assert.equal(g["Read most days"].perWeek, 5);
  assert.equal(g["Read most days"].listName, "Personal");
  assert.equal(g["Ship the side project"].by, "2026-12-31");
  assert.deepEqual([g["Save money"].start, g["Save money"].target, g["Save money"].unit], [0, 50000, "₹"]);
  assert.deepEqual([g["Drink water"].target, g["Drink water"].unit], [8, "glasses"]);
  assert.deepEqual(
    p.rewards.map((r) => [r.title, r.cost]),
    [
      ["Movie night", 300],
      ["Nice dinner", 800],
    ],
  );
});

test("parsePlan: plain Import with AI answers still work", () => {
  const p = parsePlan("- [ ] Loose task\n## Trip\n- [ ] Pack\n  - [ ] Chargers\n", id);
  assert.deepEqual(
    p.lists.map((l) => [l.name, l.tasks.length]),
    [
      [null, 1],
      ["Trip", 1],
    ],
  );
  assert.equal(p.lists[1].tasks[0].sub[0].title, "Chargers");
  assert.deepEqual([p.goals, p.rewards], [[], []]);
});

test("planPrompt names the lists, goals and rewards it should match, and today's date", () => {
  const s = planPrompt({ today: "2026-11-13", weekday: "Friday", lists: ["Work", "Ghar"], goals: ["Read"], rewards: ["Movie night"] });
  assert.match(s, /My lists are: Work, Ghar/);
  assert.match(s, /Today is Friday 2026-11-13/);
  assert.match(s, /don't repeat them\): Read/);
  assert.match(s, /Never name a list "Goals"/);
});

test("parsePlan: a task's \"> why\" line becomes its note (steps too); Questions are kept, up to 3", () => {
  const p = parsePlan(
    "## Work\n- [ ] Call Rahul ⏫ ⏱ 15m 💪 xs\n  > He signs off the homepage.\n  - [ ] Find his number\n    > Lost it.\n- [ ] Plain one\n## Questions\n- When is the demo?\n- Which client?\n- A?\n- B?\n",
    id,
  );
  const [call, plain] = p.lists[0].tasks;
  assert.deepEqual([call.note, call.pri, call.est, call.effort], ["He signs off the homepage.", 1, 15, "xs"]);
  assert.equal(call.sub[0].note, "Lost it.");
  assert.equal(plain.note, undefined);
  assert.deepEqual(p.questions, ["When is the demo?", "Which client?", "A?"]);
  assert.deepEqual(parsePlan("## Questions\n- What do you mean?\n", id).questions, ["What do you mean?"]);
});

test("parsePlan: Needs names lists to read; Changes act on numbered tasks, with a reason each", () => {
  assert.deepEqual(parsePlan("## Needs\n- Personal\n", id).needs, ["Personal"]);
  const p = parsePlan(
    "## Changes\n- done #3\n  > Finished last week.\n- delete #5\n- move #4 → Work\n- edit #2 | Call Rahul ⏫ 📅 2026-11-14\n- edit #9 | 📅 2026-11-20\n- explode #1\n- delete 7\n## Work\n- [ ] New one\n",
    id,
  );
  assert.deepEqual(p.changes, [
    { ref: 3, op: "done", why: "Finished last week." },
    { ref: 5, op: "delete" },
    { ref: 4, op: "move", to: "Work" },
    { ref: 2, op: "edit", set: { title: "Call Rahul", due: "2026-11-14", pri: 1 } },
    { ref: 9, op: "edit", set: { due: "2026-11-20" } },
  ]);
  assert.equal(p.lists[0].tasks[0].title, "New one");
});

test("numbered: each task and step gets a number, notes go along, and planPrompt includes the lists", () => {
  const tasks = [
    { id: "a", title: "Pack", done: false, note: "for Goa\nlight", sub: [{ id: "b", title: "Chargers", done: true, sub: [] }] },
    { id: "c", title: "Book hotel", done: false, due: "2026-12-01", sub: [] },
  ];
  const { md, refs, next } = numbered(tasks, 4);
  assert.equal(md, "- [ ] Pack [#4]\n  > for Goa light\n  - [x] Chargers [#5]\n- [ ] Book hotel 📅 2026-12-01 [#6]");
  assert.deepEqual([refs, next], [{ 4: "a", 5: "b", 6: "c" }, 7]);
  const s = planPrompt({ today: "2026-11-13", weekday: "Friday", lists: ["Trip"], open: [{ name: "Trip", md }] });
  assert.match(s, /What's in "Trip" now:\n- \[ \] Pack \[#4\]/);
  assert.match(s, /## Changes/);
  assert.doesNotMatch(s, /reply with only "## Needs"/);
  assert.match(planPrompt({ today: "2026-11-13", weekday: "Friday", lists: ["Trip"] }), /reply with only "## Needs"/);
});
