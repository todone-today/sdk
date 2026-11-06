// End-to-end encryption for todone, modelled on Bitwarden. WebCrypto only, so the same code runs in the browser
// and in Node (tests). The server only ever sees what these functions output:
//   - authHash: what the browser sends as "the password". Derived from the real password, which never leaves.
//   - wrapped keys and v1 blobs: ciphertext it can store but not open.
//
// password ──PBKDF2(salt, 600k)──▶ master ──HKDF──▶ wrapKey ──wraps──▶ account key ──encrypts──▶ lists
//                                     └──PBKDF2(password, 1)──▶ authHash (sign-in)
// recovery key ──HKDF──▶ a second wrapKey for the same account key.
// RSA key pair (private key wrapped by the account key) receives team keys; team keys encrypt team lists.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ITERATIONS = 600_000;

const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s);
};
type Bytes = Uint8Array<ArrayBuffer>;
const unb64 = (s: string): Bytes => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const randomSalt = () => b64(random(16));

const AES = { name: "AES-GCM", length: 256 } as const;
const hkdf = (base: CryptoKey, info: string) =>
  subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(info) }, base, AES, false, [
    "encrypt",
    "decrypt",
  ]);

// What a password unlocks: the key that wraps the account key, and the hash sent to sign in.
export async function deriveLogin(password: string, salt: string, iterations = KDF_ITERATIONS) {
  const pw = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const master = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations }, pw, 256);
  const masterKey = await subtle.importKey("raw", master, "PBKDF2", false, ["deriveBits"]);
  const auth = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(password), iterations: 1 },
    masterKey,
    256,
  );
  const wrapKey = await hkdf(await subtle.importKey("raw", master, "HKDF", false, ["deriveKey"]), "todone wrap key");
  return { authHash: b64(auth), wrapKey };
}

// "v1.<iv>.<ciphertext>": AES-256-GCM. `aad` binds a blob to where it belongs (a list id), so it can't be moved.
export async function seal(key: CryptoKey, data: Bytes, aad = "") {
  const iv = random(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, data);
  return `v1.${b64(iv)}.${b64(ct)}`;
}
export async function open(key: CryptoKey, blob: string, aad = "") {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Not a todone encrypted blob");
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(aad) }, key, unb64(ct)));
}
export const sealJSON = (key: CryptoKey, value: unknown, aad = "") => seal(key, enc.encode(JSON.stringify(value)), aad);
export const openJSON = async <T>(key: CryptoKey, blob: string, aad = ""): Promise<T> =>
  JSON.parse(dec.decode(await open(key, blob, aad)));

// Account and team keys: AES-256-GCM. Extractable only where they must be re-wrapped (password change, sharing).
export const newSymmetricKey = () => subtle.generateKey(AES, true, ["encrypt", "decrypt"]);
const importSymmetric = (raw: Bytes, extractable: boolean) =>
  subtle.importKey("raw", raw, AES, extractable, ["encrypt", "decrypt"]);
export const wrapSymmetric = async (wrapKey: CryptoKey, key: CryptoKey) =>
  seal(wrapKey, new Uint8Array(await subtle.exportKey("raw", key)));
export const unwrapSymmetric = async (wrapKey: CryptoKey, blob: string, extractable = false) =>
  importSymmetric(await open(wrapKey, blob), extractable);

// Recovery key: 32 random bytes, shown as 13 groups of 4 base32 characters. Typing is forgiving.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newRecoveryKey() {
  const bytes = random(32);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  const chars = bits.padEnd(Math.ceil(bits.length / 5) * 5, "0").match(/.{5}/g)!.map((x) => B32[parseInt(x, 2)]);
  return chars.join("").match(/.{1,4}/g)!.join("-");
}
function recoveryBytes(text: string) {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (clean.length !== 52) throw new Error("A recovery key has 52 letters and numbers");
  let bits = "";
  for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const out = new Uint8Array(32);
  bits.slice(0, 256).match(/.{8}/g)!.forEach((x, i) => (out[i] = parseInt(x, 2)));
  return out;
}
export const recoveryWrapKey = async (recoveryKey: string) =>
  hkdf(await subtle.importKey("raw", recoveryBytes(recoveryKey), "HKDF", false, ["deriveKey"]), "todone recovery key");

// Key pairs for teams: team keys are wrapped to each member's public key.
const RSA = { name: "RSA-OAEP", hash: "SHA-256" } as const;
export async function newKeyPair(accountKey: CryptoKey) {
  const pair = await subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
    "encrypt",
    "decrypt",
  ]);
  return {
    publicKey: b64(await subtle.exportKey("spki", pair.publicKey)),
    wrappedPrivateKey: await seal(accountKey, new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey))),
  };
}
export const unwrapPrivateKey = async (accountKey: CryptoKey, blob: string) =>
  subtle.importKey("pkcs8", await open(accountKey, blob), RSA, false, ["decrypt"]);
export async function wrapForMember(publicKey: string, teamKey: CryptoKey) {
  const pub = await subtle.importKey("spki", unb64(publicKey), RSA, false, ["encrypt"]);
  return b64(await subtle.encrypt(RSA, pub, await subtle.exportKey("raw", teamKey)));
}
export const unwrapTeamKey = async (privateKey: CryptoKey, wrapped: string) =>
  importSymmetric(new Uint8Array(await subtle.decrypt(RSA, privateKey, unb64(wrapped))), true);

// A short, comparable phrase for a public key: check it matches on both screens before confirming a teammate.
export async function fingerprint(publicKey: string) {
  const h = new Uint8Array(await subtle.digest("SHA-256", unb64(publicKey)));
  return [...h.slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("").match(/.{4}/g)!.join("-");
}

// Everything a new account stores, made in the browser at sign-up. The server receives `keys` and `authHash`.
export type AccountKeys = {
  kdfSalt: string;
  kdfIter: number;
  wrappedKey: string;
  recoveryWrappedKey: string;
  encryptedRecovery: string;
  publicKey: string;
  wrappedPrivateKey: string;
};
export async function newAccount(password: string, iterations = KDF_ITERATIONS) {
  const kdfSalt = randomSalt();
  const { authHash, wrapKey } = await deriveLogin(password, kdfSalt, iterations);
  const accountKey = await newSymmetricKey();
  const recoveryKey = newRecoveryKey();
  const keys: AccountKeys = {
    kdfSalt,
    kdfIter: iterations,
    wrappedKey: await wrapSymmetric(wrapKey, accountKey),
    recoveryWrappedKey: await wrapSymmetric(await recoveryWrapKey(recoveryKey), accountKey),
    encryptedRecovery: await seal(accountKey, enc.encode(recoveryKey)),
    ...(await newKeyPair(accountKey)),
  };
  return { authHash, accountKey, recoveryKey, keys };
}

// A new password (change, or recovery): same account key, wrapped by the new password's key.
export async function rewrap(accountKey: CryptoKey, password: string, iterations = KDF_ITERATIONS) {
  const kdfSalt = randomSalt();
  const { authHash, wrapKey } = await deriveLogin(password, kdfSalt, iterations);
  return { authHash, kdfSalt, kdfIter: iterations, wrappedKey: await wrapSymmetric(wrapKey, accountKey) };
}

// A new recovery key for an account: re-wrap the account key to it, and store it encrypted to show again later.
export async function newRecovery(accountKey: CryptoKey) {
  const recoveryKey = newRecoveryKey();
  return {
    recoveryKey,
    recoveryWrappedKey: await wrapSymmetric(await recoveryWrapKey(recoveryKey), accountKey),
    encryptedRecovery: await seal(accountKey, enc.encode(recoveryKey)),
  };
}
export const readRecovery = async (accountKey: CryptoKey, blob: string) => dec.decode(await open(accountKey, blob));

// Lists: name and tasks together in one blob, bound to the list's id.
export const encryptList = (key: CryptoKey, id: string, list: { name: string; tasks: unknown }) =>
  sealJSON(key, { name: list.name, tasks: list.tasks }, `list:${id}`);
export const decryptList = <T>(key: CryptoKey, id: string, blob: string) =>
  openJSON<{ name: string; tasks: T }>(key, blob, `list:${id}`);
