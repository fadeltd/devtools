# @fadeltd/devtools-core

The engines behind [devtools.fadeltd.dev](https://devtools.fadeltd.dev): list pipelines, JSON errors and fixes, diff, base64, prefixed IDs and UUIDs, timestamps, JWT decoding, URL encoding, hashes and HMAC, slugs, text bytes, number bases, Unicode inspection, text statistics and HTML to text.

Every export is a pure function: strings and bytes in, data out. No DOM, no network, no storage. It runs the same in Node, in a browser and in a worker, which is how the site itself uses it. Each tool also handles the edge cases that free online tools get wrong:

- `"a\nb\n"` is two lines, not three.
- CRLF and BOMs survive a round trip.
- Natural sort compares digit runs exactly, past 2^53.
- Base64 goes through UTF-8, never `btoa` on a string.
- JSON reports every error, with a caret that lines up even in tab-indented files.

## Install

```bash
pnpm add @fadeltd/devtools-core
```

ESM only. Requires Node 22.12+ or a current browser.

## Use

Import from the subpath for the tool you need. Each subpath is independent, so you only pay for what you import.

```js
import { defaultOp, parseLines, runPipeline, serializeLines } from '@fadeltd/devtools-core/list'

const { doc, steps } = runPipeline(parseLines('key10\nkey2\nKEY2\nkey1\n'), [
  defaultOp('dedupe'),
  defaultOp('sort'),
  { kind: 'affix', prefix: 'sk_live_', suffix: '', skipBlank: true },
])
serializeLines(doc) // 'sk_live_key1\nsk_live_key2\nsk_live_key10\n'
steps.map((s) => `${s.inLines} → ${s.outLines}`) // ['4 → 3', '3 → 3', '3 → 3']
```

```js
import { analyze, runFixes } from '@fadeltd/devtools-core/json'

analyze('{"a": 1,}', { lenient: false }).issues[0] // { line: 1, column: 8, message: …, … }
runFixes("{'a': 1, // note\n}").text // '{"a": 1 \n}' — quotes, comment and trailing comma fixed
```

```js
import { decodeText, encodeText } from '@fadeltd/devtools-core/base64'

encodeText('café 🎉', { alphabet: 'base64url', padding: false }) // 'Y2Fmw6kg8J-OiQ'
decodeText('Y2Fmw6kg8J-OiQ', { alphabet: 'auto', lenient: true }) // { ok: true, text: 'café 🎉', … }
```

```js
import { convertTimestamp } from '@fadeltd/devtools-core/timestamp'

const r = convertTimestamp('1700000000', { timeZone: 'Asia/Kolkata', now: Date.now() })
if (r.ok) r.formatted.isoZoned // '2023-11-15T03:43:20.000+05:30'
```

```js
import { decodeJwt } from '@fadeltd/devtools-core/jwt'

const jwt = decodeJwt(token, { now: Date.now(), clockSkewSeconds: 60 })
jwt.status // 'valid' | 'expired' | 'not-yet-valid' | 'no-expiry' | 'unknown' | null — the signature is never verified
```

```js
import { uuidV7, inspectId } from '@fadeltd/devtools-core/id-gen'

uuidV7() // time-ordered, monotonic within the same millisecond
inspectId('017f22e2-79b0-7cc3-98c4-dc0c0c07398f') // { label: 'UUID v7', time: { iso: '2022-02-22T19:22:22.000Z', … }, … }
```

```js
import { digest, formatDigest, verifyWebhook } from '@fadeltd/devtools-core/hash'

formatDigest(await digest('SHA-256', 'abc'), 'hex') // 'ba7816bf…f20015ad'
await verifyWebhook({ preset: 'stripe', algorithm: 'SHA-256', key: 'whsec_…', keyEncoding: 'text', body, timestamp: '', signature: stripeSignatureHeader, now: Date.now() })
// { status: 'match', timestamp: '1700000000' }
```

```js
import { clean, summary } from '@fadeltd/devtools-core/unicode'

summary('{"key\u200b": 1}').positions[0] // { line: 1, column: 6, hex: 'U+200B', name: 'ZERO WIDTH SPACE', … }
clean('a\u00a0b\u200bc').text // 'a bc'
```

| Subpath | What it does |
|---|---|
| `/list` | Sort, natural sort, dedupe, shuffle, case, prefix/suffix, filter, number, wrap, join, split, trim, normalise, set operations, slice; chained with per-step line counts |
| `/json` | Every error with line and column, auto-fixes for almost-JSON, embedded JSON-in-a-string expansion, lossless big numbers, tree flattening, path formats (pointer, dot, jq) |
| `/diff` | Two-stage line → word diff, ignore whitespace/case/trim, exact stats, unified patch, share-link encoding |
| `/base64` | UTF-8-correct encode and decode, base64url, input sanitising, magic-byte type sniffing, hex dump, `data:` URI / `<img>` / CSS output |
| `/id-gen` | Prefixed IDs and passwords from `crypto.getRandomValues` with rejection sampling, UUID v4/v7 and ULID (monotonic), an ID inspector, plus entropy |
| `/text-stats` | Characters (four meanings), words, sentences (abbreviation-aware), paragraphs, reading time, word and phrase frequency |
| `/html-text` | Readable text from HTML that keeps paragraphs, lists and tables |
| `/timestamp` | Epoch s/ms/µs/ns ↔ ISO 8601 / RFC 3339 on BigInt nanoseconds, IANA zone offsets via `Intl`, HTTP-date, relative time, ISO week |
| `/jwt` | JWS/JWE decoding (never verification), claim dates and expiry status, `alg: none` and malformed-segment warnings |
| `/url` | Component, full-URI and form percent-encoding; decoding with malformed-escape positions; query-string parse and rebuild |
| `/hash` | SHA digests, HMAC with text/hex/base64 keys, constant-time compare, GitHub/Stripe/Slack webhook signing and verification with timestamp tolerance |
| `/slug` | URL slugs with transliteration and camelCase splitting; cross-platform safe filenames |
| `/text-bytes` | UTF-8 text ↔ binary, hex, decimal or octal, with format auto-detection and invalid-UTF-8 offsets |
| `/number` | BigInt base conversion 2–36 with two's complement, SI/IEC byte sizes, Unix permissions and chmod commands |
| `/unicode` | Per-code-point inspection, invisible/bidi/tag/space flags with names, and an emoji-safe `clean()` |
| `/text` | Line/column offsets and character counts shared by the tools |
| `/random` | Unbiased crypto random source and a seeded PRNG |

## Stability

Before 1.0, a minor version may change the API. Pin the minor version (`~0.1.0`) if you depend on exact signatures. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

MIT.
