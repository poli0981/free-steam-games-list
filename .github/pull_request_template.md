<!--
Thanks for the PR! One person reviews these by hand, so a short "what and why" goes a long way.
Everything here is public and permanent: keep personal info (email, real name, account IDs) out of it.
Written with an AI assistant? Fine - so was most of this repo. You still checked the boxes yourself.
Delete the sections that don't apply.
-->

## What and why

<!-- A sentence or two. "Closes #123" if it fixes an issue. -->

## Checks

- [ ] Web (`web/`): `npm run typecheck && npm test && npm run build && node scripts/verify-dist.mjs --web`
- [ ] Pipeline (`scripts/`): `python -m pytest scripts/tests`
- [ ] Docs or queued links only - nothing to run

## Accessibility (interface changes)

The longer version is in [ACCESSIBILITY.md](https://github.com/poli0981/free-steam-games-list/blob/main/ACCESSIBILITY.md#for-contributors).

- [ ] Works with the keyboard alone, and focus stays visible
- [ ] Controls and icon buttons have a name a screen reader can read; images have `alt` (`alt=""` when decorative)
- [ ] Nothing new is shown by colour or a hover tooltip alone, and text stays readable in both themes
- [ ] Still usable 360 px wide, at 200% zoom and with reduce motion on
- [ ] No new `svelte-ignore a11y_*`, or the description says why
- [ ] New text is in both `en.json` and `vi.json`

## Queued games (`scripts/temp_info.jsonl`)

- [ ] One store link per line, nothing else
- [ ] Free to play on Steam right now - not a demo, not a paid game
