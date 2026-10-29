# Contributing

Thanks for looking. This is a small, opinionated project, so the fastest way to get a change merged is to know what it already decided.

## Before you open a PR

**Read `CLAUDE.md`.** It is written for AI assistants but it is the real rule set, and several of its rules look like trivia while actually being silent-data-corruption bugs. The ones people hit most:

- `parseLines("a\nb\n")` must yield **2** lines, not 3.
- Never leave `\r` glued to a line end — `"a\r" !== "a"` breaks dedupe and sort.
- `btoa` on a string breaks non-ASCII. Go through `TextEncoder`.
- Hoist `Intl.Collator`; calling `localeCompare` per comparison is 12× slower.
- `crypto.getRandomValues` throws above 65,536 bytes per call.

## The two rules that shape everything

**1. Nothing the user pastes may leave the browser.**

This is the whole product, not a feature. It is why there is no backend, no analytics, no third-party requests, and why fonts are self-hosted. A PR that adds a network call to a third party will be declined regardless of how useful it is. In particular: **no fetch proxy, ever** — it would make this an open proxy on our own domain, and it would make the promise above a lie.

The CSP in `public/_headers` enforces this and doubles as a dependency filter: **no `'unsafe-eval'`**. A library that needs `new Function` or `eval` is declined on those grounds alone.

**2. Logic lives in `@fadeltd/devtools-core`, not in components.**

Every tool's engine is in `packages/core/src/<slug>/` — pure functions taking strings, bytes and options, returning data, with no React, DOM, app or store imports (oxlint enforces this) — published to npm as `@fadeltd/devtools-core`. The site imports the compiled package and adds a thin `.tsx` shell in `src/tools/<slug>/`.

All test effort goes into the package. There are no component tests and no end-to-end suite, and that is deliberate. If your PR adds logic to a `.tsx` file, it is probably in the wrong place.

## Adding a tool

The engine in `packages/core/src/<slug>/` (an `index.ts` plus an `exports` entry in `packages/core/package.json`), one folder under `src/tools/`, and one entry in `src/lib/registry/index.ts`. The router, home grid, sidebar, command palette, build-time prerender and sitemap all read from that registry, so nothing else needs editing. **If you find yourself hand-editing the router or the sitemap script, stop** — the abstraction is broken and fixing that is the actual change.

## Checks

```bash
pnpm install          # pnpm only, never npm or yarn
pnpm typecheck        # builds the package first: the app imports its dist/
pnpm lint
pnpm test
pnpm build
```

All four must pass. `pnpm test` includes property tests (`fast-check`); if you touch parsing, encoding or sorting, add one — they have caught real bugs here that example-based tests missed.

Keep the entry bundle under ~90 kB gzip. Heavy dependencies belong inside a lazy route chunk, never the shell.

## Scope

Small, focused PRs. If you are planning something large, open an issue first — the project has a deliberate list of things it will not do, and it would be a shame for you to build one of them. The **Tool or feature request** issue form lists the standing no's, and the pull request template carries the checklist from this file.

## Releases

**You never pick a version number, and you never write a release date.**

While you work, add your entry under `## [Unreleased]` in `CHANGELOG.md`, using a Keep a Changelog heading:

```markdown
## [Unreleased]

### Added
- The thing you added
```

Merging to `main` then does the rest, automatically:

1. Reads `[Unreleased]` and derives the semver bump from its headings — `### Breaking` → major, `### Added` → minor, anything else (`Fixed`, `Changed`, `Security`, `Removed`) → patch.
2. Rewrites `CHANGELOG.md`, moving `[Unreleased]` into a dated `## [x.y.z]` section and leaving a fresh empty `[Unreleased]` behind.
3. Bumps `version` in `package.json`, commits that back to `main`, and tags that release commit `vx.y.z` with a GitHub release.
4. Starts the deploy to Cloudflare for that tag. Merging alone never deploys.

If a run commits the release but fails before tagging it, the next run finishes the job: Release tags every release commit on `main` that is still missing its tags or GitHub release, oldest first, and deploys the newest.

If a release lands on `main` while your branch is open, merge `main` in and make sure your entries are still under `## [Unreleased]`. A plain merge keeps a new line next to its old neighbours, which may now sit under the new version heading, and then your merge releases nothing. CI fails the PR when that happens.

**Never create or push a `v*` or `core-v*` tag yourself.** Release tags the release commit, the one that bumps the version. A hand-made tag on the merge commit points at code whose `package.json` still has the old version, and Release now refuses to continue when it finds one. To look at or publish a release locally, wait for the tag to appear (`git fetch --tags`).

An empty `[Unreleased]` releases nothing, so a docs-only or refactor merge ships nothing. That is deliberate: merging and releasing are separate decisions.

Deploy is always started explicitly by Release, never left to the tag event. A tag pushed by automation may or may not trigger `on: push: tags` depending on which credential pushed it, and a deploy that silently does not happen looks exactly like a deploy that succeeded. Dispatching every time is deterministic, and Deploy is idempotent so a duplicate run is harmless.

### The package releases separately

`@fadeltd/devtools-core` has its own `packages/core/CHANGELOG.md` and its own version, released by the same workflow and tagged `core-vx.y.z`, then published to npm with provenance. Add an entry there when you change an engine's API or behaviour; add one to the site's `CHANGELOG.md` as well if a visitor would notice. Either, both or neither may release on a merge. A core tag never deploys the site.

Before 1.0, a minor version of the package may change its API, so mark those entries `### Breaking`.

Publishing uses npm **trusted publishing**: npm checks that the upload comes from `release.yml` in `fadeltd/devtools` over OIDC, so no npm token is stored anywhere and nothing needs rotating. Provenance is attached automatically.

#### Trusted publisher setup

npm only accepts a trusted publisher for a package name that exists on the registry. For `@fadeltd/devtools-core` this is already done: the name is registered with an empty `0.0.0-stage` placeholder (no code, nothing installable), and `release.yml` in `fadeltd/devtools` is its trusted publisher. Every version, including the first, is published by CI. To check or redo it, logged in to npm with 2FA:

```bash
npm trust list @fadeltd/devtools-core
npm trust github @fadeltd/devtools-core --repo fadeltd/devtools --file release.yml --allow-publish
```

Renaming the workflow file breaks publishing until the trust is updated to match. Optionally, set the package's publishing access on npmjs.com to "Require two-factor authentication and disallow tokens", so trusted publishing is the only way in.

Two notes for anyone editing the workflows:

- `### Removed` is deliberately a *patch*, not a major. Inferring a major bump from a tidy-up would let a cleanup silently become a 1.0. Major requires an explicit `### Breaking` heading.
- Below 1.0, a breaking change bumps the minor (`0.4.2` → `0.5.0`), per semver convention for pre-stable projects.

The bump logic lives in `scripts/changelog.ts` and is unit-tested, because a mistake there silently ships the wrong version. Preview what a merge would do:

```bash
pnpm exec vite-node scripts/release.ts --dry-run
```

## Licence

By contributing you agree your contributions are licensed under the MIT Licence, the same terms that cover the project.
