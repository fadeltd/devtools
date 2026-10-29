# Changelog

All notable changes to `@fadeltd/devtools-core` are documented here. It is versioned separately from the devtools.fadeltd.dev site.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor version may change the API.

## [Unreleased]

Nothing yet.

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
