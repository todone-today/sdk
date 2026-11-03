import { test } from "node:test";
import assert from "node:assert/strict";
import { changes, toICS, validDiscordWebhook } from "./integrations.ts";
import { parse } from "./tasks.ts";

test("calendar feed has open dated tasks as all-day events", () => {
  const tasks = parse("- [ ] Ship, then rest; ok 📅 2026-12-31\n  - [x] done one 📅 2026-11-01\n- [ ] no date\n");
  const ics = toICS("Acme", [{ name: "roadmap", tasks }], new Date("2026-10-30T12:00:00Z"));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n/);
  assert.match(ics, /SUMMARY:Ship\\, then rest\\; ok\r\n/);
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75));
});

test("timed tasks become timed events lasting their estimate", () => {
  const tasks = parse("- [ ] Review ⏱ 1h30m 📅 2026-11-02 ⏰ 23:00\n- [ ] Call 📅 2026-11-03 ⏰ 09:00\n");
  const ics = toICS("x", [{ name: "l", tasks }]);
  assert.match(ics, /DTSTART:20261102T230000\r\nDTEND:20261103T003000\r\n/);
  assert.match(ics, /DTSTART:20261103T090000\r\nDTEND:20261103T093000\r\n/);
});

test("long lines fold under 75 octets", () => {
  const tasks = parse(`- [ ] ${"é".repeat(100)} 📅 2026-12-01\n`);
  const lines = toICS("x", [{ name: "l", tasks }]).split("\r\n");
  assert.ok(lines.every((l) => Buffer.byteLength(l) <= 75));
  assert.ok(lines.some((l) => l.startsWith(" ")));
});

test("reports added and newly finished tasks", () => {
  const before = parse("- [ ] a\n- [x] b\n");
  const after = structuredClone(before);
  after[0].done = true;
  after.push({ id: "new", title: "c", done: false, sub: [] });
  assert.deepEqual(changes(before, after), { added: ["c"], done: ["a"] });
});

test("only Discord webhook URLs are accepted", () => {
  assert.ok(validDiscordWebhook("https://discord.com/api/webhooks/123/abc-DEF_9"));
  assert.ok(!validDiscordWebhook("https://discord.com.evil.io/api/webhooks/123/abc"));
  assert.ok(!validDiscordWebhook("http://discord.com/api/webhooks/123/abc"));
  assert.ok(!validDiscordWebhook("https://169.254.169.254/api/webhooks/1/a"));
});
