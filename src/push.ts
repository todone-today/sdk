// Reminders with the app closed, still end to end: while todone is open it plans the coming week's reminders and
// seals each one for a receiving browser (Web Push message encryption, RFC 8291, "aes128gcm"). The server keeps only
// the sealed bytes and a send time, and hands them to the browser's push service then; only that browser can open them.
import { DIGEST_AT, dueNotes, type Item, type Note } from "./reminders.ts";

export type PushKeys = { p256dh: string; auth: string }; // base64url, as in PushSubscription.toJSON().keys
export type Planned = Note & { at: number }; // `at`: when to show it, ms since 1970

const AHEAD = 15 * 60_000;
const enc = new TextEncoder();
export const toB64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const fromB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The reminders from now through the next `days` days, in this device's time zone: a nudge 15 minutes before each
// task's time and the 08:00 summary, worded as the open app words them (same tags, so a browser shows each once).
export function plan(items: Item[], now: Date, days = 7): Planned[] {
  const out: Planned[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const d = iso(day);
    const digest = dueNotes(items, d, DIGEST_AT).find((n) => n.key.startsWith("d:"));
    // Later days get one only if something's due then: a daily "2 late" from a guess would just nag.
    if (digest && (i === 0 || items.some((x) => !x.task.done && x.task.due === d)))
      out.push({ ...digest, at: +new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, DIGEST_AT) });
    for (const { task: t, list } of items)
      if (!t.done && t.due === d && t.at)
        out.push({
          key: `t:${t.id}:${t.due}:${t.at}`,
          title: t.title,
          body: `At ${t.at} · ${list}`,
          at: +new Date(`${d}T${t.at}`) - AHEAD,
        });
  }
  // ponytail: 200 a device a week is plenty for one person; raise with the server's cap if anyone hits it.
  return out
    .filter((n) => n.at > +now)
    .sort((a, b) => a.at - b.at)
    .slice(0, 200);
}

const hkdf = async (salt: Uint8Array, ikm: Uint8Array | ArrayBuffer, info: Uint8Array, bytes: number) =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
      await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]),
      bytes * 8,
    ),
  );
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) out.set(p, (i += p.length) - p.length);
  return out;
};

// One push message body, sealed for the browser whose keys these are. `fixed` is for tests (RFC 8291's example).
export async function seal(
  keys: PushKeys,
  text: string,
  fixed?: { salt: Uint8Array; local: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublic = fromB64u(keys.p256dh);
  const auth = fromB64u(keys.auth);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const local =
    fixed?.local ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const theirs = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, local.privateKey, 256);
  const ikm = await hkdf(auth, shared, cat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      cat(enc.encode(text), new Uint8Array([2])) as BufferSource, // 2: the last (only) record
    ),
  );
  const rs = 4096;
  if (body.length > rs) throw new Error("That reminder is too long to send.");
  return cat(salt, new Uint8Array([0, 0, rs >> 8, 0]), new Uint8Array([asPublic.length]), asPublic, body);
}
