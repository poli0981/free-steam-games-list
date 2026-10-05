/**
 * In-memory stand-ins for the R2 bucket (MEDIA) and the Images binding
 * (IMAGES), shared by the /img route and img-mint tests. Only the surface
 * those two use is implemented.
 */

interface StoredObject {
  body: Uint8Array;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

function bytesOf(value: unknown): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("FakeR2: unsupported body");
}

export class FakeR2 {
  objects = new Map<string, StoredObject>();
  gets: string[] = [];
  puts: string[] = [];
  lists = 0;

  /** Seed an object, as if a previous tick had written it. */
  seed(key: string, body: string | Uint8Array = "seeded"): void {
    this.objects.set(key, { body: bytesOf(body) });
  }

  async get(key: string) {
    this.gets.push(key);
    const o = this.objects.get(key);
    if (!o) return null;
    const body = o.body;
    return {
      key,
      size: body.byteLength,
      httpEtag: `"${key.length}-${body.byteLength}"`,
      httpMetadata: o.httpMetadata,
      customMetadata: o.customMetadata,
      body: new Blob([body]).stream(),
      async arrayBuffer() {
        return body.slice().buffer;
      },
      async text() {
        return new TextDecoder().decode(body);
      },
      async json() {
        return JSON.parse(new TextDecoder().decode(body));
      },
    };
  }

  async put(key: string, value: unknown, options?: R2PutOptions) {
    this.puts.push(key);
    this.objects.set(key, {
      body: bytesOf(value),
      httpMetadata: options?.httpMetadata as R2HTTPMetadata | undefined,
      customMetadata: options?.customMetadata,
    });
    return { key };
  }

  async list(options: R2ListOptions = {}) {
    this.lists++;
    const prefix = options.prefix ?? "";
    const limit = options.limit ?? 1000;
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const objects = keys.slice(start, start + limit).map((key) => ({ key }));
    return start + limit < keys.length
      ? { objects, delimitedPrefixes: [], truncated: true as const, cursor: String(start + limit) }
      : { objects, delimitedPrefixes: [], truncated: false as const };
  }

  asBinding(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}

export interface ImagesCall {
  width?: number;
  fit?: string;
  format: string;
  quality?: number;
  inputBytes: number;
}

/**
 * Records every transformation and returns a deterministic body naming its
 * parameters, so a test can tell which object came from which call.
 */
export class FakeImages {
  calls: ImagesCall[] = [];
  /** Thrown from output(), after the input was read. */
  failWith: unknown = null;

  input(stream: ReadableStream<Uint8Array>) {
    let transform: { width?: number; fit?: string } = {};
    const handle = {
      transform: (t: { width?: number; fit?: string }) => {
        transform = { ...transform, ...t };
        return handle;
      },
      draw: () => handle,
      output: async (o: { format: string; quality?: number }) => {
        const inputBytes = (await new Response(stream).arrayBuffer()).byteLength;
        if (this.failWith) throw this.failWith;
        this.calls.push({ ...transform, format: o.format, quality: o.quality, inputBytes });
        const body = new TextEncoder().encode(`AVIF w=${transform.width} q=${o.quality} from=${inputBytes}`);
        return {
          response: () => new Response(body, { headers: { "Content-Type": o.format } }),
          contentType: () => o.format,
          image: () => new Blob([body]).stream(),
        };
      },
    };
    return handle;
  }

  asBinding(): ImagesBinding {
    return this as unknown as ImagesBinding;
  }
}
