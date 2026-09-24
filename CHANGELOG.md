# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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
