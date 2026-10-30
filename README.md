# devtools.fadeltd.dev

**Free, open-source developer tools that run entirely in your browser.** A JSON formatter, JSON to TypeScript / Zod / Go generator, diff checker, YAML/TOML converter, SQL and CSS formatter, CSV viewer, base64 encoder/decoder, JWT decoder, timestamp and cron tools, URL encoder, string escaper, hash and HMAC calculator, UUID, ID and password generator, color and contrast checker, QR code generator, Unicode inspector, word counter, HTML-to-text extractor and list sorter — with no backend, no accounts, no ads and no tracking.

[![Live](https://img.shields.io/badge/live-devtools.fadeltd.dev-38bdf8)](https://devtools.fadeltd.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![No backend](https://img.shields.io/badge/backend-none-22c55e)](#why-another-one)
[![XERJ Corpus Hub](https://hub.xerj.org/contributors/fadeltd/badge.svg)](https://hub.xerj.org/contributors/fadeltd)

### → [**devtools.fadeltd.dev**](https://devtools.fadeltd.dev)

## Why another one?

Every other online JSON formatter, base64 decoder and diff checker sends what you paste to a server. This one has no backend: it is static files on a CDN, makes zero network requests, and works offline after the first visit. Paste a production token, an API response or a customer record without thinking about it.

It also does what the free sites usually don't: reports **every** JSON error with line, column and caret; **expands JSON serialised inside strings** (structured logs, double-encoded too); and never adds the **phantom blank line** to your lists.

## Tools

`⌘K` jumps to any tool, `⌘1`–`⌘9` to pinned ones, `?` lists shortcuts. Your last input is restored when you return.

### Data and formats

- **[JSON Formatter & Validator](https://devtools.fadeltd.dev/json)** — format, minify, sort keys; every error with line and caret; one-click fixes; embedded JSON expanded; tree view with JSON Pointer / jq paths; lossless big numbers; stays responsive on 20 MB
- **[JSON to TypeScript, Zod and Go](https://devtools.fadeltd.dev/json-types)** — types inferred from sample JSON or NDJSON, optional vs nullable kept apart, int vs float, golint names
- **[YAML ↔ JSON ↔ TOML Converter](https://devtools.fadeltd.dev/yaml-toml)** — auto-detected input, positioned errors, YAML 1.1 gotchas, comments kept YAML → YAML, exact big integers
- **[CSV to Table](https://devtools.fadeltd.dev/csv)** — RFC 4180 parsing, delimiter detection, virtualised table, convert to JSON, Markdown or TSV
- **[SQL Formatter](https://devtools.fadeltd.dev/sql)** — twelve dialects, comments kept, parse errors with line and column, safe minify
- **[CSS Formatter & Minifier](https://devtools.fadeltd.dev/css)** — Prettier for CSS, SCSS and Less; a minifier that keeps `calc()` and licence comments
- **[.env Converter](https://devtools.fadeltd.dev/env)** — .env ↔ JSON ↔ shell `export` ↔ docker env-file, dotenv-accurate, never saved
- **[Cron Expression Explainer](https://devtools.fadeltd.dev/cron)** — plain English plus the next 10 runs in any time zone, DST-correct
- **[Unix Timestamp Converter](https://devtools.fadeltd.dev/timestamp)** — epoch s/ms/µs/ns ↔ ISO 8601 in any time zone, relative time, ISO week
- **[Number Base Converter](https://devtools.fadeltd.dev/number)** — bases 2–36, two's complement, KB vs KiB, chmod octal ↔ symbolic

### Text and lists

- **[Diff Checker](https://devtools.fadeltd.dev/diff)** — side-by-side or unified, word-level highlights, ignore whitespace or case, compare as sorted lines or key-sorted JSON, unified patch, share by link
- **[List Tools](https://devtools.fadeltd.dev/list)** — sort, natural sort, dedupe, shuffle, filter and 11 more steps chained into a shareable pipeline
- **[Word Counter & Text Statistics](https://devtools.fadeltd.dev/text-stats)** — characters four ways, words, sentences, reading time, word frequency
- **[Unicode Inspector](https://devtools.fadeltd.dev/unicode)** — finds zero-width, bidi (Trojan Source) and other invisible characters, one-click clean
- **[Slug Generator](https://devtools.fadeltd.dev/slug)** — URL slugs and cross-platform safe filenames, case collisions flagged
- **[HTML to Text](https://devtools.fadeltd.dev/html-text)** — readable text that keeps paragraphs, lists and tables

### Encoding and security

- **[Base64 Encode / Decode](https://devtools.fadeltd.dev/base64)** — correct UTF-8, base64url, files and images to `data:` URIs, hex view with SHA-256, SVG sanitising report
- **[URL Encode / Decode](https://devtools.fadeltd.dev/url)** — component, full-URL and form encoding, query parameter table
- **[String Escaper](https://devtools.fadeltd.dev/escape)** — JSON, JavaScript, SQL, shell, regex and HTML entities, both ways
- **[Text to Binary / Hex](https://devtools.fadeltd.dev/text-bytes)** — UTF-8 ↔ binary, hex, decimal or octal, invalid bytes located
- **[JWT Decoder & Verifier](https://devtools.fadeltd.dev/jwt)** — claims as dates, expiry, signature check against a JWK, JWKS, PEM or secret; never saved
- **[Hash Generator](https://devtools.fadeltd.dev/hash)** — SHA-1, SHA-256, SHA-384, SHA-512, compare against an expected hash
- **[HMAC Webhook Signature](https://devtools.fadeltd.dev/hmac)** — GitHub, Stripe and Slack signatures, verify with timestamp tolerance

### Generators and color

- **[UUID, ULID & Password Generator](https://devtools.fadeltd.dev/id-gen)** — UUID v4/v7, ULID, Stripe-style prefixed ids, passwords with an entropy readout
- **[QR Code Generator](https://devtools.fadeltd.dev/qr)** — text, URLs and Wi-Fi, SVG or PNG download
- **[Lorem Ipsum Generator](https://devtools.fadeltd.dev/lorem)** — exact words, sentences or paragraphs as text, HTML or Markdown
- **[Color Converter](https://devtools.fadeltd.dev/color)** — hex ↔ RGB ↔ HSL ↔ OKLCH with gamut warnings
- **[WCAG Contrast Checker](https://devtools.fadeltd.dev/contrast)** — AA/AAA verdicts and the nearest passing color

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

Each tool is an engine in `packages/core/src/<slug>/` (pure functions, where all the tests live), a thin `.tsx` shell in `src/tools/<slug>/`, one entry in `src/lib/registry/index.ts` and a paragraph in `src/lib/registry/about.ts`. The registry drives the router, home grid, sidebar, command palette, prerender and sitemap, so nothing else needs editing.

### Use the engines

The engines are published separately as [`@fadeltd/devtools-core`](packages/core/README.md), so you can use the same list pipelines, JSON error reporting, diff, base64 and text statistics in your own app or CLI. The site imports that package's compiled output like any other consumer.

`CHANGELOG.md` records what shipped when. `CLAUDE.md` has the rules that matter, including several that look like trivia but are silent data-corruption bugs if ignored. `CONTRIBUTING.md` has the two constraints that shape every decision here.

## Licence

MIT — see [LICENSE](LICENSE). The bundled fonts are third-party works under the SIL Open Font License 1.1; see [NOTICE](NOTICE).

## Stack

Vite · React · TypeScript · Tailwind · Cloudflare Workers static assets. No backend, no analytics, no third-party requests — fonts are self-hosted so the page contacts nothing but its own origin.
