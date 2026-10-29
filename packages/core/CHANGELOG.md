# Changelog

All notable changes to `@fadeltd/devtools-core` are documented here. It is versioned separately from the devtools.fadeltd.dev site.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor version may change the API.

## [Unreleased]

### Added
- `/yaml-toml`: `convert(input, from, to, options)` between JSON, YAML and TOML with `from: 'auto'`, returning errors, warnings and notes with line, column and a caret snippet; never throws. Also `guessFormat` and `stringifyJson` (JSON with exact bigint digits).
- `/sql`: `formatSql` over twelve dialects via `sql-formatter`, with errors as line and column, and a dialect-aware `minifySql` that never touches strings, quoted identifiers or comments. `sql-formatter` is an optional peer dependency, loaded on first use.
- `/css`: `formatCss` for CSS, SCSS and Less via Prettier standalone, with errors as line and column, and a hand-written plain-CSS `minifyCss`. `prettier` is an optional peer dependency, loaded on first use.
- `/csv`: an RFC 4180 parser in linear time that never throws, with positioned issues (unclosed quotes, ragged rows, repeated headers), delimiter sniffing, column type hints, and JSON / Markdown / CSV / TSV writers.
- `/env`: .env ↔ JSON ↔ shell export ↔ docker env-file conversion with dotenv-accurate parsing, per-value safe quoting, positioned issues and JSON flattening.
- `/cron`: 5- and 6-field cron and `@` macros with field-and-position errors, Vixie day-of-month/day-of-week OR, `nextRuns` in any IANA zone with Vixie DST handling and never-fires detection, and `describeCron` (English, via `cronstrue`).
- `/escape`: JSON, JavaScript, SQL (standard/MySQL), POSIX shell, regex and HTML-entity escaping and strict unescaping, with positioned errors.
- `/color`: CSS color parsing (hex, rgb, hsl, oklch, named) with positioned errors; sRGB ↔ HSL ↔ OKLCH via OKLab; gamut detection and chroma clipping; WCAG contrast ratio, verdicts and the nearest passing foreground.
- `/qr`: QR payload builders for text, URLs and Wi-Fi, encoding to a module matrix (via `uqr`), and a single-path SVG.
- `/lorem`: lorem ipsum by exact word, sentence or paragraph count, as text, HTML or Markdown, seedable through any `RandomSource`.

## [0.4.0] — 2026-10-29

### Added
- `/jwt`: `verifyJwt(token, key, { secretEncoding })` verifies a compact JWS with WebCrypto and returns `{ status: 'valid' | 'invalid' | 'error', alg, format, keyId?, keyIndex?, reason? }`. The key can be a JWK, a JWKS (chosen by `kid`, or every compatible key tried when there is none), a PEM SPKI, a PKCS#1 key or an X.509 certificate, or an HS secret as text, base64 or base64url. It refuses `alg: none`, algorithm confusion, curve and key-type mismatches and JWK `alg`/`use`/`key_ops` conflicts, recognises DER ECDSA signatures, and never throws. Also `detectKeyFormat` and `parseKey`.
- `/slug`: `safeFilenameLines` also returns `collisions: { exact, caseOnly }`, groups of 1-based line numbers whose cleaned names are identical or equal ignoring case (after NFC), plus `findFilenameCollisions(names)`.

## [0.3.0] — 2026-10-29

### Added
- `/json`: `selectPath(root, path)` narrows a document to the node a path points at. The path can be a JSON pointer, a dot path or a jq path, and the result is `{ ok, value, path }` with array steps as numbers. When nothing matches, it returns a message saying where the walk stopped, written in the same path style that was typed. Also added `detectPathFlavor` and `formatPath`.
- `/json`: `parseDotPath` also reads a JSONPath-style `$.` or `$[` root.

## [0.2.0] — 2026-10-29

### Added
- `/timestamp`: parse Unix epochs in s/ms/µs/ns (unit auto-detected, exact to the nanosecond on BigInt) and strict ISO 8601 / RFC 3339, and format them as ISO in UTC or any IANA zone with its real offset, HTTP-date, relative time and ISO week.
- `/jwt`: decode JWS and JWE compact tokens without verifying them: strict base64url per segment with positioned errors, `exp`/`iat`/`nbf` as dates, expiry status with clock skew, and warnings for `alg: none`, missing expiry and lossy big-number claims.
- `/url`: component, full-URI and form percent-encoding that matches the native functions, a decoder that reports the position of the first malformed escape (or skips them in lenient mode), double-encoding detection, and query-string parsing and rebuilding that keeps duplicates and value-less flags.
- `/hash`: SHA-1/256/384/512 digests and HMAC via WebCrypto with text, hex or base64 keys, constant-time signature comparison, and GitHub, Stripe and Slack webhook signing and verification with timestamp tolerance.
- `/slug`: `slugify` with accent folding, transliteration, camelCase splitting and a word-safe max length; `safeFilename` that is safe on Windows, macOS and Linux at once (reserved names, forbidden characters, a 255-byte cap that keeps the extension) and reports what it changed.
- `/text-bytes`: UTF-8 text to binary, hex, decimal or octal and back, with a tolerant parser that reports the exact bad token, format auto-detection, and the offset of the first invalid UTF-8 sequence.
- `/number`: BigInt base conversion 2–36 with two's complement, SI and IEC byte sizes, and Unix permission parsing (octal, symbolic, `ls -l`) with chmod commands.
- `/unicode`: per-code-point inspection with line and column, UTF-8/UTF-16 and general category; flags for invisible, bidi, control, exotic-space, variation, tag, private-use and lone-surrogate characters; and a `clean()` that keeps emoji intact.
- `/id-gen`: UUID v4, monotonic UUID v7 and ULID generation from an injectable random source and clock, and `inspectId` to read a UUID's version and variant or a v7/ULID's timestamp.

## [0.1.0] — 2026-10-29

### Added
- First release: the engines behind devtools.fadeltd.dev, published as one ESM package with a subpath per tool: `/list`, `/json`, `/diff`, `/base64`, `/id-gen`, `/text-stats`, `/html-text`, plus the shared `/text` and `/random` helpers. Pure functions with type declarations, no DOM, Node 22.12+ or a current browser.
