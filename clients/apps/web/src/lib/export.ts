// Everything a person can see, as one file: JSON keeps it all, CSV has a row per task (steps included).
import type { Task } from "./tasks.ts";

export type Export = {
  exportedAt: string;
  workspaces: { name: string; team: boolean; lists: { name: string; ideas: boolean; tasks: Task[] }[] }[];
};

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(data: Export): string {
  const head = ["workspace", "list", "task", "step of", "done", "due", "time", "estimate (min)", "priority", "repeat"];
  const pri = ["", "high", "medium", "low"];
  const rows = data.workspaces.flatMap((w) =>
    w.lists.flatMap((l) =>
      l.tasks.flatMap((t) =>
        [t, ...t.sub].map((x) => [
          w.name,
          l.ideas ? `${l.name} (ideas)` : l.name,
          x.title,
          x === t ? "" : t.title,
          x.done ? "yes" : "no",
          x.due,
          x.at,
          x.est,
          pri[x.pri ?? 0],
          x.rep,
        ]),
      ),
    ),
  );
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
