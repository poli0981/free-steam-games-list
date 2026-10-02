/**
 * Mint AVIF copies of Steam header art into R2, from the cron (index.ts
 * scheduled). routes/img.ts only ever READS them.
 *
 * Why the cron and not the first view: the request path then has no way to
 * create a billed transformation at all. What gets minted is decided here,
 * from the published dataset - an unknown appid, a forged ?t= or a HEAD that
 * reaches /img can only ever be answered from what already exists. It also
 * means no visitor waits on an encode, and the most-played games go first.
 *
 * BUDGET. Cloudflare Images has no spend cap. The account is on Images Paid:
 * the first 5,000 unique transformations a month are included, then $0.50 per
 * 1,000. The counter in admin_state (`img_transforms:YYYY-MM`) IS the cap,
 * IMG_TRANSFORM_MONTHLY_CAP, and it fails closed: no state table, no cap set
 * or the cap reached all mean nothing is minted. Each attempt is counted
 * BEFORE the transformation runs, so a call that fails but is billed still
 * counts. The whole catalogue is ~5,600 sources x 2 widths, once; after that
 * only new games and changed art (a new Steam ?t=) cost anything.
 *
 * Kill switch: IMG_TRANSFORM. Set it in wrangler.jsonc by a PR - the repo has
 * no keep_vars, so a dashboard value lasts only until the next deploy.
 */
import { parseSteamImage, sourceKey, type SteamSource } from "../../shared/steam-image";
import type { AdminDeps } from "./deps";
import {
  AVIF_VARIANTS,
  avifKey,
  IMG_PREFIX,
  imagesBinding,
  mediaBucket,
  SOURCE_HOSTS,
  steamUrl,
  type AvifVariant,
} from "./img-store";
import { acquireLease, bumpCounter, readState, releaseLease, writeState } from "./locks";

const LEASE_MS = 10 * 60 * 1000;

/** Progress for the current dataset generation; lets an idle tick skip the R2 listing. */
const MARKER_KEY = "meta/img-mint-v1.json";

const VARIANTS: readonly AvifVariant[] = Object.values(AVIF_VARIANTS);

export interface MintResult {
  skipped?: string;
  minted?: number;
  /** Sources whose art could not be fetched or encoded on THIS tick. */
  failed?: number;
  /** Sources still missing at least one variant after this tick. */
  remaining?: number;
  /** Transformations counted this month, after this tick. */
  used?: number;
}

interface Marker {
  generation: string;
  complete: boolean;
  /** Sources whose art could not be fetched or encoded for this generation.
   *  Skipped until the dataset changes, so one dead URL cannot keep every
   *  tick listing the bucket. */
  failed: string[];
  /** Every source key of this generation, most-played first. A backfill
   *  takes many ticks; without this each one re-downloaded ~9 MB of shards
   *  from raw.githubusercontent just to rebuild the same list. */
  sources: string[];
}

export interface Candidate {
  src: SteamSource;
  key: string;
  players: number;
}

/** Per-isolate guard, as in reconcile.ts: overlapping ticks share one run. */
let inFlight: Promise<MintResult> | null = null;

export function mintImages(env: Env, deps: Pick<AdminDeps, "fetchRaw" | "now">): Promise<MintResult> {
  if (inFlight) return inFlight;
  inFlight = mintLocked(env, deps).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function mintLocked(env: Env, deps: Pick<AdminDeps, "fetchRaw" | "now">): Promise<MintResult> {
  if (String(env.IMG_TRANSFORM) !== "true") return { skipped: "disabled" };
  const bucket = mediaBucket(env);
  const images = imagesBinding(env);
  if (!bucket || !images) return { skipped: "bindings missing" };
  const cap = positiveInt(env.IMG_TRANSFORM_MONTHLY_CAP);
  if (!cap) return { skipped: "no monthly cap" };

  const owner = crypto.randomUUID();
  const lease = await acquireLease(env.DB, "img-mint", owner, LEASE_MS, deps.now());
  if (lease === "held") return { skipped: "another run in progress" };
  // No admin_locks means no admin_state either, so no counter: spend nothing.
  if (lease === "unavailable") return { skipped: "state unavailable" };
  try {
    return await mint(env, deps, bucket, images, cap);
  } finally {
    await releaseLease(env.DB, "img-mint", owner);
  }
}

async function mint(
  env: Env,
  deps: Pick<AdminDeps, "fetchRaw" | "now">,
  bucket: R2Bucket,
  images: ImagesBinding,
  cap: number,
): Promise<MintResult> {
  const now = deps.now();
  const counterKey = `img_transforms:${now.toISOString().slice(0, 7)}`;
  const stored = await readState(env.DB, counterKey);
  if (stored === null) return { skipped: "state unavailable" };
  let used = Number(stored ?? 0) || 0;
  if (used >= cap) return { skipped: "monthly cap reached", used };

  const indexText = await deps.fetchRaw("data/index.json", 0);
  if (!indexText) return { skipped: "index unreachable" };
  let files: { name: string; sha256: string }[];
  let generation: string;
  try {
    const parsed = JSON.parse(indexText) as { last_updated?: unknown; files?: { name?: unknown; sha256?: unknown }[] };
    files = (parsed.files ?? []).flatMap((f) =>
      typeof f?.name === "string" && /^data_\d{3}\.jsonl$/.test(f.name) &&
      typeof f.sha256 === "string" && /^[0-9a-f]{64}$/.test(f.sha256)
        ? [{ name: f.name, sha256: f.sha256 }]
        : [],
    );
    // Same shape as reconcile.ts's generation.
    generation = JSON.stringify([parsed.last_updated, files.map((f) => f.sha256)]);
  } catch {
    return { skipped: "index unparseable" };
  }
  if (!files.length) return { skipped: "no shards listed" };

  const marker = await readMarker(bucket);
  const sameGeneration = marker?.generation === generation;
  if (sameGeneration && marker.complete) return { skipped: "up to date", used };

  let sources: Candidate[];
  if (sameGeneration && marker.sources.length) {
    sources = marker.sources.map(fromKey);
  } else {
    // Only shards that hash to what the index records. raw.githubusercontent
    // can hand out the previous shard for ~5 minutes after a commit (data.ts),
    // and a list built from it would be stamped with the NEW generation and
    // frozen there until the next data change.
    const shards = await Promise.all(files.map((f) => deps.fetchRaw(`data/${f.name}`, 0)));
    for (let i = 0; i < files.length; i++) {
      const text = shards[i];
      if (text === null || (await sha256Hex(text)) !== files[i].sha256) {
        return { skipped: "shard not yet updated", used };
      }
    }
    sources = collectSources(shards as string[]);
  }

  const failed = new Set(sameGeneration ? marker.failed : []);
  const existing = await listKeys(bucket);
  const missing = sources.filter(
    (c) => !failed.has(c.key) && VARIANTS.some((v) => !existing.has(avifKey(v.width, c.src))),
  );

  const perTick = positiveInt(env.IMG_MINT_PER_TICK) || 10;
  let minted = 0;
  let failedNow = 0;
  let attempted = 0;
  for (const c of missing) {
    if (attempted >= perTick) break;
    const todo = VARIANTS.filter((v) => !existing.has(avifKey(v.width, c.src)));
    if (used + todo.length > cap) break;
    attempted++;

    const bytes = await fetchSource(c.src);
    if (!bytes) {
      failed.add(c.key);
      failedNow++;
      continue;
    }

    const next = await bumpCounter(env.DB, counterKey, todo.length, now);
    if (next === null) return { skipped: "state unavailable", minted, used };
    used = next;

    try {
      for (const v of todo) {
        const out = await images
          .input(new Blob([bytes]).stream())
          // scale-down: a legacy header narrower than the variant is never enlarged.
          .transform({ width: v.width, fit: "scale-down" })
          .output({ format: "image/avif", quality: v.quality });
        await bucket.put(avifKey(v.width, c.src), await out.response().arrayBuffer(), {
          httpMetadata: { contentType: "image/avif", cacheControl: "public, max-age=31536000, immutable" },
          customMetadata: { src: c.key, quality: String(v.quality) },
        });
      }
      minted++;
    } catch (err) {
      if (isQuotaError(err)) {
        // Images Free's monthly allowance is spent (Paid never says this):
        // stop every isolate until the month turns, not just this tick.
        await writeState(env.DB, counterKey, String(cap), now);
        used = cap;
        break;
      }
      console.warn("img-mint: transform failed", c.key, err instanceof Error ? err.message : String(err));
      failed.add(c.key);
      failedNow++;
    }
  }

  const remaining = Math.max(missing.filter((c) => !failed.has(c.key)).length - minted, 0);
  await writeMarker(bucket, { generation, complete: remaining === 0, failed: [...failed], sources: sources.map((c) => c.key) });
  return { minted, failed: failedNow, remaining, used };
}

/**
 * Every distinct source in the shards, most-played first.
 *
 * A regex per line rather than JSON.parse: ~9 MB of shards, and both fields
 * are anchored by their names. current_players is a formatted string
 * ("492,197", "N/A"); anything without digits sorts as 0.
 */
export function collectSources(shards: string[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  const headerRe = /"header_image"\s*:\s*"([^"]*)"/;
  const playersRe = /"current_players"\s*:\s*"?([\d,]*)/;
  for (const text of shards) {
    for (const line of text.split("\n")) {
      const header = headerRe.exec(line)?.[1];
      const src = header ? parseSteamImage(header) : null;
      if (!src) continue;
      const key = sourceKey(src);
      const players = Number((playersRe.exec(line)?.[1] ?? "").replace(/,/g, "")) || 0;
      const seen = byKey.get(key);
      if (!seen || players > seen.players) byKey.set(key, { src, key, players });
    }
  }
  return [...byKey.values()].sort((a, b) => b.players - a.players || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** A stored source key back to its parts: `path?t=stamp`, as sourceKey() wrote it. */
function fromKey(key: string): Candidate {
  const at = key.indexOf("?t=");
  const src = at < 0 ? { path: key, stamp: null } : { path: key.slice(0, at), stamp: key.slice(at + 3) };
  return { src, key, players: 0 };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

async function fetchSource(src: SteamSource): Promise<ArrayBuffer | null> {
  for (const host of SOURCE_HOSTS) {
    const res = await fetch(steamUrl(host, src.path, src.stamp), {
      cf: { cacheTtl: 2592000, cacheEverything: true },
    });
    // Buffered, not streamed: each width needs the bytes again.
    if (res.ok) return await res.arrayBuffer();
  }
  return null;
}

async function listKeys(bucket: R2Bucket): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: IMG_PREFIX, cursor, limit: 1000 });
    for (const o of page.objects) keys.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function readMarker(bucket: R2Bucket): Promise<Marker | null> {
  const object = await bucket.get(MARKER_KEY);
  if (!object) return null;
  try {
    const m = (await object.json()) as Partial<Marker>;
    return typeof m.generation === "string"
      ? {
          generation: m.generation,
          complete: m.complete === true,
          failed: strings(m.failed),
          sources: strings(m.sources),
        }
      : null;
  } catch {
    return null;
  }
}

async function writeMarker(bucket: R2Bucket, marker: Marker): Promise<void> {
  await bucket.put(MARKER_KEY, JSON.stringify(marker), { httpMetadata: { contentType: "application/json" } });
}

function isQuotaError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 9422 || /\b9422\b/.test(err instanceof Error ? err.message : String(err));
}

function positiveInt(value: unknown): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}
