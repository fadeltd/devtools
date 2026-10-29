# @fadeltd/devtools-core

The engines behind [devtools.fadeltd.dev](https://devtools.fadeltd.dev): list pipelines, JSON errors and fixes, diff, base64, prefixed IDs, text statistics and HTML to text.

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

| Subpath | What it does |
|---|---|
| `/list` | Sort, natural sort, dedupe, shuffle, case, prefix/suffix, filter, number, wrap, join, split, trim, normalise, set operations, slice; chained with per-step line counts |
| `/json` | Every error with line and column, auto-fixes for almost-JSON, embedded JSON-in-a-string expansion, lossless big numbers, tree flattening, path formats (pointer, dot, jq) |
| `/diff` | Two-stage line → word diff, ignore whitespace/case/trim, exact stats, unified patch, share-link encoding |
| `/base64` | UTF-8-correct encode and decode, base64url, input sanitising, magic-byte type sniffing, hex dump, `data:` URI / `<img>` / CSS output |
| `/id-gen` | Prefixed IDs and passwords from `crypto.getRandomValues` with rejection sampling, plus entropy |
| `/text-stats` | Characters (four meanings), words, sentences (abbreviation-aware), paragraphs, reading time, word and phrase frequency |
| `/html-text` | Readable text from HTML that keeps paragraphs, lists and tables |
| `/text` | Line/column offsets and character counts shared by the tools |
| `/random` | Unbiased crypto random source and a seeded PRNG |

## Stability

Before 1.0, a minor version may change the API. Pin the minor version (`~0.1.0`) if you depend on exact signatures. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Licence

MIT.
