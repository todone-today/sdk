import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptList,
  deriveLogin,
  encryptList,
  fingerprint,
  newAccount,
  newRecovery,
  newSymmetricKey,
  readRecovery,
  recoveryWrapKey,
  rewrap,
  unwrapPrivateKey,
  unwrapSymmetric,
  unwrapTeamKey,
  wrapForMember,
} from "./crypto.ts";

// Real accounts use 600k iterations; tests use few so they run fast. The maths is the same.
const IT = 1000;

test("sign-up keys unlock again from the password, and the auth hash isn't the password", async () => {
  const { authHash, keys, accountKey } = await newAccount("correct horse", IT);
  assert.notEqual(authHash, "correct horse");
  const again = await deriveLogin("correct horse", keys.kdfSalt, IT);
  assert.equal(again.authHash, authHash);
  const key = await unwrapSymmetric(again.wrapKey, keys.wrappedKey);
  const blob = await encryptList(accountKey, "list-1", { name: "Groceries", tasks: [{ title: "Milk" }] });
  assert.deepEqual(await decryptList(key, "list-1", blob), { name: "Groceries", tasks: [{ title: "Milk" }] });
  assert.ok(!blob.includes("Groceries") && blob.startsWith("v1."));
});

test("the wrong password can't unwrap the account key", async () => {
  const { keys } = await newAccount("right password", IT);
  const wrong = await deriveLogin("wrong password", keys.kdfSalt, IT);
  await assert.rejects(unwrapSymmetric(wrong.wrapKey, keys.wrappedKey));
});

test("a list blob can't be opened as a different list", async () => {
  const key = await newSymmetricKey();
  const blob = await encryptList(key, "a", { name: "A", tasks: [] });
  await assert.rejects(decryptList(key, "b", blob));
});

test("the recovery key unwraps the same account key, typed in any case and spacing", async () => {
  const { keys, recoveryKey, accountKey } = await newAccount("pw", IT);
  assert.match(recoveryKey, /^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
  assert.equal(await readRecovery(accountKey, keys.encryptedRecovery), recoveryKey);
  const typed = recoveryKey.toLowerCase().replaceAll("-", " ");
  const key = await unwrapSymmetric(await recoveryWrapKey(typed), keys.recoveryWrappedKey);
  const blob = await encryptList(accountKey, "x", { name: "Kept", tasks: [] });
  assert.equal((await decryptList(key, "x", blob)).name, "Kept");
  await assert.rejects(recoveryWrapKey("too-short"));
});

test("changing the password keeps the data and retires the old password", async () => {
  const { keys, accountKey } = await newAccount("old", IT);
  const extractable = await unwrapSymmetric((await deriveLogin("old", keys.kdfSalt, IT)).wrapKey, keys.wrappedKey, true);
  const next = await rewrap(extractable, "new", IT);
  const blob = await encryptList(accountKey, "l", { name: "Still here", tasks: [] });
  const key = await unwrapSymmetric((await deriveLogin("new", next.kdfSalt, IT)).wrapKey, next.wrappedKey);
  assert.equal((await decryptList(key, "l", blob)).name, "Still here");
  await assert.rejects(unwrapSymmetric((await deriveLogin("old", next.kdfSalt, IT)).wrapKey, next.wrappedKey));
});

test("a new recovery key replaces the old one", async () => {
  const { accountKey } = await newAccount("pw", IT);
  const r = await newRecovery(accountKey);
  assert.equal(await readRecovery(accountKey, r.encryptedRecovery), r.recoveryKey);
  await unwrapSymmetric(await recoveryWrapKey(r.recoveryKey), r.recoveryWrappedKey);
});

test("a team key wrapped for a member opens only with that member's private key", async () => {
  const alice = await newAccount("a", IT);
  const bob = await newAccount("b", IT);
  const team = await newSymmetricKey();
  const forBob = await wrapForMember(bob.keys.publicKey, team);
  const bobsKey = await unwrapTeamKey(await unwrapPrivateKey(bob.accountKey, bob.keys.wrappedPrivateKey), forBob);
  const blob = await encryptList(team, "t", { name: "Team list", tasks: [] });
  assert.equal((await decryptList(bobsKey, "t", blob)).name, "Team list");
  const alicePrivate = await unwrapPrivateKey(alice.accountKey, alice.keys.wrappedPrivateKey);
  await assert.rejects(unwrapTeamKey(alicePrivate, forBob));
  assert.match(await fingerprint(bob.keys.publicKey), /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
});
