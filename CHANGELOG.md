# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Releases tagged correctly but never deployed. The Release workflow only
  started Deploy when no `RELEASE_TOKEN` was configured, assuming a PAT-pushed
  tag would trigger it natively. With a PAT present that assumption took over
  silently: the tag was pushed, Release reported success, and Deploy had zero
  runs. Release now always starts Deploy explicitly.

## [0.2.1] — 2026-09-24

### Fixed
- The Release workflow checked out the commit that triggered it rather than the
  branch tip, so any re-run built on a stale base and its push was rejected as
  a non-fast-forward. It now checks out `main`, and each push is guarded so a
  partially-completed attempt resumes instead of blocking every retry.
- `.env` is now ignored. Nothing here needs one — the app has no backend and no
  runtime secrets — but an untracked `.env` is exactly what gets committed by
  accident on a public repository.

## [0.2.0] — 2026-09-24

### Added
- **ID Generator** — prefixed identifiers in the Stripe style
  (`sk_live_` plus 24 random characters): set a prefix, separator, length,
  alphabet and batch size. Doubles as a password generator via a symbol
  alphabet and an
  option to drop confusable glyphs (`0`/`O`, `1`/`l`/`I`).
  - Live entropy readout with a qualitative strength verdict. Deliberately no
    "time to crack" figure: that depends entirely on assumed hardware and on
    whether the value is hashed, so quoting one would be false precision.
  - Presets for Stripe secret and test keys, object ids, API tokens, hex
    session ids, passwords and human-readable codes.
  - Values come from `crypto.getRandomValues` with rejection sampling, never
    `value % n`, which biases toward the start of the alphabet.
  - Settings persist; **generated values never do**.
- Collapsible sidebar, kept as an icon rail with accessible names intact.
- Link to the GitHub repository in the header.
- Continuous integration on every pull request, including an entry-bundle size
  budget so a heavy dependency escaping a lazy chunk fails the build rather
  than reaching production.
- Release automation: merging to `main` creates a version tag, and the **tag**
  is what deploys. A merge that does not change the version in `package.json`
  releases nothing, so merging and releasing are separate decisions.

### Fixed
- Focus rings on full-bleed text areas were drawn outside the element and
  clipped by the surrounding pane, so only the top and right edges were
  visible. They are now drawn inset.

### Changed
- Unbiased randomness primitives moved to `src/lib/random.ts`, now shared by
  the list shuffler and the ID generator.

## [0.1.0] — 2026-09-24

First public release. Five tools, live at <https://devtools.fadeltd.dev>.

### Added

#### Diff Checker
- Side-by-side and unified views, sharing one editor state so toggling keeps
  cursor and scroll position.
- Word-level highlighting inside changed lines, collapsed unchanged regions, and
  exact `+n −m ~k` statistics computed from the diff rather than scraped from
  the rendered view.
- `Alt+↑` / `Alt+↓` to jump between changes; file picker per side.
- Size guardrails: degrades to line-only highlighting over 2 MB and refuses
  input that cannot be displayed usefully, rather than hanging.

#### Base64
- Encode and decode with correct UTF-8 handling via `TextEncoder`, using the
  native `Uint8Array` base64 API where available and a chunked fallback
  elsewhere.
- base64url alphabet, optional padding, and PEM/MIME line wrapping.
- Input sanitiser that strips `data:` URI headers, percent-encoding, BOMs and
  line wrapping — and reports every change it made, so a failed decode is never
  ambiguous about whether the tool mangled the input.
- Invalid characters are located by line and column, since the native API throws
  without a position.

#### List Tools
- Sort (natural, alphabetical, codepoint, length), remove duplicates with four
  output modes, randomize, reverse.
- Correct handling of trailing newlines, CRLF and lone CR, and byte-order marks.
  `a\nb\n` is two lines, not three.
- Explicit blank-line policy rather than silently dropping them.
- Warns when lines differ only by Unicode normalisation form.

#### JSON Formatter
- Format, minify, sort keys, escape and unescape JSON strings.
- Reports every distinct problem — not just the first — each with line, column
  and a tab-aware caret. Trailing commas are reported at the comma rather than
  at the closing brace that failed to parse.
- Detects NDJSON and offers to wrap it as an array.
- Warns separately about numbers that lose precision and numbers whose value
  survives but whose printed form changes.
- **Expands JSON that was serialised into a string**, recursively, for the
  double-encoded payloads that structured logs produce. Expansion is a view over
  the source, so it is reversible exactly.

#### Text Statistics
- Characters in all four meanings that differ in practice: grapheme clusters,
  code points, UTF-16 units and UTF-8 bytes.
- Letter, digit, punctuation, symbol and whitespace breakdown.
- Words, unique words, average and longest word, via `Intl.Segmenter` rather
  than whitespace splitting.
- Sentence counting that does not split on abbreviations or initials.
- Paragraphs, lines, longest line, reading and speaking time.
- Word and phrase frequency with density, and an opt-in stop-word filter.

#### Application
- Command palette (`⌘K`) that searches titles, aliases and competitor names,
  and prefetches a tool's code as you arrow through results.
- Pin up to nine tools to `⌘1`–`⌘9`; `?` shows a cheatsheet generated from
  the live shortcut registry.
- Per-tool state persistence that restores your last input, splitting small
  state (localStorage) from large payloads (IndexedDB). Tools handling
  credentials never persist and show a visible "Not saved" badge.
- Responsive layout that stacks panes on mobile rather than shrinking them.
- Build-time prerendering per tool route plus a generated sitemap, so each tool
  has real HTML for cold loads and link previews.

### Security
- Content Security Policy with no `unsafe-eval`, which also acts as a
  dependency filter.
- No backend, no analytics, and no third-party requests. Fonts are self-hosted
  so the page contacts nothing but its own origin.
