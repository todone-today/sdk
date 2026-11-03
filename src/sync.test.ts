import { test } from "node:test";
import assert from "node:assert/strict";
import { type Link, type Service, applyLocal, fingerprint, plan } from "./sync.ts";
import type { List, Task } from "./tasks.ts";

const cal: Service = { fields: ["title", "due", "at", "est"], include: (t) => !!t.due && !t.done, onDelete: "unschedule" };
const notion: Service = { fields: ["title", "done", "due", "at"], include: () => true, onDelete: "delete" };
const task = (id: string, x: Partial<Task> = {}): Task => ({ id, title: id, done: false, sub: [], ...x });
const list = (tasks: Task[]): List => ({ id: "L", name: "work", tasks, updated: 0, version: 1 });
const link = (t: Task, svc: Service, remoteId = `r-${t.id}`): Link => ({
  taskId: t.id,
  remoteId,
  hash: fingerprint(t, svc.fields),
});
let n = 0;
const id = () => `new${n++}`;

test("new local tasks are created remotely, unchanged ones left alone", () => {
  const a = task("a", { due: "2026-11-02" });
  const b = task("b", { due: "2026-11-03" });
  const p = plan([list([a, b, task("undated")])], [link(b, cal)], [], cal, id);
  assert.deepEqual(
    p.creates.map((c) => c.task.id),
    ["a"],
  );
  assert.equal(p.updates.length + p.removes.length + p.edits.size, 0);
});

test("a local edit is pushed; a remote edit is pulled; remote wins when both changed", () => {
  const a = task("a", { due: "2026-11-02" });
  const old = link(a, cal);
  const moved = { ...a, at: "10:00", est: 60 };
  let p = plan([list([moved])], [old], [], cal, id);
  assert.equal(p.updates[0].task.at, "10:00");

  p = plan([list([a])], [old], [{ id: "r-a", title: "a", due: "2026-11-05", at: "09:00", est: 30 }], cal, id);
  assert.equal(p.edits.get("a")?.due, "2026-11-05");
  assert.equal(p.updates.length, 0);

  p = plan([list([moved])], [old], [{ id: "r-a", title: "renamed", due: "2026-11-02" }], cal, id);
  assert.equal(p.edits.get("a")?.title, "renamed");
});

test("deletes follow the service's meaning", () => {
  const a = task("a", { due: "2026-11-02", at: "10:00" });
  let p = plan([list([a])], [link(a, cal)], [{ id: "r-a", title: "a", deleted: true }], cal, id);
  assert.deepEqual([p.edits.get("a")?.due, p.edits.get("a")?.at], [undefined, undefined]);
  p = plan([list([a])], [link(a, notion)], [{ id: "r-a", title: "a", deleted: true }], notion, id);
  assert.equal(p.edits.get("a"), null);
  // Deleted here, or no longer belongs there (done tasks leave the calendar): removed remotely.
  p = plan([list([{ ...a, done: true }])], [link(a, cal)], [], cal, id);
  assert.deepEqual(p.removes, ["r-a"]);
  p = plan([list([])], [link(a, cal)], [], cal, id);
  assert.deepEqual(p.removes, ["r-a"]);
});

test("remote items we don't know become tasks in the right list", () => {
  const p = plan([list([])], [], [{ id: "r9", title: "From Notion", done: true, list: "work" }], notion, id);
  assert.equal(p.adds[0].task.title, "From Notion");
  assert.equal(p.adds[0].task.done, true);
  const changed = applyLocal([list([])], p, "Inbox");
  assert.equal(changed[0].tasks[0].title, "From Notion");
  assert.equal(p.links[0].remoteId, "r9");
});

test("Google events map to tasks and back", async () => {
  const { eventTimes, fromEvent } = await import("./integrations.ts");
  const t = task("a", { due: "2026-11-02", at: "23:30", est: 60 });
  assert.deepEqual(eventTimes(t, "Asia/Kolkata").end, { dateTime: "2026-11-03T00:30:00", timeZone: "Asia/Kolkata" });
  assert.deepEqual(eventTimes(task("b", { due: "2026-11-02" }), "UTC"), {
    start: { date: "2026-11-02" },
    end: { date: "2026-11-03" },
  });
  const r = fromEvent({
    id: "e1",
    status: "confirmed",
    summary: " Review ",
    start: { dateTime: "2026-11-02T10:00:00+05:30" },
    end: { dateTime: "2026-11-02T11:30:00+05:30" },
  });
  assert.deepEqual(r, { id: "e1", title: "Review", due: "2026-11-02", at: "10:00", est: 90 });
  assert.equal(fromEvent({ id: "e2", status: "cancelled" })?.deleted, true);
  assert.equal(
    fromEvent({ id: "e3", status: "confirmed", summary: "x", recurringEventId: "r", start: { date: "2026-11-02" } }),
    null,
  );
});
