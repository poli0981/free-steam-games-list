# Toolchain 2026 — TypeScript 7, Node.js 26, Python 3.15

## Why this note exists

On 2026-10-22 the maintainer asked for an assessment of the whole repository
against TypeScript 7, Node.js 26 and Python 3.15, a plan to move to them, CI
included, and the fixes the move needs. This is that assessment, the
decisions it led to, and what to do next time. Every number below was
measured on the day, on the repository as it stood (`main` at e10d2e7b), with
Node 26.12.1 / npm 11.20.0 and Python 3.15.1 and 3.14.7 on the maintainer's
Windows machine.

The short version: Python 3.15 and Node 26 needed nothing but pins and four
file encodings. TypeScript 7 runs every type-check it can, but cannot yet
replace TypeScript 6, which stays installed beside it.

## Where each version lives now

| Runtime | Version | Written in | Repeated in | Held together by |
| --- | --- | --- | --- | --- |
| Node.js | 26 | `web/.node-version` | the five `setup-node` steps (quoted literals), `engines.node`, the `@types/node` major | `web/shared/toolchain.test.ts` |
| Node.js (Cloudflare build) | 26 | the Worker's dashboard: build variable `NODE_VERSION` | — | nothing; `docs/DEPLOYMENT.md` says to change it with the file |
| Python | 3.15 | every `setup-python` step (18) | `sonar.python.version`, the `--python-version` in `requirements.txt`'s header | `web/shared/toolchain.test.ts` |
| Python (CodeQL) | 3.14 | `codeql.yml` | — | named in the test's `PYTHON_EXCEPTIONS` |
| TypeScript | 7.0.x and 6.0.x | `web/package.json`: `@typescript/native` (`npm:typescript@~7.0.2`) and `typescript` (`^6.0.3`) | `.github/dependabot.yml` ignores | `web/shared/toolchain.test.ts` |

Web CI now also runs on `.github/workflows/**` and `sonar-project.properties`, so
a pull request that moves only a pin still meets the test. The test was proven
by breaking one pin at a time - one workflow's Python, `web/.node-version`
alone, a `setup-node` switched to `node-version-file` - and each failed it with
the file named. That also closes the
same hole for `web/shared/pipeline.test.ts`, which reads the workflows for the
`data-write` group and never ran on a workflow-only change.

## TypeScript 7

### What 7.0 is

TypeScript 7.0 (2026-07-08, `typescript@7.0.2`) is the compiler ported to Go:
`tsc` is a native binary from a per-platform optional package
(`@typescript/typescript-<os>-<arch>`), started by a small ESM launcher. It has
**no JavaScript API**; one is planned for 7.1 (`7.1.0-beta` is out). Every
option 7.0 removes - `target: es5`, `downlevelIteration`, `moduleResolution`
`node10`/`classic`, `module` `amd`/`umd`/`systemjs`/`none`, `baseUrl`,
`esModuleInterop`/`allowSyntheticDefaultImports: false`, `alwaysStrict: false`,
`module Foo {}` namespaces, import `assert`, `no-default-lib` - was already a
deprecation error in 6.0, and its defaults (`strict`, `types: []`,
`rootDir: .`, `noUncheckedSideEffectImports`) arrived in 6.0 too.

### What it meant here

The configuration was already 7-clean. All six hand-written tsconfigs use
`moduleResolution: bundler` and explicit `types`, none sets `baseUrl`, the
generated `.svelte-kit/tsconfig.json` uses relative `paths`, the three
side-effect imports resolve (`vite/client` declares `*.css`), and nothing set
`ignoreDeprecations`. The only stale entry was `"DOM.Iterable"` in the two
admin tsconfigs: an empty file since 6.0, now removed. (7.0.2 still ships it,
so the copy SvelteKit writes into `.svelte-kit/tsconfig.json` is harmless.)

What 7.0 cannot do is serve the tools that need the old API:

- **svelte-check** refuses to start when `typescript` is 7
  (`bin/ts-version-check.js`), and reads `typescript` as a library even in its
  TypeScript 7 modes.
- **`svelte-kit sync`** imports `typescript` to write the route `$types`.
- `@sveltejs/kit@2.70.3` and svelte-check both declare `typescript`
  `^5 || ^6`, and CI's `npm ci` has no fallback for a peer conflict.

The TypeScript team's own guidance is that Svelte, Vue and Astro projects
stay on 6.0 until the API exists. So `typescript` stays 6, and 7 arrives as
the alias svelte-check documents: `"@typescript/native": "npm:typescript@~7.0.2"`.
(`@typescript/native` is not a published package - it is only this alias's
name - and the `@typescript` scope belongs to Microsoft, so nothing else can
appear under it.) The other documented layout, `typescript` aliased to
`@typescript/typescript6`, was rejected: it turns `typescript` itself into an
alias, which Dependabot mishandles (below), and breaks
`require.resolve("typescript/bin/tsc")`.

### How the checks run

| Check | Before | Now |
| --- | --- | --- |
| `check` (app, `tsconfig.json`) | svelte-check, TS 6 | `svelte-check --tsgo`, TS 7 |
| `check:admin` (`admin/tsconfig.json`) | svelte-check, TS 6 | unchanged, TS 6 |
| `admin/tsconfig.node.json`, `admin/tsconfig.test.json`, `tsconfig.worker.json`, `tsconfig.test.json` | `tsc -p`, TS 6 | `node node_modules/@typescript/native/bin/tsc -p`, TS 7 |

Two details decide that table:

- **Both packages declare a `tsc` bin**, so `node_modules/.bin/tsc` is
  whichever npm linked last. Every script names TS 7 by path; the test fails
  on a bare `tsc`. svelte-check finds TS 7 itself, by the alias's name, and
  runs the bin its `package.json` declares.
- **`--tsgo` cannot follow `.svelte` imports from outside its tsconfig's
  folder.** It emits every component under the working directory (`web/`)
  into `.svelte-kit/.svelte-check`, then rewrites the tsconfig's `include`
  relative to that mirror; for `web/admin/tsconfig.json` the rewritten
  `src/**/*.svelte` lands on the *app's* components, and admin's imports of
  `../src/lib/ui/*.svelte` fall back to the ambient `declare module "*.svelte"`
  shim - unchecked props and no error (language-tools #3142 is the same
  failure through `package.json#imports`). So the admin stays on TS 6.
  `--tsgo-experimental-api` has no such limit but calls itself experimental,
  still crashes in some setups (#3095) and breaks on 7.1 (#3149), so it stays
  out of CI. That is also why the alias is `~7.0`, not `^7`.

### What was measured

- **Same programs.** `--listFilesOnly` gives the same files under 6.0.3 and
  7.0.2 for every config, apart from each compiler's own `lib` files:
  `admin/tsconfig.node.json` 250, `admin/tsconfig.test.json` 164,
  `tsconfig.worker.json` 50, `tsconfig.test.json` 242, and svelte-check's
  overlay (`.svelte-kit/.svelte-check/tsconfig.json`) 1,219.
- **Same verdict.** 0 errors on both, before and after `@types/node` moved
  from 22 to 26 (bumped first, still on 6, so a types error would have been
  its own).
- **Real checking, proven with planted errors.** A deliberate type error was
  put into: a route's `<script>` (`about/+page.svelte`); a wrong `variant` on
  `src/lib/ui/Badge.svelte` from `activity/+page.svelte` - the case that would
  pass silently if `--tsgo` fell back to the `*.svelte` shim; a universal
  `+page.ts`; one file of each `tsc -p` config; and a wrong `variant` in the
  admin. TypeScript 7 reported all seven non-admin ones, TypeScript 6 the
  admin one, each step exited 1, and `npm run typecheck` stopped at the first.
  The same admin check under `--tsgo` instead reported false errors in the
  *app's* components (`Cannot find module '$lib/...'`, `Module '"*.svelte"' has
  no exported member ...`) - the mis-mapping described above, observed.
- **Faster.** The four `tsc -p` checks: 6.0 s on TypeScript 6, 0.5 s on 7.
  The app's svelte-check: 7.2 s in its TypeScript 6 mode, about 3 s with
  `--tsgo` (most of it svelte2tsx and `svelte-kit sync`).

`svelte-kit sync` prints a Vite warning about `configLoader: 'native'` on every
run, here and before this change: Vite 8 is announcing a future default that
`vite.config.ts` is not ready for (`__dirname`, extensionless imports). It is
not caused by TypeScript 7 or Node 26; see "Left for later".

### Dependabot

`typescript` majors were already ignored; the reason is now written down
(7 would break svelte-check and kit's peer range). The alias is ignored
outright: dependabot-core does not resolve `npm:` aliases reliably (#16488,
open), and would either fail on a package that does not exist or try to
"update" it as `typescript`. Bump the two together by hand.

## Node.js 26

26.0.0 shipped on 2026-05-05 and becomes LTS on 2026-10-28; 26.12.1 is current.
Its removals (`http.Server.prototype.writeHeader`, the `_stream_*` modules,
`--experimental-transform-types`) and new runtime deprecations (DEP0190
`args` with `shell`, DEP0203/DEP0204 `CryptoKey` into `node:crypto`, DEP0205
`module.register()`, DEP0201 `Duplex.toWeb` `type`) touch nothing here: no
`child_process`, no `module.register`, no `url.parse`, no legacy `util` or
`Buffer` constructor, no `--experimental-*` flag anywhere in `web/`. No `.ts`
file is run by Node directly, so 26's type stripping never meets the two
classes with parameter properties (`worker/testing/sqlite-d1.ts`,
`admin/src/lib/api.ts`). All 482 `engines` ranges in the lockfile accept 26.

Two runtime notes:

- `node:sqlite`'s `DatabaseSync` (the in-memory D1 for tests) is
  documentation-deprecated in favour of `Database` (DEP0210), but
  `@types/node@26` declares only `DatabaseSync`, so it stays.
- Node 26 returns `undefined` for `localStorage` without
  `--localstorage-file`, and prints an `ExperimentalWarning` when code touches
  it. Every read in the app is inside a try/catch or behind `typeof window`;
  the warning in a test or prerender log is noise.

The whole Web CI sequence passes on Node 26.12.1 from a clean
`npm ci --ignore-scripts`: the type-check, all 576 tests, the build and
`verify-dist --web`, `wrangler deploy --dry-run`, knip (its report unchanged
from before the upgrade), and the Tauri-flavour build with `verify-dist
--tauri`. The lockfile still has exactly three packages with install scripts.

The pins: `web/.node-version` (new, `26`), the five `setup-node` steps
(`'24'` → `'26'`), `engines.node` (`>=26`, advisory: npm warns, nothing
enforces it) and `@types/node` `^22.20.5` → `^26.6.5`. The steps keep quoted
literals rather than `node-version-file` because `release-android.yml` checks
out the tag it rebuilds, and every tag older than this change has no
`web/.node-version`. Cloudflare's build image documents `NODE_VERSION`,
`.nvmrc` and `.node-version`, but not which directory it reads or which wins,
so the dashboard variable stays and `docs/DEPLOYMENT.md` records it.

## Python 3.15

3.15.0 shipped on 2026-10-09. The changes that could have mattered:

- **PEP 686: UTF-8 Mode is the default.** `open()` without an `encoding`
  now writes UTF-8 on Windows too. Four writes in `scripts/` had none:
  `check_dead_links.py` (the dead-link log), `top_online.py` and
  `top_offline.py` (the leaderboards) and `core/data_store.py`
  (`clear_temp()`, an empty string). Under 3.14 on this machine the default
  is `cp1252`, which cannot encode the leaderboards' 🎮, so the first three
  crashed on Windows; CI on Linux already wrote UTF-8, so no committed output
  changes. All four now name `encoding="utf-8"`, and an AST scan finds no
  text-mode `open`/`read_text`/`write_text` without one.
- **Removals** (`sre_*`, `glob.glob0/glob1`, `PurePath.is_reserved`,
  `platform.java_ver`, `CGIHTTPRequestHandler`, `typing.no_type_check_decorator`,
  the `NamedTuple` keyword form, `load_module()`...) and **`strptime` refusing
  `%d` without a year**: none used. Every `strptime` format here has `%Y`;
  every "now" is timezone-aware; nothing uses asyncio, threading,
  multiprocessing, subprocess or `locale`.
- **Dependencies** install unchanged with `--require-hashes --only-binary :all:`:
  charset-normalizer 3.5.2 (the only compiled one) has cp315 wheels for every
  platform, already hashed in `requirements.txt`; the rest are py3-none-any,
  and pytest 9.1.1 declares 3.15. `uv pip compile --universal` produces the
  same lock for `--python-version 3.12` and `3.15`, so only the header moved.
- **A new Unicode database** could have changed what `core/normalize.py`
  writes (NFC, `casefold`, the `[^\W\d_]` letter class) and so rewritten
  shards and forced every reader to re-download. It does not: a full
  `save_main(load_main())` on a copy of the data under 3.15 leaves all 36 files
  (13 shards, `index.json`, the blocklist, the overrides,
  `scripts/removed_games.jsonl`) byte-identical to HEAD, exactly as under 3.14.

Measured on 3.15.1: the 299 tests pass with `-X warn_default_encoding
-W error::EncodingWarning -W error::DeprecationWarning`; `edit_game.py --check`
and `delete_game.py --check` pass; vulture and pip-audit run. pip-audit flagged
`certifi 2026.10.18` (GHSA-6q48-6c7w-9gw2: eMudhra's `emSign ECC Root CA - G3`
had intermediates with compromised keys). 2026.10.18 had in fact dropped every
emSign root, but the advisory's range covers it; 2026.10.19 restores the three
unaffected ones and keeps G3 out. It went in on the same branch, in a commit of
its own, with `uv pip compile`'s hashes for both of its files.

CI: sixteen `setup-python` steps moved from `'3.12'` to `'3.15'`; the
`updater-json` job of `release-desktop.yml`, which ran the image's `python3`,
now sets up 3.15 like the rest. `codeql.yml` alone uses 3.14: CodeQL's
supported-languages page lists Python up to 3.14 and its extractor runs on
that interpreter. The pipeline uses no 3.15-only syntax, so nothing goes
unparsed. `sonar.python.version` is 3.15. SonarCloud's sonar-python does not
list 3.15 yet: the CI scan (2026-10-22) warns and analyses as 3.14, which
changes nothing for this code.

## Next time

**Node.** Change `web/.node-version`; the test then names every place that
must follow: the five `setup-node` literals, `engines.node` and the
`@types/node` range. Change the dashboard's `NODE_VERSION` in the same breath.
The `@types/node` major is held back by Dependabot on purpose - it follows the
runtime, not the newest Node.

**Python.** Change `sonar.python.version`; the test names every `setup-python`
step and the `requirements.txt` header that must follow. Before merging, check
the lock still installs (`pip install --require-hashes --only-binary :all:`
on the new version: a compiled dependency without wheels fails here), run the
suite with encoding and deprecation warnings as errors, and repeat the
no-churn check: copy `data/data_*.jsonl`, `index.json`, `blocklist.jsonl`,
`overrides/` and `scripts/removed_games.jsonl` into a scratch folder with the
same layout, run `save_main(load_main())` there (the data paths are
relative - never from the repo root), and compare every file with HEAD.
Revisit the CodeQL exception: drop it when CodeQL lists the pipeline's
version (the test fails if the exception equals the main version).

**TypeScript.** TypeScript 6 goes when svelte-check accepts TypeScript 7 on
its own (and `svelte-kit sync` has a 7 path) - the plan is to do it with
TypeScript 7.1, and [17-typescript-7.1.md](17-typescript-7.1.md) is the
runbook: the conditions and how to check them, the steps, and the evidence to
collect. Until then, move `@typescript/native` within 7.0.x by hand, and to 7.1
only once svelte-check supports it.

## Left for later

- **SvelteKit 3**: its own migration (the `cookie` override, `#lib` imports -
  and #3142 above).
- Four workflows still use `actions/checkout@v4` and `actions/setup-python@v5`
  (mark-dead-games, snapshot-daily, top-offline, top-online); they install
  3.15 fine.
- `web/worker-configuration.d.ts` is stale (`IMG_MINT_PER_TICK: "10"` against
  `"40"` in `wrangler.jsonc`, runtime types from workerd 1.20260908.1): rerun
  `npm run cf:types`.
- Eleven tests use `__dirname`, which works only because Vitest injects it;
  Vitest 6 may stop. The new test uses `import.meta.url`.
- Workers Builds' watch paths in the dashboard (include `*`) do not match
  `docs/DEPLOYMENT.md`, so every bot data commit deploys.
- Vite's coming native config loader: `vite.config.ts` uses `__dirname` and
  imports `./build/game-seeds` and `./build/legal-versions` (and through them
  `src/lib/game-seed`, `src/lib/legal`, `./schema`) without extensions; Vite 8
  warns on every `svelte-kit sync`. Before a Vite major makes `native` the
  default, use `import.meta.dirname` and add the extensions.

## Sources

- TypeScript: [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/),
  [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/),
  [typescript-go CHANGES.md](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md).
- svelte-check: [README](https://github.com/sveltejs/language-tools/tree/master/packages/svelte-check),
  issues [#3063](https://github.com/sveltejs/language-tools/issues/3063),
  [#3142](https://github.com/sveltejs/language-tools/issues/3142),
  [#3149](https://github.com/sveltejs/language-tools/issues/3149),
  [#3095](https://github.com/sveltejs/language-tools/issues/3095),
  [#3120](https://github.com/sveltejs/language-tools/issues/3120).
- Node.js: [26.0.0 release notes](https://nodejs.org/en/blog/release/v26.0.0),
  [deprecations](https://nodejs.org/api/deprecations.html).
- Python: [What's new in Python 3.15](https://docs.python.org/3.15/whatsnew/3.15.html).
- Tools: [CodeQL supported languages](https://codeql.github.com/docs/codeql-overview/supported-languages-and-frameworks/),
  [Workers Builds build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/),
  [dependabot-core #16488](https://github.com/dependabot/dependabot-core/issues/16488).
