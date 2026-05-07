# DISCLAIMER

**This repository — including its data, scripts, web app, and documentation — is provided "AS IS" without warranty of any kind**, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, title, accuracy, completeness, and non-infringement. In no event shall the author(s) or copyright holder(s) be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the repository or the use or other dealings in its contents.

The MIT License (see [LICENSE](../LICENSE)) is the actual binding instrument. Everything below is supplemental — bullet points, not legalese — written so a human can understand the limits before relying on this list.

---

### Notes from the broke, unemployed maintainer (a.k.a. me)

- **No quality guarantees whatsoever.** Most games on the list got there because they're flagged free-to-play on Steam by the daily pipeline. The maintainer only kinda-sorta vouches for games personally played; check the `safe` column for that.

- **Bugs / pay-to-win / toxic community / crashes** in any game are between you, Valve, and the developer of that game. Do not contact the maintainer about them.

- **Definitely not 100 % complete or accurate.** Games change status, get delisted, flip to paid, or disappear overnight. Things get missed. Cross-reference the Steam page before forming an opinion.

- **Updates** happen whenever the maintainer feels like it (typically the GitHub Actions pipeline runs daily, but the maintainer manually overrides plenty). No SLA. This is a hobby.

- **Suing the maintainer:** the maintainer is broke, has zero relevant assets, and lives in Vietnam. Costs of action will exceed any plausible recovery. Save your money.

---

### Specific accuracy caveats

These are the known classes of error you should expect when relying on the data:

1. **Genre is best-effort and frequently wrong for hybrids.**
   The pipeline assigns one `genre` per game by reading the Steam-provided tag list and parsing the description text. For straightforward titles (FPS, MOBA, racing) it's usually right. For hybrids ("ARPG with deck-building roguelike elements"), indie experiments, or VR / educational titles, it picks one bucket and discards the rest. Use the `tags` field for the unfiltered Steam-tag set when you need accuracy.

2. **English-language assumption is hard-baked.**
   The HTML scraper, Python ingest pipeline, and the web-app filters all assume Steam pages and their search/store responses are returned in English. Steam's regional storefronts (`store.steampowered.com/?cc=jp`, `&cc=de`, etc.) sometimes localise game titles, genre strings, language-support tables, and DLC descriptions. If you hit the data via a regional storefront — or if Steam silently changes its localisation behaviour — names, genres, language counts, and DLC flags can come back wrong. Run anything important against the canonical EN page.

3. **Test-data leakage.**
   While building the web app, the maintainer ran live edit / add / delete tests against the production repo. Some test commits bumped genre/notes/anti-cheat fields on real games, and a handful of "queue 1 game for ingest" entries may have introduced dummy rows that the daily pipeline later cleaned up. If a row looks like it was edited mid-test (default values, joke notes), file a [Bug Report](https://github.com/poli0981/free-steam-games-list/issues/new?template=bug_report.yml).

4. **"Unsigned" commits in `Activity` are mostly dev artefacts.**
   The web app signs commits via the maintainer's OpenPGP key only when the key is unlocked in the browser session. Many commits that landed during development happened with the key locked — they show as `unsigned` rather than `Verified ✓`. They are not malicious; they're just lock-state artefacts. If you depend on Verified-only commits for trust, filter to Verified in the activity feed.

5. **Anti-cheat assessments come from regex over text.**
   `anti_cheat`, `is_kernel_ac`, and `anti_cheat_note` are populated by matching known AC names (VAC, EAC, BattlEye, Vanguard, …) against the Steam page text. If a game ships an AC under a vendor-renamed brand or only mentions it in a launcher EULA, the field will be `-`. Cross-check before relying on this for kernel-driver risk decisions.

6. **Player counts are sampled, not realtime.**
   `current_players` and `peak_today` come from periodic Steam Web API calls and lag by minutes-to-hours.

7. **Malware / safety flags are not antivirus output.**
   The `safe` field is a manual `y / n / ?` set by the maintainer based on personal experience or third-party reports. Run your own antivirus.

---

### Malware / viruses / safety

Steam's own platform has its own safety guarantees and policies — they are the relevant authority here. The maintainer is not your antivirus. Scan everything yourself. Do not assume `safe = "y"` means audited; it means "the maintainer played it and didn't get pwned, but no formal review."

### Updates

Whenever the maintainer remembers, plus whatever the GitHub Actions cron schedules. No fixed cadence, no on-call.

---

This project is licensed under the MIT License — see the [LICENSE](../LICENSE) file. The MIT text already includes broad disclaimer language; this file restates and extends it because (a) accuracy caveats deserve their own section, and (b) paranoia is free.

Last updated: whenever the maintainer remembered.
