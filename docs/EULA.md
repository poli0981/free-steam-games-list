# END USER LICENCE AGREEMENT

**Short version:** two licences, not one. The code is
[MIT](../LICENSE); the dataset is [CC BY 4.0 with carve-outs](../LICENSE-DATA).
Where either licence conflicts with anything below, the licence text wins.

This file is plain-language commentary. It is not a separate contract that
grants or removes rights.

---

### 1. What you are actually getting

Three things, and they are not the same:

- **A dataset** of free-to-play Steam games, in `data/` and `games/`.
- **A website** at <https://free-steam-games.win> that reads it. Read-only:
  browse, search, filter, chart, export. There is no account and no sign-in.
- **Optionally, an installable app** — a desktop and Android build of the same
  interface, signed, with an auto-updater that checks GitHub Releases.

The previous version of this file said there was "no installable software."
That was never true of the desktop and Android builds, and is corrected here.

### 2. Licences

- Source code, scripts, configuration and docs: **MIT** ([LICENSE](../LICENSE)).
- The dataset: **CC BY 4.0** ([LICENSE-DATA](../LICENSE-DATA)), with explicit
  exclusions. Read that file before redistributing data — some fields are not
  the project's to license, notably `description` (publisher store copy) and
  `header_image` (a URL to publisher artwork).

### 3. What you agree to by using it

- You use the list at your own risk, and your relationship with any game is
  between you, Valve and that game's developer. Steam's
  [Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)
  governs that, not this.
- You will not treat the derived fields as authoritative. `genre`, `safe`,
  `anti_cheat` and `is_kernel_ac` are one person's best effort. Details in
  [DISCLAIMER.md](./DISCLAIMER.md).
- If you redistribute, you carry the correct licence for the part you are
  redistributing and keep the caveats visible.

### 4. What the maintainer commits to

Nothing. No SLA, no uptime guarantee, no support, no roadmap, no promise the
pipeline runs tomorrow. It is a hobby project maintained by one person and it
has already gone weeks at a time without updating.

### 5. The installable app

The desktop and Android builds are signed and update themselves from GitHub
Releases. Install them only from this project's Releases page. Nobody else's
build is this project's build, whatever it claims.

### 6. Trademarks

**Steam**, the Steam logo, **Valve**, **VAC** and related marks belong to Valve
Corporation. Game names and artwork belong to their publishers. All are used
here nominatively, to identify what a row refers to. This project is
independent and is not affiliated with, endorsed by, or sponsored by Valve or
any publisher listed.

### 7. Warranty and liability

None, to the extent the law allows. See [DISCLAIMER.md](./DISCLAIMER.md) and
the warranty clauses in both licence files.

### 8. Changes

This file is versioned in git. Material changes bump `TERMS_VERSION` in the
app, which re-prompts everyone rather than quietly swapping the terms.
