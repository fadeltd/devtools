# Contributing

Thanks for looking. This is a small, opinionated project, so the fastest way to
get a change merged is to know what it already decided.

## Before you open a PR

**Read `CLAUDE.md`.** It is written for AI assistants but it is the real rule
set, and several of its rules look like trivia while actually being
silent-data-corruption bugs. The ones people hit most:

- `parseLines("a\nb\n")` must yield **2** lines, not 3.
- Never leave `\r` glued to a line end — `"a\r" !== "a"` breaks dedupe and sort.
- `btoa` on a string breaks non-ASCII. Go through `TextEncoder`.
- Hoist `Intl.Collator`; calling `localeCompare` per comparison is 12× slower.
- `crypto.getRandomValues` throws above 65,536 bytes per call.

## The two rules that shape everything

**1. Nothing the user pastes may leave the browser.**

This is the whole product, not a feature. It is why there is no backend, no
analytics, no third-party requests, and why fonts are self-hosted. A PR that
adds a network call to a third party will be declined regardless of how useful
it is. In particular: **no fetch proxy, ever** — it would make this an open
proxy on our own domain, and it would make the promise above a lie.

The CSP in `public/_headers` enforces this and doubles as a dependency filter:
**no `'unsafe-eval'`**. A library that needs `new Function` or `eval` is
declined on those grounds alone.

**2. Logic lives in `core/`, not in components.**

Every tool is `src/tools/<slug>/core/**` — pure functions taking strings, bytes
and options, returning data, with no React, DOM or store imports — plus a thin
`.tsx` shell.

All test effort goes into `core/`. There are no component tests and no
end-to-end suite, and that is deliberate. If your PR adds logic to a `.tsx`
file, it is probably in the wrong place.

## Adding a tool

One new folder under `src/tools/` plus one entry in `src/lib/registry/index.ts`.
The router, home grid, sidebar, command palette, build-time prerender and
sitemap all read from that registry, so nothing else needs editing. **If you
find yourself hand-editing the router or the sitemap script, stop** — the
abstraction is broken and fixing that is the actual change.

## Checks

```bash
pnpm install          # pnpm only, never npm or yarn
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
```

All four must pass. `pnpm test` includes property tests (`fast-check`); if you
touch parsing, encoding or sorting, add one — they have caught real bugs here
that example-based tests missed.

Keep the entry bundle under ~90 kB gzip. Heavy dependencies belong inside a
lazy route chunk, never the shell.

## Scope

Small, focused PRs. If you are planning something large, open an issue first —
the project has a deliberate list of things it will not do, and it would be a
shame for you to build one of them.

## Releases

**You never pick a version number, and you never write a release date.**

While you work, add your entry under `## [Unreleased]` in `CHANGELOG.md`, using
a Keep a Changelog heading:

```markdown
## [Unreleased]

### Added
- The thing you added
```

Merging to `main` then does the rest, automatically:

1. Reads `[Unreleased]` and derives the semver bump from its headings —
   `### Breaking` → major, `### Added` → minor, anything else
   (`Fixed`, `Changed`, `Security`, `Removed`) → patch.
2. Rewrites `CHANGELOG.md`, moving `[Unreleased]` into a dated
   `## [x.y.z]` section and leaving a fresh empty `[Unreleased]` behind.
3. Bumps `version` in `package.json`, commits that back to `main`, and pushes
   the tag `vx.y.z`.
4. **The tag** triggers the deploy to Cloudflare. Merging alone never deploys.

An empty `[Unreleased]` releases nothing, so a docs-only or refactor merge ships
nothing. That is deliberate: merging and releasing are separate decisions.

Two notes for anyone editing the workflows:

- `### Removed` is deliberately a *patch*, not a major. Inferring a major bump
  from a tidy-up would let a cleanup silently become a 1.0. Major requires an
  explicit `### Breaking` heading.
- Below 1.0, a breaking change bumps the minor (`0.4.2` → `0.5.0`), per semver
  convention for pre-stable projects.

The bump logic lives in `scripts/changelog.ts` and is unit-tested, because a
mistake there silently ships the wrong version. Preview what a merge would do:

```bash
pnpm exec vite-node scripts/release.ts --dry-run
```

## Licence

By contributing you agree your contributions are licensed under the MIT
Licence, the same terms that cover the project.
