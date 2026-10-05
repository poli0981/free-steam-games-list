import { describe, expect, it } from "vitest";
import { PACK_MAGIC, packBytes, packIvHex, sha256, unpackBytes } from "./data-pack";

const enc = new TextEncoder();

async function pack(text: string) {
  const plain = enc.encode(text);
  return { plain, packed: await packBytes(plain, await sha256(plain)) };
}

/** A shard-like body: many similar JSON lines, as the real ones are. */
const SHARD = Array.from({ length: 400 }, (_, i) =>
  JSON.stringify({ link: `https://store.steampowered.com/app/${730 + i * 10}/`, name: `Game ${i}`, genre: "Shooter" }),
).join("\n") + "\n";

describe("data-pack", () => {
  it("unpacks to the exact bytes, so the index's SHA-256 still matches", async () => {
    const { plain, packed } = await pack(SHARD);
    const back = await unpackBytes(packed);
    expect(back).toEqual(plain);
    expect(await sha256(back)).toEqual(await sha256(plain));
  });

  it("is opaque and much smaller than the JSONL", async () => {
    const { plain, packed } = await pack(SHARD);
    expect([...packed.slice(0, 4)]).toEqual([...PACK_MAGIC]);
    expect(new TextDecoder().decode(packed)).not.toContain("steampowered");
    expect(packed.length).toBeLessThan(plain.length / 4);
  });

  it("is deterministic: the same shard packs to the same bytes everywhere", async () => {
    const a = await pack(SHARD);
    const b = await pack(SHARD);
    expect(b.packed).toEqual(a.packed);
    const other = await pack(SHARD.replace("Game 1", "Game X"));
    // A different shard has a different IV (taken from its own hash).
    expect(other.packed.slice(4, 16)).not.toEqual(a.packed.slice(4, 16));
  });

  it("refuses anything that is not an intact format-1 pack", async () => {
    const { packed } = await pack(SHARD);
    const flipped = packed.slice();
    flipped[flipped.length - 20] ^= 0xff;
    await expect(unpackBytes(flipped)).rejects.toThrow();

    const wrongMagic = packed.slice();
    wrongMagic[3] = 0x02;
    await expect(unpackBytes(wrongMagic)).rejects.toThrow(/format-1/);

    await expect(unpackBytes(enc.encode('{"link":"x"}\n'))).rejects.toThrow();
    await expect(unpackBytes(new Uint8Array(0))).rejects.toThrow();
  });

  it("handles an empty file", async () => {
    const { packed } = await pack("");
    expect(await unpackBytes(packed.buffer as ArrayBuffer)).toEqual(new Uint8Array(0));
  });

  it("names the shard a pack holds by its IV: the sha256 prefix", async () => {
    const { plain, packed } = await pack(SHARD);
    const hex = [...(await sha256(plain))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(packIvHex(packed)).toBe(hex.slice(0, 24));

    const wrongMagic = packed.slice();
    wrongMagic[3] = 0x02;
    expect(packIvHex(wrongMagic)).toBeNull();
    expect(packIvHex(enc.encode('{"link":"x"}\n'))).toBeNull();
    expect(packIvHex(packed.subarray(0, 20))).toBeNull();
  });
});
