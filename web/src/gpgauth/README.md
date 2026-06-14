# gpgauth/

This folder was added to host a local copy of OpenPGP.js so the web app could
ship without a runtime npm dependency. **It is not currently used** — the
single `openpgp.min.mjs` file split-codes its lazy chunks (`noble_curves.min.mjs`,
`noble_hashes.min.mjs`, …) which weren't dropped alongside it, so Rolldown
(Vite 8's bundler) fails to resolve them at build time.

The app now imports `openpgp` from the npm package instead, in
[`src/lib/gpg.ts`](../lib/gpg.ts). The npm bundle is fully self-contained
and Vite tree-shakes it down to ~129 KB gzipped (separate chunk, only
loaded when the GPG panel mounts).

If you want to switch back to the local copy:

1. Download the matching version's full dist from the
   [OpenPGP.js releases](https://github.com/openpgpjs/openpgpjs/releases) and
   place every `*.min.mjs` chunk into this folder (not just the entry).
2. Change the import in `src/lib/gpg.ts` from `"openpgp"` back to
   `"../gpgauth/openpgp.min.mjs"`.
3. Drop `openpgp` from `package.json`.

Otherwise this folder can safely be deleted.
