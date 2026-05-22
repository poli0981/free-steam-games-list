# Third-Party Dev Tooling

Dev-time tools the project depends on for dead-code detection, linting, and
dependency auditing. None of these ship in the data pipeline, the web bundle, or
the desktop app — they only run on a maintainer's machine before a release.

Runtime dependencies (the libraries that actually ship) live in
[`ACKNOWLEDGEMENTs.md`](./ACKNOWLEDGEMENTs.md) and the in-app
**About → Stack & third-party** section.

## Dead-code & audit tools

Added in v3.2.7 to make the pre-publish checks below runnable.

| Tool | Scope | Purpose | License |
| --- | --- | --- | --- |
| [knip](https://knip.dev) | Web app (`web/`) | Finds unused files, exports, types, enum members, and dependencies in the TypeScript SPA. | ISC |
| [vulture](https://github.com/jendrikseipp/vulture) | Python pipeline (`scripts/`) | Finds unused functions, classes, variables, imports, and unreachable code. | MIT |
| [pip-audit](https://github.com/pypa/pip-audit) | Python pipeline | Audits the pinned Python dependencies against the OSV / PyPI Advisory vulnerability databases. | Apache-2.0 |

### Where they're declared

- **knip** — `web/package.json` `devDependencies`; config in [`../web/knip.json`](../web/knip.json).
- **vulture** + **pip-audit** — [`../requirements-dev.txt`](../requirements-dev.txt); vulture config in [`../pyproject.toml`](../pyproject.toml) under `[tool.vulture]`.

Install the Python dev tools with `pip install -r requirements-dev.txt` from the
repo root. The web tooling arrives with `npm install` inside `web/`.

## Pre-publish checks

Run this suite from a clean checkout before tagging / re-publishing a release,
and fix every error before continuing.

**Web** — from `web/`:

```sh
npm run knip        # dead code: unused files / exports / deps
npm run typecheck   # tsc strict — also flags unused locals & params
npm run build       # full production build must pass
npm audit           # dependency CVEs
```

**Python** — from the repo root:

```sh
vulture scripts/                  # dead code
pip-audit -r requirements.txt     # dependency CVEs
```

A confirmed false positive belongs in the tool's ignore config — `ignore` /
`ignoreDependencies` in `web/knip.json`, or a higher `min_confidence` /
whitelist for `[tool.vulture]` in `pyproject.toml` — never suppressed silently.
