# Changelog

All notable changes to this awesome noob repo will be documented here.

Every release has its own file in [`changelog/`](changelog/):
`changelog/v<major>/<major>.<minor>.x/<version>.md`, for example
[`changelog/v4/4.7.x/4.7.1.md`](changelog/v4/4.7.x/4.7.1.md). Pre-releases
go to [`changelog/beta/`](changelog/beta/) - none has been published. What is
not released yet is under [Unreleased] below; a release moves it into its own
file and adds the release to the table of its major version.

## [Unreleased]

### 🔒 Security

- The desktop and Android shell takes rustix 1.1.6, which fixes
  [RUSTSEC-2026-0486](https://rustsec.org/advisories/RUSTSEC-2026-0486.html):
  its extended-attribute calls could mark memory as written that the system
  never wrote, when handed an empty buffer. Those calls are reachable through
  the updater's archive code (tar, then xattr). Dependabot raised no alert
  for it; the weekly OSV check of `Cargo.lock` found it. Only the lockfile
  changes (rustix's entry alone); the apps take it with their next release.

### 🧊 Stable: maintenance mode (2026-11-11)

The project does what it set out to do, so from here it is kept running
rather than extended. Nothing changes for readers: the pipeline still
refreshes the list every day, and the site and the apps stay up.

- **No new features.** Code changes only for security advisories, runtime and
  dependency updates, and whatever those break.
- **Issues and pull requests are for the data.** Two new forms, **Add games**
  and **Edit game**, join **Delete games**; **Bug report** and
  **Accessibility barrier** stay for things that are broken. The feature
  request, feedback and off-topic forms are gone, blank issues are off, and
  the chooser sends questions to Discussions and vulnerabilities to private
  reporting.
- The About page's "Report something" links follow: add, correct, remove,
  bug, accessibility. The released apps (2.5.1) still link the old feature
  form, which now opens the form chooser; they take the new links with their
  next release.
- README: a status badge, build badges (Web CI, Python Tests, CodeQL,
  SonarCloud gate and coverage), live desktop and Android version badges, and
  the licences and runtimes. CONTRIBUTING, SECURITY, the pull-request
  template and CLAUDE.md state the same policy.
- No legal document you accept changed, so nobody is asked to accept the
  terms again.

### 🔍 Code analysis: Qodana

- JetBrains Qodana now checks every pull request and every change to `main`,
  next to CodeQL and SonarCloud, as three Qodana Cloud projects: Python for
  the data pipeline, JavaScript/TypeScript and Svelte for the site, the admin
  pages and the Worker, and Rust for the desktop and Android shell. Any
  problem fails the check; what each part leaves out on purpose is listed,
  with the reason, in its `qodana.yaml`.
- Its first findings are fixed, none of them a change in behaviour: tidier
  returns, docstrings and names in the pipeline, the leaderboards' catch-all
  `except:` narrowed to the errors a review string can raise, an unused
  import, two simpler regular expressions; two comma expressions, a trivial
  `if` and read-only fields in the web code; and `serde`, a crate the app
  shell declared and never used.
- Data commits and Markdown-only changes are not scanned. Nothing changes
  for readers, and the apps take the shell's one-line change with their next
  release.

### 🧰 Tooling & misc

- Dependencies: patch releases of the icon, dialog, toast and virtual-list
  libraries (Lucide 1.70.0, bits-ui 2.20.6, svelte-sonner 1.2.3, TanStack
  Virtual 3.13.52), Tailwind CSS 4.3.5, Vite 8.3.6, Vitest 5.1.0,
  svelte-check 4.7.8, wrangler 4.158.0, coverage 7.17.2, and the release and
  SonarCloud scan actions (3.0.4, 8.4.1). No security advisory among them;
  nothing changes in how the site or the apps behave, so no release: the
  apps take them with their next one.
- Dependencies, a week later: Lucide 1.72.0, bits-ui 2.21.0, Vite 8.3.8,
  wrangler 4.162.0, rollup-plugin-visualizer 7.1.3, knip 6.45.1, coverage
  7.17.3 and the SonarCloud scan action 8.5.0. knip 6.45 reads
  `tsconfig.json`'s `extends` and reported `$app` (the config
  `svelte-kit sync` generates) as a missing dependency, which failed CI; its
  `ignoreDependencies` cannot match a name that starts with `$`, so
  `knip.json` now ignores unlisted dependencies in `tsconfig.json` alone.
  Again no advisory and no change in behaviour, so no release.

## v4

| Version | Date | Edition |
|---|---|---|
| [v4.7.1](changelog/v4/4.7.x/4.7.1.md) | 2026-11-09 | Curb Cut |
| [v4.7.0](changelog/v4/4.7.x/4.7.0.md) | 2026-11-03 | Lucky Dip |
| [v4.6.1](changelog/v4/4.6.x/4.6.1.md) | 2026-10-31 | Zip Tie |
| [v4.6.0](changelog/v4/4.6.x/4.6.0.md) | 2026-10-30 | Polyglot |
| [v4.5.1](changelog/v4/4.5.x/4.5.1.md) | 2026-10-27 | Speed Bump |
| [v4.5.0](changelog/v4/4.5.x/4.5.0.md) | 2026-10-26 | Groundwork |
| [v4.4.1](changelog/v4/4.4.x/4.4.1.md) | 2026-10-26 | Tune-Up |
| [v4.4.0](changelog/v4/4.4.x/4.4.0.md) | 2026-10-23 | Headroom |
| [v4.3.3](changelog/v4/4.3.x/4.3.3.md) | 2026-10-19 | Locksmith |
| [v4.3.2](changelog/v4/4.3.x/4.3.2.md) | 2026-10-16 | Pigeonhole |
| [v4.3.1](changelog/v4/4.3.x/4.3.1.md) | 2026-10-16 | Fair Play |
| [v4.3.0](changelog/v4/4.3.x/4.3.0.md) | 2026-10-13 | Autopilot |
| [v4.2.1](changelog/v4/4.2.x/4.2.1.md) | 2026-10-10 | Age Gate |
| [v4.2.0](changelog/v4/4.2.x/4.2.0.md) | 2026-10-03 | All-Time High |
| [v4.1.1](changelog/v4/4.1.x/4.1.1.md) | 2026-10-03 | Pocket-Sized |
| [v4.1.0](changelog/v4/4.1.x/4.1.0.md) | 2026-10-02 | Featherweight |
| [v4.0.2](changelog/v4/4.0.x/4.0.2.md) | 2026-09-29 | Right Address |
| [v4.0.1](changelog/v4/4.0.x/4.0.1.md) | 2026-09-23 | Human Check |
| [v4.0.0](changelog/v4/4.0.x/4.0.0.md) | 2026-09-17 | Rewrite |

## v3

| Version | Date | Edition |
|---|---|---|
| [v3.4.3](changelog/v3/3.4.x/3.4.3.md) | 2026-09-11 | Own Domain |
| [v3.4.2](changelog/v3/3.4.x/3.4.2.md) | 2026-06-15 | Android Floor |
| [v3.4.1](changelog/v3/3.4.x/3.4.1.md) | 2026-06-14 | Chart Hotfix |
| [v3.4.0](changelog/v3/3.4.x/3.4.0.md) | 2026-06-13 | Legal Consent Gate |
| [v3.3.0](changelog/v3/3.3.x/3.3.0.md) | 2026-06-12 | Lazy-Load + Error Pages |
| [v3.2.7](changelog/v3/3.2.x/3.2.7.md) | 2026-05-22 | Coming-Soon Guard + Dead-Code Cleanup |
| [v3.2.6](changelog/v3/3.2.x/3.2.6.md) | 2026-05-20 | Mobile Hotfix |
| [v3.2.5](changelog/v3/3.2.x/3.2.5.md) | 2026-05-20 | AC Nav + Mobile + Games Cleanup |
| [v3.2.4](changelog/v3/3.2.x/3.2.4.md) | 2026-05-20 | Refactor + Removed-Games + Anti-Cheat Index |
| [v3.2.3](changelog/v3/3.2.x/3.2.3.md) | 2026-05-17 | View Commit Toast + Offline AC Lock |
| [v3.2.2](changelog/v3/3.2.x/3.2.2.md) | 2026-05-11 | Bug Fix Quartet |
| [v3.2.1](changelog/v3/3.2.x/3.2.1.md) | 2026-05-11 | Genre Cleanup |
| [v3.2.0](changelog/v3/3.2.x/3.2.0.md) | 2026-05-11 | SEO + Donate + Auto-Discussion + Health Polish + Dev Docs |
| [v3.1.0](changelog/v3/3.1.x/3.1.0.md) | 2026-05-09 | Less CI Noise, Lighter Images, Dead-Game Detection |
| [v3.0.1](changelog/v3/3.0.x/3.0.1.md) | 2026-05-07 | Desktop Actually Ships This Time |
| [v3.0.0](changelog/v3/3.0.x/3.0.0.md) | 2026-05-07 | It Has a Website Now |

## v2

| Version | Date | Edition |
|---|---|---|
| [v2.1.0](changelog/v2/2.1.x/2.1.0.md) | 2026-03-28 | Extension-Ready + Performance |
| [v2.0.0](changelog/v2/2.0.x/2.0.0.md) | 2026-03-26 | Finally Got Serious |

## v1

| Version | Date | Edition |
|---|---|---|
| [v1.1.3](changelog/v1/1.1.x/1.1.3.md) | 2026-01-15 | — |
| [v1.1.2](changelog/v1/1.1.x/1.1.2.md) | 2026-01-11 | — |
| [v1.1.1](changelog/v1/1.1.x/1.1.1.md) | 2026-01-07 | — |
| [v1.1.0](changelog/v1/1.1.x/1.1.0.md) | 2025-12-30 | Scale Noob |
| [v1.0.0](changelog/v1/1.0.x/1.0.0.md) | 2025-12-22 | Initial stable release |
