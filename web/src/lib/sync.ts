// Two-way sync with an outside service (Notion, Google Calendar), as a pure plan the caller then carries out.
// Each synced task has a mapping to its remote item plus a fingerprint of the fields as of the last sync,
// so either side's edits are noticed without timestamps. When both sides changed, the remote edit wins.
import type { List, Task } from "./tasks.ts";

export type Remote = {
  id: string;
  title: string;
  done?: boolean;
  due?: string;
  at?: string;
  est?: number;
  list?: string; // which list a new remote item belongs in, when the service knows
  deleted?: boolean;
};
export type Link = { taskId: string; remoteId: string; hash: string };

export type Service = {
  fields: (keyof Remote & keyof Task)[]; // what the service carries
  include: (t: Task) => boolean; // which tasks belong on the service
  onDelete: "delete" | "unschedule"; // what deleting the remote item does to the task
};

export type Plan = {
  edits: Map<string, Task | null>; // taskId -> new task, or null to delete
  adds: { list?: string; task: Task; remoteId: string }[]; // remote items that become tasks
  creates: { task: Task; list: string }[];
  updates: { remoteId: string; task: Task; list: string }[];
  removes: string[];
  links: Link[]; // the mapping after the sync (creates are linked by the caller once they have ids)
};

export const fingerprint = (x: Partial<Remote>, fields: Service["fields"]) =>
  JSON.stringify(fields.map((f) => (f === "est" ? (x.at ? (x.est ?? 30) : null) : (x[f] ?? null))));

export function plan(lists: List[], links: Link[], remote: Remote[], svc: Service, newId: () => string): Plan {
  const tasks = new Map<string, { task: Task; list: string }>();
  for (const l of lists) for (const t of l.tasks.flatMap((t) => [t, ...t.sub])) tasks.set(t.id, { task: t, list: l.name });
  const byRemote = new Map(remote.map((r) => [r.id, r]));
  const p: Plan = { edits: new Map(), adds: [], creates: [], updates: [], removes: [], links: [] };
  const linked = new Set<string>();

  for (const link of links) {
    linked.add(link.remoteId);
    const here = tasks.get(link.taskId);
    const r = byRemote.get(link.remoteId);
    if (r?.deleted) {
      if (here) p.edits.set(link.taskId, svc.onDelete === "delete" ? null : { ...here.task, due: undefined, at: undefined });
      continue;
    }
    if (!here || !svc.include(here.task)) {
      p.removes.push(link.remoteId);
      continue;
    }
    if (r && fingerprint(r, svc.fields) !== link.hash) {
      const next = { ...here.task };
      for (const f of svc.fields) (next as Record<string, unknown>)[f] = r[f];
      p.edits.set(link.taskId, next);
      p.links.push({ ...link, hash: fingerprint(next, svc.fields) });
      continue;
    }
    const hash = fingerprint(here.task, svc.fields);
    if (hash !== link.hash) p.updates.push({ remoteId: link.remoteId, task: here.task, list: here.list });
    p.links.push({ ...link, hash });
  }

  for (const r of remote) {
    if (linked.has(r.id) || r.deleted) continue;
    const task: Task = { id: newId(), title: r.title, done: !!r.done, sub: [] };
    for (const f of svc.fields) (task as Record<string, unknown>)[f] = r[f] ?? (f === "done" ? false : undefined);
    p.adds.push({ list: r.list, task, remoteId: r.id });
    p.links.push({ taskId: task.id, remoteId: r.id, hash: fingerprint(task, svc.fields) });
  }

  const done = new Set(links.map((l) => l.taskId));
  for (const { task, list } of tasks.values()) if (!done.has(task.id) && svc.include(task)) p.creates.push({ task, list });
  return p;
}

// Applies a plan's edits and adds to lists; returns only the lists that changed.
export function applyLocal(lists: List[], p: Plan, fallback: string): List[] {
  const changed = new Set<string>();
  const edit = (ts: Task[], listId: string): Task[] =>
    ts.flatMap((t) => {
      if (p.edits.has(t.id)) {
        changed.add(listId);
        const n = p.edits.get(t.id);
        return n ? [{ ...n, sub: edit(t.sub, listId) }] : [];
      }
      return [{ ...t, sub: edit(t.sub, listId) }];
    });
  const out = lists.map((l) => ({ ...l, tasks: edit(l.tasks, l.id) }));
  for (const a of p.adds) {
    const l = out.find((x) => x.name === a.list) ?? out.find((x) => x.name === fallback) ?? out[0];
    l.tasks = [...l.tasks, a.task];
    changed.add(l.id);
  }
  return out.filter((l) => changed.has(l.id));
}
