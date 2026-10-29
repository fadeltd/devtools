# devtools.fadeltd.dev

**Free, open-source developer tools that run entirely in your browser.** A JSON formatter, diff checker, YAML/TOML converter, SQL and CSS formatter, CSV viewer, base64 encoder/decoder, JWT decoder, timestamp and cron tools, URL encoder, string escaper, hash and HMAC calculator, UUID, ID and password generator, color and contrast checker, QR code generator, Unicode inspector, word counter, HTML-to-text extractor and list sorter — with no backend, no accounts, no ads and no tracking.

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
| **[JWT Decoder](https://devtools.fadeltd.dev/jwt)** | Header and payload as JSON, exp/iat/nbf as local and UTC dates, expiry status with clock-skew leeway, signature check against a pasted PEM, JWK, JWKS or HS secret (HS/RS/PS/ES/EdDSA, refusing `alg: none` and algorithm confusion), JWE header, malformed-segment warnings, never saved |
| **[URL Encode / Decode](https://devtools.fadeltd.dev/url)** | Component, full-URL and form encoding; decode with malformed-escape positions; double-encoding detection; URL parts and query parameter table |
| **[Hash Text](https://devtools.fadeltd.dev/hash)** | SHA-1, SHA-256, SHA-384 and SHA-512 at once in hex, HEX or base64; compare against an expected hash; trailing-newline and CRLF warnings |
| **[HMAC Signature](https://devtools.fadeltd.dev/hmac)** | GitHub, Stripe and Slack webhook signatures; verify a pasted header, with timestamp tolerance; text, hex or base64 keys; never saved |
| **[Slug Generator](https://devtools.fadeltd.dev/slug)** | URL slugs with accent folding, camelCase splitting and a word-safe max length; cross-platform safe filenames (reserved names, forbidden characters, 255-byte cap, case collisions flagged); one per line |
| **[Text to Binary / Hex](https://devtools.fadeltd.dev/text-bytes)** | UTF-8 text ↔ binary, hex, decimal or octal; `0x` / `\x` prefixes and C-string output; tolerant paste parsing with exact error positions; format auto-detect; invalid UTF-8 located, with a labelled fallback |
| **[Number Converter](https://devtools.fadeltd.dev/number)** | Bases 2–36 with no precision loss, two's complement, byte sizes in SI vs IEC, chmod octal ↔ symbolic with checkboxes |
| **[Unicode Inspector](https://devtools.fadeltd.dev/unicode)** | Every code point with line:column, UTF-8/UTF-16 and category; flags zero-width, bidi (Trojan Source), exotic spaces, tags, lone surrogates; flagged-only view; one-click clean with optional NFC/NFKC |
| **[YAML / JSON / TOML](https://devtools.fadeltd.dev/yaml-toml)** | Convert between YAML, JSON and TOML in any direction with auto-detection; positioned errors with a caret; YAML 1.1 trap notes (`no`, `on`, `0755`); comments kept YAML → YAML; anchors, merge keys and multi-document YAML; exact big integers |
| **[SQL Formatter](https://devtools.fadeltd.dev/sql)** | Twelve dialects, keyword case, indent and statement spacing; comments kept; parse errors with line and column; minify that leaves strings, quoted identifiers and comments untouched |
| **[CSS Formatter](https://devtools.fadeltd.dev/css)** | Prettier for CSS, SCSS and Less with width, indent and quote options; syntax errors with line and column; a careful CSS minifier that keeps `calc()` spacing, licence comments and data URIs intact |
| **[CSV to Table](https://devtools.fadeltd.dev/csv)** | RFC 4180 parsing with quoted newlines, delimiter detection (comma, tab, semicolon, pipe; European decimal commas handled), virtualised table with sticky header and column type hints, ragged-row and unclosed-quote warnings by line, convert to JSON, Markdown, CSV or TSV |
| **[.env Converter](https://devtools.fadeltd.dev/env)** | .env ↔ JSON ↔ shell `export` ↔ docker `--env-file`; dotenv-accurate parsing (quotes, escapes, multiline, inline comments, CRLF); per-value safe quoting; problems reported by line; flatten nested JSON with `__`; mask values for screen sharing; never saved |
| **[Cron Explainer](https://devtools.fadeltd.dev/cron)** | Cron in plain English with a per-field breakdown; next 10 runs in any time zone with DST handled the way Vixie cron does; 6-field seconds, macros, day-of-month/day-of-week OR, Quartz syntax called out by name |
| **[String Escaper](https://devtools.fadeltd.dev/escape)** | Escape and unescape for JSON, JavaScript (`"` `'` or template), SQL (standard `''` or MySQL backslashes), POSIX shell (`'\''` quoting), regex and HTML entities; positioned unescape errors with the fix |
| **[Color Converter](https://devtools.fadeltd.dev/color)** | Hex, RGB, HSL and OKLCH from any CSS color or a picker; all 148 named colors; out-of-sRGB-gamut warning with a chroma-reduced fallback; alpha; positioned errors |
| **[Contrast Checker](https://devtools.fadeltd.dev/contrast)** | WCAG 2 ratio with AA/AAA for normal and large text and 3:1 for UI; live preview; alpha blended over the background; nearest passing text color by OKLCH lightness, with Apply |
| **[QR Code](https://devtools.fadeltd.dev/qr)** | QR codes for text, URLs and Wi-Fi with a chosen error correction level, downloadable as a single-path SVG or a crisp PNG; scan-risk warnings; the Wi-Fi password is never saved |
| **[Lorem Ipsum](https://devtools.fadeltd.dev/lorem)** | Exact counts of words, sentences or paragraphs, optional classic opening, plain text / HTML `<p>` / Markdown output, one-key Regenerate |

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
