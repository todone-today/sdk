import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, planPrompt } from "./plan.ts";

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
