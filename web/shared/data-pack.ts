/**
 * The "pack" wire format for /api/data/p1/* - shared by the Worker (which
 * packs) and the app (which unpacks).
 *
 *   "F2P\x01" (4 bytes) | IV (12 bytes) | AES-GCM-256( deflate-raw( bytes ) )
 *
 * WHAT THIS IS: obfuscation and compression, NOT secrecy. The key below is in
 * a public repository and in every copy of the app's JavaScript, so anyone
 * willing to read the source can decode a pack - and the plain JSONL sits in
 * Git, which is where the dataset is meant to be read (CC BY 4.0,
 * LICENSE-DATA). What it does buy: a shard fetched with curl or opened in
 * DevTools is opaque instead of a ready-made JSON API, and it is ~15% of the
 * JSONL's size on the wire. Never describe it as protecting the data.
 *
 * WHAT IT MUST NOT CHANGE: the cache contract. A pack unpacks to the exact
 * committed bytes, so the app's existing SHA-256 check against
 * data/index.json (games-loader.ts) runs unchanged on the unpacked bytes, and
 * nothing is cached that has not passed it.
 *
 * The IV is the first 12 bytes of the plain bytes' SHA-256: the output is
 * deterministic (every edge, every time, the same pack for the same shard),
 * and two different shards never share an IV. Native WebCrypto and
 * Compression Streams only - no WASM, because the installed apps' CSP has no
 * 'wasm-unsafe-eval' and can never get one.
 */

export const PACK_MAGIC = Uint8Array.of(0x46, 0x32, 0x50, 0x01); // "F2P" + format 1

/** Public by design - see above. A new format gets a new magic and a new key. */
const PACK_KEY = Uint8Array.of(
  0xb9, 0xd2, 0x44, 0x5c, 0x18, 0xde, 0x70, 0x42, 0x2f, 0xd5, 0x15, 0xe4, 0x18, 0xe0, 0xea, 0x73,
  0x82, 0x0c, 0x29, 0xf3, 0x45, 0x15, 0x4b, 0x2e, 0xc2, 0x83, 0x13, 0xc7, 0xdd, 0x30, 0x67, 0xd2,
);

const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = PACK_MAGIC.length + IV_BYTES;

/** Whether this runtime can unpack. Without it the app reads the plain path. */
export function packsSupported(): boolean {
  return typeof DecompressionStream === "function" && typeof crypto !== "undefined" && Boolean(crypto.subtle);
}

async function key(usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", PACK_KEY, "AES-GCM", false, [usage]);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([bytes as BufferSource]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/**
 * Pack `plain`. `digest` is its SHA-256, which the caller has already computed
 * (the Worker checks it against the index before packing anything).
 */
export async function packBytes(plain: Uint8Array, digest: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const iv = digest.slice(0, IV_BYTES);
  const compressed = await pipe(plain, new CompressionStream("deflate-raw"));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: PACK_MAGIC },
      await key("encrypt"),
      compressed as BufferSource,
    ),
  );
  const out = new Uint8Array(HEADER_BYTES + sealed.length);
  out.set(PACK_MAGIC, 0);
  out.set(iv, PACK_MAGIC.length);
  out.set(sealed, HEADER_BYTES);
  return out;
}

/** Unpack to the original bytes. Throws on anything that is not an intact pack. */
export async function unpackBytes(packed: ArrayBuffer | Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = packed instanceof Uint8Array ? packed : new Uint8Array(packed);
  if (bytes.length < HEADER_BYTES + TAG_BYTES || PACK_MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error("data-pack: not a format-1 pack");
  }
  const iv = bytes.slice(PACK_MAGIC.length, HEADER_BYTES);
  const compressed = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: PACK_MAGIC },
      await key("decrypt"),
      bytes.subarray(HEADER_BYTES) as BufferSource,
    ),
  );
  return pipe(compressed, new DecompressionStream("deflate-raw"));
}
