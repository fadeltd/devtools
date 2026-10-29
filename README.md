# devtools.fadeltd.dev

**Free, open-source developer tools that run entirely in your browser.** A JSON formatter, diff checker, base64 encoder/decoder, JWT decoder, timestamp converter, URL encoder, hash and HMAC calculator, UUID, ID and password generator, Unicode inspector, word counter, HTML-to-text extractor and list sorter — with no backend, no accounts, no ads and no tracking.

[![Live](https://img.shields.io/badge/live-devtools.fadeltd.dev-38bdf8)](https://devtools.fadeltd.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![No backend](https://img.shields.io/badge/backend-none-22c55e)](#why-another-one-of-these)
[![XERJ Corpus Hub](https://hub.xerj.org/contributors/fadeltd/badge.svg)](https://hub.xerj.org/contributors/fadeltd)

### → [**devtools.fadeltd.dev**](https://devtools.fadeltd.dev)

## Why another one of these?

Because every other online JSON formatter, base64 decoder and diff checker sends what you paste to a server.

This one cannot. There is no backend — it is static files on a CDN, so there is no server to send anything to. You can open the network tab and watch it make zero requests, or turn off your wifi and keep using it. Paste a production token, an API response or a customer record without thinking about it.

Three other things it does that the free sites generally do not:

- **Expands JSON that was serialised into a string** — the thing every structured logger does, including double-encoded. No more copying a `payload` field into a second tab.
- **Reports every JSON error, not just the first**, each with a line, column and a caret that lines up even in tab-indented files.
- **Does not corrupt your lists.** `a\nb\n` is two lines, not three — the phantom trailing blank line that most online list tools add.

## Tools

| | |
|---|---|
| **[Diff Checker](https://devtools.fadeltd.dev/diff)** | Side-by-side or unified, word-level highlighting, ignore whitespace / case / trim, copy as a unified patch, share by link (the content lives in the URL fragment, never on a server), `Alt+↑/↓` to jump between changes |
| **[Base64](https://devtools.fadeltd.dev/base64)** | Encode/decode with correct UTF-8, base64url, padding control. Unwraps PEM/MIME line breaks and `data:` URIs, and tells you what it changed |
| **[List Tools](https://devtools.fadeltd.dev/list)** | Sort (natural or alphabetical), remove duplicates, randomize, reverse — without the phantom blank line every other list tool adds |
| **[JSON Formatter](https://devtools.fadeltd.dev/json)** | Format, minify, sort keys. Reports *every* problem with an exact line, column and caret, detects NDJSON, keeps big numbers byte-exact, and **expands JSON that was serialised into a string** — the thing structured logs do, including double-encoded. Tree view with copy-path (pointer / dot / jq), and one-click fixes for trailing commas, comments and single quotes, previewed as a diff |
| **[ID Generator](https://devtools.fadeltd.dev/id-gen)** | Prefixed Stripe-style ids, UUID v4, time-ordered UUID v7 and ULID, custom alphabet and length, bulk generation, entropy readout, and an inspector that reads a UUID's version or a v7/ULID's creation time. Doubles as a password generator; nothing generated is ever saved |
| **[Text Statistics](https://devtools.fadeltd.dev/text-stats)** | Characters, letters, words, sentences, paragraphs, reading time, and word/phrase frequency |
| **[HTML to Text](https://devtools.fadeltd.dev/html-text)** | Readable plain text from HTML, keeping paragraphs, lists and tables; scripts, hidden elements and icon ligatures dropped |
| **[Timestamp Converter](https://devtools.fadeltd.dev/timestamp)** | Epoch s/ms/µs/ns with auto-detected unit, exact to the nanosecond; ISO 8601 in UTC and any time zone with its real offset; HTTP-date, relative time, weekday and ISO week |
| **[JWT Decoder](https://devtools.fadeltd.dev/jwt)** | Header and payload as JSON, exp/iat/nbf as local and UTC dates, expiry status with clock-skew leeway, JWE header, `alg: none` and malformed-segment warnings, never saved |
| **[URL Encode / Decode](https://devtools.fadeltd.dev/url)** | Component, full-URL and form encoding; decode with malformed-escape positions; double-encoding detection; URL parts and query parameter table |
| **[Hash Text](https://devtools.fadeltd.dev/hash)** | SHA-1, SHA-256, SHA-384 and SHA-512 at once in hex, HEX or base64; compare against an expected hash; trailing-newline and CRLF warnings |
| **[HMAC Signature](https://devtools.fadeltd.dev/hmac)** | GitHub, Stripe and Slack webhook signatures; verify a pasted header, with timestamp tolerance; text, hex or base64 keys; never saved |
| **[Slug Generator](https://devtools.fadeltd.dev/slug)** | URL slugs with accent folding, camelCase splitting and a word-safe max length; cross-platform safe filenames (reserved names, forbidden characters, 255-byte cap); one per line |
| **[Text to Binary / Hex](https://devtools.fadeltd.dev/text-bytes)** | UTF-8 text ↔ binary, hex, decimal or octal; `0x` / `\x` prefixes and C-string output; tolerant paste parsing with exact error positions; format auto-detect; invalid UTF-8 located, with a labelled fallback |
| **[Number Converter](https://devtools.fadeltd.dev/number)** | Bases 2–36 with no precision loss, two's complement, byte sizes in SI vs IEC, chmod octal ↔ symbolic with checkboxes |
| **[Unicode Inspector](https://devtools.fadeltd.dev/unicode)** | Every code point with line:column, UTF-8/UTF-16 and category; flags zero-width, bidi (Trojan Source), exotic spaces, tags, lone surrogates; flagged-only view; one-click clean with optional NFC/NFKC |

Press `⌘K` anywhere to jump to a tool, `⌘1`–`⌘9` for pinned ones, and `?` for the shortcut list. Your last input is restored when you come back.

## Development

Requires Node ≥ 22.12 and pnpm. **pnpm only** — never npm or yarn.

```bash
pnpm install
pnpm dev                    # builds the engines, then Vite dev server
pnpm test                   # Vitest: unit + property tests
pnpm lint                   # oxlint
pnpm typecheck              # builds the engines, then typechecks
pnpm exec wrangler dev      # serve dist/ exactly as Cloudflare will
pnpm deploy                 # build + deploy
```

### Adding a tool

Each tool is an engine in `packages/core/src/<slug>/` (pure functions: no React, no DOM, no store — this is where all the tests live), a thin `.tsx` shell in `src/tools/<slug>/`, and one entry in `src/lib/registry/index.ts`. That registry drives the router, home grid, sidebar, command palette, build-time prerender and sitemap — so nothing else needs editing.

### Use the engines

The engines are published separately as [`@fadeltd/devtools-core`](packages/core/README.md), so you can use the same list pipelines, JSON error reporting, diff, base64 and text statistics in your own app or CLI. The site imports that package's compiled output like any other consumer.

`CHANGELOG.md` records what shipped when. `CLAUDE.md` has the rules that matter, including several that look like trivia but are silent data-corruption bugs if ignored. `CONTRIBUTING.md` has the two constraints that shape every decision here.

## Licence

MIT — see [LICENSE](LICENSE). The bundled fonts are third-party works under the SIL Open Font License 1.1; see [NOTICE](NOTICE).

## Stack

Vite · React · TypeScript · Tailwind · Cloudflare Workers static assets. No backend, no analytics, no third-party requests — fonts are self-hosted so the page contacts nothing but its own origin.
