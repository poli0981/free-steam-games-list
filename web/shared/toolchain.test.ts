/**
 * One version of each runtime, and one place that says it.
 *
 * Node: web/.node-version holds the major. Every actions/setup-node step
 * repeats it as a literal - release-android.yml checks out the tag it
 * rebuilds, and older tags have no such file - and engines.node and the
 * @types/node major follow it. Workers Builds' NODE_VERSION (dashboard) is the
 * one copy this cannot see; docs/DEPLOYMENT.md says so.
 *
 * Python: every actions/setup-python step installs the pipeline's version,
 * which sonar.python.version and the --python-version in requirements.txt's
 * header repeat. A workflow named in PYTHON_EXCEPTIONS is allowed exactly the
 * version given there.
 *
 * TypeScript: `typescript` stays 6 (svelte-check and `svelte-kit sync` need its
 * JavaScript API); 7 is the @typescript/native alias. Both declare a `tsc` bin,
 * so whichever npm linked last is node_modules/.bin/tsc, and no script may
 * call a bare one. docs/plan/17-typescript-7.1.md says when TypeScript 6 goes
 * and how this block changes then.
 *
 * web-ci.yml runs on changes to .github/workflows/ and .sonarcloud.properties
 * as well as web/, so a pull request that edits only a pin still meets this.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// From the string, not `new URL(...)`: tsconfig.test.json also loads the
// Worker's runtime types, whose global URL is not node:url's.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(REPO, "web");
const WORKFLOWS = join(REPO, ".github", "workflows");

/** Workflows allowed another Python, and the exact version each must use. */
const PYTHON_EXCEPTIONS: Record<string, string> = {
  // CodeQL's extractor runs on this interpreter, and its supported-languages
  // page lists Python up to 3.14. Drop the entry once it lists the pipeline's.
  "codeql.yml": "3.14",
};

const read = (path: string) => readFileSync(path, "utf-8");
const pkg = JSON.parse(read(join(WEB, "package.json")));

/** Each workflow without its comment lines, so a commented-out step does not count. */
const workflows = readdirSync(WORKFLOWS)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({
    file,
    text: read(join(WORKFLOWS, file))
      .split(/\r?\n/)
      .filter((line) => !/^\s*#/.test(line))
      .join("\n"),
  }));

/** Every value of `key`, in any of the styles the workflows use:
 *  `key: '3.15'`, `with: {key: '3.15'}`, `with : { key : '3.15' }`. */
function pins(text: string, key: string): string[] {
  const re = new RegExp(`${key}(?![\\w-])\\s*:\\s*([^,}\\n]*)`, "g");
  return [...text.matchAll(re)].map((m) => m[1].replace(/\s+#.*$/, "").trim());
}

function steps(text: string, action: string): number {
  return (text.match(new RegExp(`uses\\s*:\\s*actions/${action}@`, "g")) ?? []).length;
}

/** What a pin says inside its quotes, or null when it is not quoted - unquoted,
 *  YAML reads 3.10 as 3.1. Pins are compared as strings: no pattern is ever
 *  built from a version (CodeQL js/incomplete-sanitization). */
function unquote(pin: string): string | null {
  const m = /^(['"])(.*)\1$/.exec(pin);
  return m ? m[2] : null;
}

describe("Node", () => {
  const node = read(join(WEB, ".node-version")).trim();

  it("is one major in web/.node-version", () => {
    expect(node).toMatch(/^\d+$/);
  });

  it("is what engines.node and the @types/node major follow", () => {
    expect(pkg.engines?.node).toBe(`>=${node}`);
    expect(/^\^(\d+)\./.exec(pkg.devDependencies["@types/node"])?.[1]).toBe(node);
  });

  it("is what every setup-node step installs", () => {
    let total = 0;
    for (const { file, text } of workflows) {
      const uses = steps(text, "setup-node");
      const found = pins(text, "node-version");
      expect(found.length, `${file}: one node-version per setup-node`).toBe(uses);
      for (const pin of found) expect(unquote(pin), `${file}: ${pin}`).toBe(node);
      total += uses;
    }
    expect(total).toBeGreaterThanOrEqual(5);
  });
});

describe("Python", () => {
  const python = /^sonar\.python\.version=(\S+)$/m.exec(read(join(REPO, ".sonarcloud.properties")))?.[1] ?? "";

  it("is one X.Y in .sonarcloud.properties", () => {
    expect(python).toMatch(/^3\.\d+$/);
  });

  it("is the version requirements.txt is compiled for", () => {
    expect(read(join(REPO, "requirements.txt"))).toContain(`--python-version ${python} `);
  });

  it("is what every setup-python step installs, exceptions aside", () => {
    let total = 0;
    for (const { file, text } of workflows) {
      const uses = steps(text, "setup-python");
      const found = pins(text, "python-version");
      expect(found.length, `${file}: one python-version per setup-python`).toBe(uses);
      for (const pin of found) expect(unquote(pin), `${file}: ${pin}`).toBe(PYTHON_EXCEPTIONS[file] ?? python);
      total += uses;
    }
    expect(total).toBeGreaterThanOrEqual(18);
  });

  it("lists only exceptions that exist and still differ", () => {
    for (const [file, version] of Object.entries(PYTHON_EXCEPTIONS)) {
      expect(workflows.some((w) => w.file === file), file).toBe(true);
      expect(version, file).not.toBe(python);
    }
  });
});

describe("TypeScript", () => {
  const dev = pkg.devDependencies;

  it("keeps 6 as `typescript`, for the tools that need its API", () => {
    expect(dev.typescript).toMatch(/^\^6\./);
  });

  it("runs 7 through the @typescript/native alias, held to one minor", () => {
    expect(dev["@typescript/native"]).toMatch(/^npm:typescript@~7\./);
  });

  it("never calls a bare tsc, which could be either", () => {
    for (const [name, script] of Object.entries<string>(pkg.scripts)) {
      expect(script, name).not.toMatch(/(^|&&|\|\||;)\s*tsc\b/);
    }
  });
});
