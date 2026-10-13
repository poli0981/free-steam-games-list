/**
 * SHA-256 of a text's UTF-8 bytes, as lowercase hex - the form
 * data/index.json records for each shard (scripts/core/data_store.py).
 *
 * Shared by everything that must not trust a shard raw.githubusercontent.com
 * hands out: for ~5 minutes after a data commit it can still serve the
 * PREVIOUS shard next to the new index (img-mint.ts, records.ts).
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}
