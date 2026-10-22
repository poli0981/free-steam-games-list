# TypeScript 7.1 — the full switch, prepared

## Why this note exists

Since 2026-10-22 this repository runs TypeScript 7 for every type-check it
can, with TypeScript 6 installed beside it for the tools that need a
JavaScript API 7.0 does not have ([16-toolchain-2026.md](16-toolchain-2026.md)
has the assessment and the evidence). The maintainer's decision the same day:
when TypeScript 7.1 ships, move to TypeScript 7 completely - one compiler,
no TypeScript 6, the admin checked by 7 as well. This note is the springboard
for that day: what has to be true first, how to check it, the steps, and how
to prove the result. Nothing in it is done yet.

## Where things stand (2026-10-22)

- **TypeScript 7.1.0-beta** came out on 2026-10-20
  ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)).
  The release candidate is planned "in about a month", the final release
  "shortly thereafter". 7.1 brings:
  - **the first API of the Go compiler**, split into entry points:
    `typescript/sync`, `typescript/async`, `typescript/fs`, `typescript/ast`,
    `typescript/ast/is`, `typescript/ast/factory`. It is a new design, not the
    TypeScript 6 API; 7.0.2's `typescript/unstable/*` paths were its preview;
  - **content mappers**: a package registered in a tsconfig's
    `contentMappers` turns a non-TypeScript file (`.svelte`) into a virtual
    TypeScript file that maps back to the original. `tsc` runs them only with
    `--runExternalCode`, since they are external executables;
  - stricter distributive conditional types and regenerated DOM types (both
    can surface new errors), a stable `es2026` target and lib, import
    attributes in ambient modules, and source phase imports.
- **Svelte's side is not ready.** language-tools PR
  [#3111](https://github.com/sveltejs/language-tools/pull/3111) adds
  `@sveltejs/ts-content-mapper`, for editors first; svelte-check support is to
  be "a separate PR". `svelte-check --tsgo-experimental-api` crashes on
  7.1.0-beta ([#3149](https://github.com/sveltejs/language-tools/issues/3149)),
  and [#3063](https://github.com/sveltejs/language-tools/issues/3063)
  ("Typescript 7 crashes svelte2tsx and svelte-check") is still open.
- **SvelteKit**: `@sveltejs/kit@2.70.3` declares `typescript` `^5.3.3 || ^6.0.0`,
  and `svelte-kit sync` builds the route `$types` with the TypeScript 6 API
  (`ts.createSourceFile` in `src/core/sync/write_types/index.js`). Kit 3.1.0
  declares `typescript ^6.0.0`.
- **This repository**: `typescript` is `^6.0.3`, TypeScript 7 is the alias
  `"@typescript/native": "npm:typescript@~7.0.2"` (held to 7.0.x so a 7.1
  install cannot sneak in under svelte-check), and:

  | Check | Compiler today |
  | --- | --- |
  | `check` - svelte-check `--tsgo`, `tsconfig.json` (the app) | TypeScript 7 |
  | `check:admin` - svelte-check, `admin/tsconfig.json` | **TypeScript 6** (`--tsgo` mis-maps a tsconfig outside the workspace root) |
  | `tsc -p` × 4 (`admin/tsconfig.node.json`, `admin/tsconfig.test.json`, `tsconfig.worker.json`, `tsconfig.test.json`) | TypeScript 7, called by path |
  | `svelte-kit sync` (route `$types`) | TypeScript 6 API |
  | WebStorm's language service | TypeScript 6 (`web/node_modules/typescript/lib`) |

## Start when all of these are true

| # | Condition | How to check |
| --- | --- | --- |
| 1 | TypeScript 7.1.0 (or later) is `latest` on npm | `npm view typescript dist-tags` |
| 2 | svelte-check accepts `typescript@7` on its own: no TypeScript 6 required, no "experimental" flag | `npm view svelte-check version peerDependencies`; after a trial install, `node_modules/svelte-check/bin/ts-version-check.js` must not throw for 7; its README's TypeScript 7 section |
| 3 | svelte-check's TypeScript 7 mode checks a tsconfig that is not at the workspace root, and imports of `.svelte` files from outside it - the admin's case | the planted-error check below, on `admin/tsconfig.json` |
| 4 | `svelte-kit sync` writes the route `$types` with TypeScript 7 installed as `typescript`, and kit's peer range allows it | `npm view @sveltejs/kit@2 peerDependencies`; after a trial install, `.svelte-kit/types/**/$types.d.ts` still exists (32 files today) and `src/routes/games/[appid]/+page.ts` still type-checks its `./$types` import |
| 5 | the language-tools issues above are closed or answered: #3063, #3149, #3142 (`.svelte` through `package.json#imports`) | `gh issue view <n> -R sveltejs/language-tools` |
| 6 | (dev comfort, not a blocker) WebStorm or VS Code can serve TypeScript 7 | the IDE's TypeScript settings |

If conditions 2-4 hold only through content mappers, that is fine: the steps
below say where they go.

## The switch, step by step

Work on a branch; every step is reversible by restoring `web/package.json`,
`web/package-lock.json` and the files named.

1. **Record the baseline** on the current setup (commands in "Proving it"
   below): the knip report, the four `tsc` timings, `--listFilesOnly` counts
   per config, and `npm test` totals.
2. **Packages** (`web/`, always with `--ignore-scripts`):
   - `npm install -D --ignore-scripts typescript@^7.1.0`
   - `npm uninstall --ignore-scripts @typescript/native`
   - only if svelte-check's docs ask for it: `npm install -D --ignore-scripts @sveltejs/ts-content-mapper`
   - bump `svelte-check` (exact pin) and, if needed, `@sveltejs/kit` - kit's
     exact version also keys the `cookie` override in `package.json`, which
     must be re-keyed in the same change (CLAUDE.md, the GHSA-pxg6-pf52-xh8x
     bullet).
3. **Scripts** (`web/package.json`):
   - the four `node node_modules/@typescript/native/bin/tsc -p …` and
     `typecheck:worker` go back to plain `tsc -p …` - with one TypeScript
     installed, `node_modules/.bin/tsc` is unambiguous again;
   - `check` and `check:admin` take whatever svelte-check then documents (no
     flag, `--tsgo`, or a content-mapper mode). `check:admin` must move to
     TypeScript 7 too - that is the point of the switch.
4. **tsconfigs**: if svelte-check or `tsc` need a content mapper, add to the
   tsconfig that checks `.svelte` files (`tsconfig.json` / `admin/tsconfig.json`)
   ```jsonc
   "contentMappers": [{ "package": "@sveltejs/ts-content-mapper", "extensions": [".svelte"] }]
   ```
   and remember `tsc` then needs `--runExternalCode`. Fix what 7.1's stricter
   distributive conditional types and new DOM types report, in code. Moving
   `target`/`lib` to `es2026` is optional and separate.
5. **Dependabot** (`.github/dependabot.yml`): drop the `@typescript/native`
   ignore; keep the `typescript` major ignore (it then holds back 8) and
   rewrite its comment.
6. **The drift test** (`web/shared/toolchain.test.ts`, `describe("TypeScript")`):
   `typescript` matches `^7.`, `@typescript/native` is absent, and the
   "never calls a bare tsc" rule goes (or becomes "no second TypeScript
   package").
7. **Words**: rewrite CLAUDE.md's "TypeScript is two packages, on purpose"
   bullet as one package (keep whatever svelte-check mode and content-mapper
   rule is load-bearing); `docs/dev_env.md` + `docs/i18n/vi/dev_env.md`
   (TypeScript row), `docs/THIRD_PARTY.md` (svelte-check row), `web/README.md`
   (Checks), `docs/DEPLOYMENT.md` (Checks paragraph), `docs/ACKNOWLEDGEMENTs.md`
   and `web/src/routes/about/+page.svelte` ("TypeScript 7"), and a CHANGELOG
   entry. Close this note with a dated "Done" section, as 16 records its own.
8. **IDE**: point WebStorm/VS Code at TypeScript 7 if it can; otherwise note
   that editor diagnostics come from whatever the IDE bundles.

## Proving it

The same evidence 16 collected for 7.0 - each piece catches a different way of
being wrong.

- **0 errors is not enough. Plant errors and see each one reported**, with
  every step exiting non-zero and `npm run typecheck` stopping at the first.
  The sites used on 2026-10-22, all marked with one token so they come out
  cleanly (delete the lines containing it):

  | File | Planted | Must be caught by |
  | --- | --- | --- |
  | `src/routes/about/+page.svelte` | `const x: number = "…"` in `<script lang="ts">` | `check` |
  | `src/routes/activity/+page.svelte` | `<Badge variant="nope">` - a wrong prop on `src/lib/ui/Badge.svelte`; passes silently if `.svelte` imports fall back to the `*.svelte` shim | `check` |
  | `src/routes/games/[appid]/+page.ts` | the same const | `check` |
  | `admin/src/views/RemoveView.svelte` | `<Badge variant="nope">` - admin importing `../src/lib/ui` | `check:admin` (**on TypeScript 7 this time**) |
  | `admin/vite.config.ts` | the const | `tsc -p admin/tsconfig.node.json` |
  | `admin/security.test.ts` | the const | `tsc -p admin/tsconfig.test.json` |
  | `worker/routes/updates.ts` | the const | `tsc -p tsconfig.worker.json` |
  | `shared/sort.test.ts` | the const | `tsc -p tsconfig.test.json` |

  On 7.0 with `--tsgo`, the admin check reported false errors in the *app's*
  components instead of the planted one - the failure the switch must not
  bring back.
- **Same programs.** `tsc -p <config> --listFilesOnly` under the old and the
  new setup, minus each compiler's own `lib` files; on 2026-10-22:
  `admin/tsconfig.node.json` 250, `admin/tsconfig.test.json` 164,
  `tsconfig.worker.json` 50, `tsconfig.test.json` 242, svelte-check's overlay
  1,219.
- **The whole Web CI sequence from a clean install**: `npm ci --ignore-scripts`,
  `npm run typecheck`, `npm test` (576 tests on 2026-10-22), `npm run build`,
  `node scripts/verify-dist.mjs --web`, `npm run cf:check`, `npm run knip`
  (diff against the baseline report), and
  `TAURI_ENV_PLATFORM=linux npm run build:desktop` + `node scripts/verify-dist.mjs --tauri`.
- **Lockfile**: still exactly three entries with `hasInstallScript`
  (fsevents, workerd, wrangler's esbuild); TypeScript 7's per-platform
  packages all `optional` with `os`/`cpu`; `npm ls typescript` shows one
  version.
- **Speed**, for the changelog: on 2026-10-22 the four `tsc` checks took
  6.0 s on TypeScript 6 and 0.5 s on 7.0; the app's svelte-check 7.2 s on 6
  and about 3 s with `--tsgo`; the admin's 4.6 s on 6.

## If it is not ready

Stay on the two-package setup; it is complete and tested, and nothing about
it expires. Move `@typescript/native` within 7.0.x by hand. Do not take 7.1
under the alias for the app alone while svelte-check's experimental mode is
broken on it (#3149) - `--tsgo` (the `tsc` command) may work, but prove it
with the planted errors before trusting it.

## Decide on the day

- **SvelteKit 3 first or after?** Kit 3 moves `$lib` to the `#lib` subpath
  import, which `--tsgo` resolved to the `*.svelte` shim
  ([#3142](https://github.com/sveltejs/language-tools/issues/3142)), and needs
  `cookie` 2. Whichever goes first, re-run the planted-error table after the
  second.
- The unrelated leftovers in 16's "Left for later" (Vite's native config
  loader, `__dirname` in tests, `worker-configuration.d.ts`) can ride along if
  the branch is open anyway, each as its own commit.
