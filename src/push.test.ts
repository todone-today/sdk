import { test } from "node:test";
import assert from "node:assert/strict";
import { fromB64u, plan, seal, toB64u } from "./push.ts";
import { parse } from "./tasks.ts";

// RFC 8291, Appendix A.
const A = {
  text: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  sealed:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};
const jwk = (pub: string, d: string): JsonWebKey => {
  const p = fromB64u(pub);
  return { kty: "EC", crv: "P-256", x: toB64u(p.slice(1, 33)), y: toB64u(p.slice(33, 65)), d };
};

test("seals a push message exactly as RFC 8291's example", async () => {
  const ecdh = { name: "ECDH", namedCurve: "P-256" };
  const priv = jwk(A.asPublic, A.asPrivate);
  const local = {
    privateKey: await crypto.subtle.importKey("jwk", priv, ecdh, false, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("jwk", { ...priv, d: undefined }, ecdh, true, []),
  };
  const out = await seal({ p256dh: A.uaPublic, auth: A.auth }, A.text, { salt: fromB64u(A.salt), local });
  assert.equal(toB64u(out), A.sealed);
});

test("plans the week: a nudge 15 minutes before, the 08:00 summary, nothing past", () => {
  const items = parse(
    "- [ ] Dentist 📅 2026-11-02 ⏰ 09:30\n- [ ] Gym 📅 2026-11-03 ⏰ 07:00\n- [x] Done 📅 2026-11-02 ⏰ 10:00\n- [ ] Far 📅 2026-12-20 ⏰ 10:00\n",
  ).map((task) => ({ task, list: "Life" }));
  const now = new Date(2026, 10, 2, 8, 30); // Monday 08:30, after today's summary
  const p = plan(items, now);
  assert.deepEqual(
    p.map((n) => [n.title, new Date(n.at).toTimeString().slice(0, 5), n.key.slice(0, 2)]),
    [
      ["Dentist", "09:15", "t:"],
      ["Gym", "06:45", "t:"],
      ["1 due today, 1 late", "08:00", "d:"],
    ],
  );
  assert.equal(p[0].body, "At 09:30 · Life");
});
