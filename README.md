# devtools.fadeltd.dev

Developer utilities that run entirely in your browser.

**Nothing you paste is ever uploaded.** There is no backend — the site is static
assets on Cloudflare Workers, so there is no server to send your input to. Paste
a production token or a customer payload without thinking about it.

→ **[devtools.fadeltd.dev](https://devtools.fadeltd.dev)**

## Tools

| | |
|---|---|
| **[Diff Checker](https://devtools.fadeltd.dev/diff)** | Side-by-side or unified, word-level highlighting, collapsed unchanged regions, `Alt+↑/↓` to jump between changes |
| **[Base64](https://devtools.fadeltd.dev/base64)** | Encode/decode with correct UTF-8, base64url, padding control. Unwraps PEM/MIME line breaks and `data:` URIs, and tells you what it changed |
| **[List Tools](https://devtools.fadeltd.dev/list)** | Sort (natural or alphabetical), remove duplicates, randomize, reverse — without the phantom blank line every other list tool adds |
| **[JSON Formatter](https://devtools.fadeltd.dev/json)** | Format, minify, sort keys. Reports *every* problem with an exact line, column and caret, detects NDJSON, warns when numbers lose precision, and **expands JSON that was serialised into a string** — the thing structured logs do, including double-encoded |
| **[Text Statistics](https://devtools.fadeltd.dev/text-stats)** | Characters, letters, words, sentences, paragraphs, reading time, and word/phrase frequency |

Press `⌘K` anywhere to jump to a tool, `⌘1`–`⌘9` for pinned ones, and `?` for the
shortcut list. Your last input is restored when you come back.

## Development

Requires Node ≥ 22.12 and pnpm. **pnpm only** — never npm or yarn.

```bash
pnpm install
pnpm dev                    # Vite dev server
pnpm test                   # Vitest: unit + property tests
pnpm lint                   # oxlint
pnpm exec tsc --noEmit      # typecheck
pnpm exec wrangler dev      # serve dist/ exactly as Cloudflare will
pnpm deploy                 # build + deploy
```

### Adding a tool

One folder under `src/tools/` plus one entry in `src/lib/registry/index.ts`.
That registry drives the router, home grid, sidebar, command palette,
build-time prerender and sitemap — so nothing else needs editing.

Each tool is split into `core/` (pure functions: no React, no DOM, no store —
this is where all the tests live) and a thin `.tsx` shell.

`CHANGELOG.md` records what shipped when. `CLAUDE.md` has the rules that matter, including several that look like trivia
but are silent data-corruption bugs if ignored. `CONTRIBUTING.md` has the two
constraints that shape every decision here.

## Licence

MIT — see [LICENSE](LICENSE). The bundled fonts are third-party works under
the SIL Open Font License 1.1; see [NOTICE](NOTICE).

## Stack

Vite · React · TypeScript · Tailwind · Cloudflare Workers static assets.
No backend, no analytics, no third-party requests — fonts are self-hosted so the
page contacts nothing but its own origin.
