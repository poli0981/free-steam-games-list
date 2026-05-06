/**
 * GPG / OpenPGP wrapper. Used to sign git commit objects so GitHub can mark
 * them "Verified".
 *
 * Only the keyholder's browser sees the decrypted key — it lives in memory
 * (Zustand) and is never written to disk. The encrypted armored key is kept
 * in localStorage (already encrypted by the user's passphrase via PGP).
 *
 * Implementation note: the local `web/src/gpgauth/openpgp.min.mjs` file
 * dynamically imports companion chunks (noble_curves, noble_hashes) which
 * weren't shipped alongside it, so we use the npm package instead — it
 * bundles all chunks and is tree-shakable to a similar size.
 */
import * as openpgp from "openpgp";

export interface ParsedKey {
  armored: string;
  fingerprint: string;
  keyId: string;
  userIds: string[];
  primaryName: string;
  primaryEmail: string;
  algorithm: string;
  isDecrypted: boolean;
}

function parseUserId(uid: string): { name: string; email: string } {
  const m = uid.match(/^\s*(.*?)\s*<\s*(.+?)\s*>\s*$/);
  if (!m) return { name: uid.trim(), email: "" };
  return { name: m[1].trim(), email: m[2].trim() };
}

function summariseKey(key: openpgp.PrivateKey, armored: string): ParsedKey {
  const userIds = key.getUserIDs();
  const primary = parseUserId(userIds[0] ?? "");
  const algInfo = key.getAlgorithmInfo();
  const algLabel = algInfo.curve
    ? `${algInfo.algorithm} (${algInfo.curve})`
    : algInfo.bits
      ? `${algInfo.algorithm} ${algInfo.bits}`
      : algInfo.algorithm;
  return {
    armored,
    fingerprint: key.getFingerprint().toUpperCase(),
    keyId: key.getKeyID().toHex().toUpperCase(),
    userIds,
    primaryName: primary.name,
    primaryEmail: primary.email,
    algorithm: algLabel,
    isDecrypted: key.isDecrypted(),
  };
}

/** Parse an armored private key (does not decrypt). */
export async function parsePrivateKey(armored: string): Promise<ParsedKey> {
  const key = await openpgp.readPrivateKey({ armoredKey: armored });
  return summariseKey(key, armored);
}

export interface UnlockedKey {
  parsed: ParsedKey;
  /** OpenPGP.js decrypted key — kept in memory only. */
  key: openpgp.PrivateKey;
}

/** Decrypt with passphrase. Throws if wrong passphrase. */
export async function unlockPrivateKey(
  armored: string,
  passphrase: string,
): Promise<UnlockedKey> {
  const privateKey = await openpgp.readPrivateKey({ armoredKey: armored });
  const decrypted = await openpgp.decryptKey({ privateKey, passphrase });
  return { parsed: summariseKey(decrypted, armored), key: decrypted };
}

/**
 * Produce a detached, binary-mode, ASCII-armored OpenPGP signature for the
 * exact byte content of a Git commit object. Returns the armored signature.
 *
 * Binary mode (signature type 0x00) is required — Git refuses 0x01 (text).
 */
export async function signCommitContent(
  unlocked: UnlockedKey,
  commitContent: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(commitContent);
  const message = await openpgp.createMessage({ binary: bytes });
  const armored = await openpgp.sign({
    message,
    signingKeys: unlocked.key,
    detached: true,
    format: "armored",
  });
  return armored;
}
