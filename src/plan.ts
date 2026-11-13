// What an AI answers when asked to turn plans into todone: lists of tasks, plus goals and rewards, in one Markdown
// format. The same prompt serves "Ask todone" (the server asks Gemini) and the copy-paste "Use your own AI".
//
//   ## Work
//   - [ ] Call Rahul about the homepage ⏫ ⏱ 15m 💪 xs 📅 2026-11-14 ⏰ 17:00
//     > The homepage can't go live until he signs off.
//   ## Goals
//   - Read most days | habit | 5 a week | list: Personal
//   - Ship the side project | outcome | by 2026-12-31
//   - Save money | target | 0 → 50000 ₹
//   - Drink water | daily | 8 glasses
//   ## Rewards
//   - Movie night | 300 XP
//   ## Questions
//   - When is the client demo?
//
// To work with tasks someone already has, the AI first names the lists it needs (## Needs); once they agree, the app
// sends those lists, each task numbered ([#3]), and the answer can change them:
//
//   ## Changes
//   - done #3
//   - delete #5
//   - move #4 → Work
//   - edit #2 | Call Rahul about the homepage ⏫ 📅 2026-11-14
import { EFFORT_XP, validGoalItems, type Goal, type Reward } from "./goals.ts";
import { parseLists, serialize, type Task } from "./tasks.ts";

// A goal as suggested: `listName` is the list it goes with, by name (the app links it once the list exists).
export type PlanGoal = Omit<Goal, "list"> & { listName?: string };
// A change to a task someone already has, by its number in what was sent. `edit` carries the fields to set.
export type Change = { ref: number; why?: string } & (
  | { op: "done" }
  | { op: "delete" }
  | { op: "move"; to: string }
  | { op: "edit"; set: Partial<Pick<Task, "title" | "due" | "at" | "est" | "pri" | "effort">> }
);
// `questions`: what the AI needs to know to do better; it still suggests what it can. `needs`: lists it must read
// first (by name); `changes`: to tasks in lists it was given.
export type Plan = {
  lists: { name: string | null; tasks: Task[] }[];
  goals: PlanGoal[];
  rewards: Reward[];
  questions: string[];
  needs: string[];
  changes: Change[];
};
export type OpenList = { name: string; md: string }; // a list the person let the AI read, numbered (see numbered())

const GOALS = /^goals?$/i;
const REWARDS = /^rewards?$/i;
const QUESTIONS = /^questions?$/i;
const NEEDS = /^needs?$/i;
const CHANGES = /^changes?$/i;

// One "- delete #3" line as a change; anything else is dropped.
function changeLine(line: string): Change | null {
  const m = /^\s*-\s*(done|delete|move|edit)\s+#(\d+)\s*(.*)$/i.exec(line);
  if (!m) return null;
  const op = m[1].toLowerCase(), ref = +m[2], rest = m[3].trim();
  if (op === "done" || op === "delete") return { ref, op } as Change;
  if (op === "move") {
    const to = rest.replace(/^(→|->|to)\s*/i, "").trim().slice(0, 60);
    return to ? { ref, op, to } : null;
  }
  const t = parseLists(`- [ ] ${rest.replace(/^\|\s*/, "")}`)[0]?.tasks[0];
  if (!t) return null;
  const set: Extract<Change, { op: "edit" }>["set"] = {};
  if (t.title) set.title = t.title.slice(0, 300);
  for (const k of ["due", "at", "est", "pri", "effort"] as const) if (t[k] !== undefined) (set as Record<string, unknown>)[k] = t[k];
  return Object.keys(set).length ? { ref, op: "edit", set } : null;
}

// Tasks as sent to the AI to work with: the usual Markdown, each line numbered ([#n]), notes as "> " lines. `refs[n]`
// is the task's id. Numbers carry on across lists (pass `from`).
export function numbered(tasks: Task[], from = 1) {
  const refs: Record<number, string> = {};
  let n = from;
  const line = (t: Task, indent: string) => {
    refs[n] = t.id;
    const out = [`${indent}${serialize([{ ...t, sub: [] }]).trim()} [#${n++}]`];
    if (t.note) out.push(`${indent}  > ${t.note.replace(/\s+/g, " ").slice(0, 400)}`);
    return out;
  };
  const md = tasks.flatMap((t) => [...line(t, ""), ...t.sub.flatMap((u) => line(u, "  "))]).join("\n");
  return { md, refs, next: n };
}
const TASK = /^\s*- \[[ xX]\] /;
const WHY = /^\s*>\s*(.+)$/;

// Tasks with the "> why" line under each kept as its note: the AI's reason for it.
function tasksWithWhy(md: string) {
  const why: (string | undefined)[] = [];
  const kept: string[] = [];
  for (const line of md.split("\n")) {
    const w = WHY.exec(line);
    if (w && why.length) why[why.length - 1] ??= w[1].trim().slice(0, 300);
    else {
      if (TASK.test(line)) why.push(undefined);
      kept.push(line);
    }
  }
  const lists = parseLists(kept.join("\n"));
  let i = 0;
  for (const t of lists.flatMap((l) => l.tasks.flatMap((t) => [t, ...t.sub]))) {
    const w = why[i++];
    if (w) t.note = w;
  }
  return lists;
}
const num = (s: string) => {
  const n = Number(s.replace(/[,_\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// One "- title | kind | how | list: Name" line as a goal, or null when it doesn't read cleanly (never guessed).
function goalLine(line: string, id: string, now: number): PlanGoal | null {
  const parts = line.replace(/^\s*-\s*(\[[ xX]\]\s*)?/, "").split("|").map((p) => p.trim());
  const [title, kind, how = "", ...rest] = parts;
  if (!title || title.length > 120) return null;
  const listName = rest.find((p) => /^list:/i.test(p))?.replace(/^list:\s*/i, "").slice(0, 60) || undefined;
  const g: PlanGoal = { t: "goal", id, title, kind: "habit", created: now, ...(listName ? { listName } : {}) };
  const k = (kind ?? "").toLowerCase();
  if (k === "habit") {
    const n = /(\d)\s*(?:x|×|times)?\s*(?:a|per|\/)\s*week/i.exec(how) ?? /^(\d)$/.exec(how);
    const perWeek = n ? +n[1] : 0;
    if (perWeek < 1 || perWeek > 7) return null;
    return { ...g, kind: "habit", perWeek };
  }
  if (k === "outcome") {
    const by = /(\d{4}-\d{2}-\d{2})/.exec(how)?.[1];
    return { ...g, kind: "outcome", ...(by ? { by } : {}) };
  }
  if (k === "target") {
    const m = /^(-?[\d.,]+)\s*(?:→|->|to)\s*(-?[\d.,]+)\s*(.*)$/.exec(how);
    const start = m && num(m[1]);
    const target = m && num(m[2]);
    if (start === null || target === null || start === target) return null;
    return { ...g, kind: "target", start, target, ...(m![3].trim() ? { unit: m![3].trim().slice(0, 20) } : {}) };
  }
  if (k === "daily") {
    const m = /^([\d.,]+)\s*(.*)$/.exec(how);
    const target = m && num(m[1]);
    if (!target || target <= 0) return null;
    return { ...g, kind: "daily", target, ...(m![2].trim() ? { unit: m![2].replace(/\s*(a|per)\s*day$/i, "").trim().slice(0, 20) } : {}) };
  }
  return null;
}

function rewardLine(line: string, id: string): Reward | null {
  const [title, cost] = line.replace(/^\s*-\s*(\[[ xX]\]\s*)?/, "").split("|").map((p) => p.trim());
  const xp = cost ? num(cost.replace(/xp/i, "")) : null;
  if (!title || title.length > 80 || !xp || !Number.isInteger(xp) || xp < 1 || xp > 100_000) return null;
  return { t: "reward", id, title, cost: xp };
}

// The answer split into task lists (by heading, as Import with AI always has), goals and rewards. Goal and reward
// lines that don't fit the format are dropped. `id` makes ids for goals and rewards.
export function parsePlan(md: string, id: () => string, now = Date.now()): Plan {
  const sections: { name: string | null; text: string }[] = [{ name: null, text: "" }];
  for (const line of md.split("\n")) {
    const h = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) sections.push({ name: h[1].trim(), text: "" });
    else sections[sections.length - 1].text += line + "\n";
  }
  const goals: PlanGoal[] = [];
  const rewards: Reward[] = [];
  const questions: string[] = [];
  const needs: string[] = [];
  const changes: Change[] = [];
  let tasks = "";
  for (const s of sections) {
    const lines = s.text.split("\n").filter((l) => /^\s*-\s+\S/.test(l));
    if (s.name && GOALS.test(s.name)) for (const l of lines) goals.push(...[goalLine(l, id(), now)].filter((g) => g !== null));
    else if (s.name && REWARDS.test(s.name)) for (const l of lines) rewards.push(...[rewardLine(l, id())].filter((r) => r !== null));
    else if (s.name && NEEDS.test(s.name)) for (const l of lines) needs.push(l.replace(/^\s*-\s*/, "").trim().slice(0, 60));
    else if (s.name && CHANGES.test(s.name))
      for (const l of s.text.split("\n")) {
        const w = WHY.exec(l);
        const last = changes[changes.length - 1];
        if (w && last && !last.why) last.why = w[1].trim().slice(0, 200);
        else if (!w) changes.push(...[changeLine(l)].filter((c) => c !== null));
      }
    else if (s.name && QUESTIONS.test(s.name))
      for (const l of lines) questions.push(l.replace(/^\s*-\s*(\[[ xX]\]\s*)?/, "").trim().slice(0, 200));
    else tasks += (s.name ? `## ${s.name}\n` : "") + s.text;
  }
  // Same checks as stored goals and rewards; anything that wouldn't save is left out.
  const ok = <T extends PlanGoal | Reward>(x: T) => validGoalItems([{ ...x, listName: undefined }]);
  return {
    lists: tasksWithWhy(tasks),
    goals: goals.filter(ok).slice(0, 20),
    rewards: rewards.filter(ok).slice(0, 20),
    questions: questions.filter(Boolean).slice(0, 3),
    needs: needs.filter(Boolean).slice(0, 3),
    changes: changes.slice(0, 200),
  };
}

// The prompt: what to make and the exact format, with what the person already has so names match.
export function planPrompt(c: {
  today: string; // YYYY-MM-DD
  weekday: string; // "Friday"
  lists: string[];
  goals?: string[];
  rewards?: string[];
  open?: OpenList[]; // lists the person let it read, to change
}) {
  const xp = Object.values(EFFORT_XP).join("/");
  return `You plan my work. Read what I describe below (it may be typed or spoken, in English, Hindi or Hinglish), work
out what I actually need to do, and turn it into todone: todo lists, plus goals and rewards when they fit. Reply with
only this format:

## List name
- [ ] Task name ⏫ ⏱ 30m 💪 m 📅 2026-11-02 ⏰ 09:30
  > One short line: why this task, or what it unblocks.
  - [ ] A step (indent two spaces, one level only) ⏱ 15m
## Goals
- Goal title | habit | 5 a week | list: List name
- Goal title | outcome | by 2026-12-31
- Goal title | target | 0 → 50000 ₹
- Goal title | daily | 8 glasses
## Rewards
- Reward title | 300 XP
## Questions
- A short question

How to think:
- Don't copy my words as tasks. Work out the real next actions behind them. Each task is one clear action that starts
  with a verb ("Call Rahul about the homepage", not "Rahul homepage"). Split a big or vague thing into a task with 2–5
  steps, and add a step I'd obviously need first (to book a trip: compare flights, book the hotel). Merge duplicates.
  Don't pad: no tasks I didn't ask for or clearly need.
- Write every title, step, reason and question in plain, natural English, even when I spoke Hindi or Hinglish.
  Translate the meaning, not word for word; keep names of people, places and things as they are.
- Under each task, a "> " line gives the reason in under 15 words. Leave it out when the reason is obvious.

Details on each task (give your best judgement; I can change them later):
- Priority on every task: ⏫ high (urgent or important: deadlines soon, other people waiting, money or health),
  🔼 medium, 🔽 low (nice to have, someday).
- ⏱ how long it takes (15m, 30m, 1h, 1h30m, 2h) and 💪 how hard it is (xs, s, m, l, xl), on every task.
- 📅 the day it's due, as YYYY-MM-DD. Today is ${c.weekday} ${c.today}: work out "tomorrow", "kal", "Friday", "next
  week" from that. Only when I gave a time frame or it clearly follows from one ("urgent", "aaj", "before the
  demo on Friday"). Never invent a date for something with no time frame.
- ⏰ a start time, 24-hour HH:MM, only if I gave a time.
- Write "- [x]" for anything I said is already done.

Where things go:
- Put each task under a "## List name" line. ${
    c.lists.length
      ? `My lists are: ${c.lists.join(", ")}. Use one of those names exactly when a task fits it; otherwise make a short new list name.`
      : "Make short list names that group the tasks sensibly."
  } Never name a list "Goals", "Rewards", "Questions", "Needs" or "Changes".
- "## Goals" only for something I want to keep at or reach over time, never a one-off task (that stays a task) or a
  treat (that's a reward). Each thing I said goes in one place only. A goal is one of: habit (how many days a week,
  1–7), outcome (something to finish, optionally by a date), target (a number to get from → to, with a unit), daily
  (an amount every day, with a unit). "list:" links it to one of the lists, optional.${
    c.goals?.length ? ` Goals I already have (don't repeat them): ${c.goals.join(", ")}.` : ""
  }
- "## Rewards" only for treats I mention. Cost is in XP: a finished task earns about 5–30 XP (more for longer, harder
  ones; effort sizes add ${xp}), so a small treat is about 50–150 XP and a big one 500+.${
    c.rewards?.length ? ` Rewards I already have: ${c.rewards.join(", ")}.` : ""
  }
- "## Questions": up to 3, only when an answer would really change the tasks (a deadline I mentioned without a date,
  who something is for, which of two things I meant). Still give your best tasks for everything else. If what I said
  is too vague to plan at all, reply with only Questions.
${
    c.open?.length
      ? `- I've shared what's in ${c.open.map((l) => `"${l.name}"`).join(", ")} below; each task has a number like [#3]. To
  change those tasks, add "## Changes", one per line: "- done #3", "- delete #3", "- move #3 → List name" (one of my
  lists, or a new name), or "- edit #3 | New title ⏫ ⏱ 30m 💪 s 📅 2026-11-14 ⏰ 09:30" (only the parts that change,
  title first if it changes). Under each, a "  > " line says why in under 12 words. Do the work yourself
  with Changes: never add a task like "Review the list" or "Clean up X". "Clean up" means delete what's done or no
  longer needed, merge duplicates (keep one, delete the rest), fix unclear titles, and add missing priority, time and
  effort. Only touch the lists I shared, and only what I asked about: no new goals or rewards unless I ask. New
  tasks still go under "## List name".`
      : `- If what I ask needs the tasks already in one of my lists (clean up, sort, review, finish, delete, move or
  reschedule what's there), reply with only "## Needs" and that list's name on a "- " line (up to 3), and nothing
  else: I'll be asked to share it, then you'll get its tasks.`
  }
- No other headings, numbers, notes or code fences.
${(c.open ?? []).map((l) => `\nWhat's in "${l.name}" now:\n${l.md}\n`).join("")}
Here's what I need:
`;
}

