# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Number Converter: screen readers now announce each permission checkbox by name ("Owner read", "Group write") instead of a bare "r" or "w".

## [0.10.0] — 2026-10-29

### Added
- JSON Formatter: narrow the output to one part of the document. Select a node in Tree view and press Filter, or type a path into the new Filter field as `.items[0].id`, `items[0].id`, `$.items[0].id` or `/items/0/id`. Both the text output and the tree show just that node, and Copy copies just that node. Copied paths still point into the whole document. A path that doesn't match says where it stopped (`.items has 3 items; there is no [5]`), and the ↑ button moves up one level.

## [0.9.0] — 2026-10-29

### Added
- Pin your favourite tools to the top. Use the pin next to any tool's name, or Pin in the ⌘K palette, and the tool appears in a Pinned section at the top of the sidebar and the home page, in order, with its ⌘1–⌘9 shortcut shown beside it. Up to nine tools can be pinned.

### Fixed
- On phones, the GitHub and Settings icons at the top right no longer have a wide empty gap between them.

## [0.8.0] — 2026-10-29

### Added
- Timestamp Converter: paste a Unix timestamp in seconds, milliseconds, microseconds or nanoseconds (the unit is detected for you), or an ISO 8601 date, and see it as ISO 8601 in UTC and in any time zone with its real offset, as an HTTP date, a readable local date, a relative time like "3 hours ago", the weekday and the ISO week, each with its own Copy button.
- JWT Decoder: paste a JSON Web Token, with or without `Bearer`, to see its header and payload, its `exp`, `iat` and `nbf` as real dates in your time zone and UTC, and whether it has expired, with warnings for `alg: none`, missing expiry and malformed segments. Encrypted tokens show their header. Nothing you paste is ever saved.
- URL Encode / Decode: percent-encode or decode text as a URL component, a whole URL, or form data (`+` for spaces). A malformed escape like `%E2%82` is pointed out by position instead of failing silently, you're warned when something looks double-encoded (`%2520`), and pasting a URL or query string shows its parts and a table of parameters, duplicates and value-less flags included, each one copyable.
- Hash Text: see the SHA-1, SHA-256, SHA-384 and SHA-512 of any text at once, in hex, uppercase hex or base64. Paste an expected hash to see which one matches. You're warned when your text ends with a newline or has Windows line endings, the usual reasons a hash "doesn't match", and can ignore one trailing newline with a tick.
- HMAC Signature: compute and check webhook signatures for GitHub, Stripe and Slack, or plain HMAC-SHA-1/256/384/512. Paste the signature header you received to see whether it matches, or whether its timestamp is too old; you see the exact string that was signed and the header as the provider sends it. Your secret key is never saved.
- Slug Generator: turn titles into URL slugs (accents folded, ß/æ/ø/ł spelled out, camelCase split, optional Unicode for CJK, word-safe length limit) or into filenames that are safe on Windows, macOS and Linux at once, with reserved names, trailing dots and the 255-byte limit handled and a note of what changed.
- Text to Binary / Hex: turn text into its UTF-8 bytes as binary, hex, decimal or octal, and back. Pasted bytes are read in almost any layout (`0x` and `\x` prefixes, commas, no spaces), a bad token is pointed out exactly, the format is guessed and you're told when the guess is ambiguous, and bytes that aren't valid UTF-8 are located.
- Number Converter: convert integers of any size between bases 2–36 (with two's complement for negatives), turn byte sizes like 1.5 GB or 512 KiB into exact bytes in both SI and IEC units, and translate Unix permissions between 755, rwxr-xr-x and chmod commands with a checkbox grid.
- Unicode Inspector: paste text to see every code point with its line and column, UTF-8 bytes and category, and find the zero-width spaces, bidi controls (Trojan Source), odd spaces and lone surrogates that break parsers. Flagged only shows just the problem characters, and Clean strips them while keeping emoji intact.
- ID Generator: make UUID v4, UUID v7 and ULID ids, with or without a prefix like `user_`. UUID v7 and ULID sort in creation order, even within a batch made in the same millisecond. Paste any UUID or ULID into "Inspect an ID" to see its version and when it was created.

## [0.7.0] — 2026-10-29

### Added
- Base64: encode images and other files. Drop a file on the page, paste a screenshot, or use Choose file. You get a preview with the real type and pixel size, and a warning when the file's name doesn't match its contents (for example, a JPEG saved as `.png`).
- Base64: copy a file as a `data:` URI, an `<img>` tag with its size and alt text, a CSS `url()`, or plain base64.
- Base64: when decoded base64 turns out to be an image, you see the image and can download it, instead of a hex dump.
- Base64: files up to 1 MB show their full output. Files up to 25 MB show the first 2 KB to keep the page responsive; Copy and Download still give you all of it. Larger files are refused before they're read.

## [0.6.1] — 2026-10-29

### Fixed
- Checkboxes now show a tick when checked. Before, a checked box was a plain white square, so on and off were hard to tell apart.

## [0.6.0] — 2026-10-29

### Added
- List Tools: chain operations. Build steps like "remove duplicates → natural sort → add prefix `sk_live_`" on one screen; each step shows how many lines went in and came out, so you can see which one ate your data. Reorder steps with the arrows or by dragging, and switch one off without deleting it.
- List Tools: eleven more operations: change case, prefix/suffix, filter (by text, regex, blank, line number or repeats), number lines, wrap, join, split, trim, Unicode normalize, keep a range, and compare with a second list (union, intersection, difference).
- List Tools: the warning about lines that look identical but are encoded differently now appears after any step that compares lines, not only after removing duplicates.

### Changed
- List Tools: the operations now run in the background. A regex that would freeze the page, such as `(a+)+$`, leaves it responsive; after 2 seconds you get a Cancel button. Your saved list settings reset once with this update.
- List Tools: Clear now empties only the input, and keeps your steps.

## [0.5.0] — 2026-10-26

### Added
- Diff: Ignore whitespace, Ignore case and Trim toggles. They change what counts as a difference, never the text you pasted, so highlights still land on your original characters. When nothing else differs, the badge says what it ignored.
- Diff: copy the comparison as a unified patch that applies with `patch`. It is always exact, so the Ignore toggles never change it.
- Diff: copy a link that opens the same comparison. Both sides are compressed into the part of the link after `#`, which browsers never send to a server, so nothing is uploaded. The link itself contains your text, though: anyone you give it to can read it, and it stays in browser history. Comparisons that compress to more than 8 KB cannot be shared this way; copy the patch instead.

### Changed
- Diff: highlights inside a changed line now cover whole words and punctuation instead of stray characters, and the change count counts changed blocks of lines (what Alt+↓ steps through) rather than individual edits.

### Fixed
- Diff: on inputs of a few kilobytes, the side-by-side view could mark every line as changed, including lines identical on both sides. Highlights now come from a line-by-line diff, so unchanged lines stay unmarked.
- Diff: the side-by-side view did not scroll with the mouse wheel or trackpad; only moving the cursor scrolled it.

## [0.4.0] — 2026-09-28

### Added
- JSON Formatter: a Tree view alongside the text output. It shows the same document the text does, with sorted keys and expanded embedded JSON, as a collapsible tree. Only the rows on screen are rendered, so large documents scroll smoothly. It opens a couple of levels deep, and has Expand all / Collapse all and full keyboard navigation (arrow keys, Home/End, Enter).
- JSON Formatter: copy the selected tree node's path as an RFC 6901 pointer (`/items/0/id`), a dot path (`items[0].id`) or a jq path (`.items[0].id`).
- JSON Formatter: embedded JSON strings can be expanded one field at a time. A field nested inside another payload unlocks once its parent is expanded.
- JSON Formatter: auto-fixes for almost-JSON. It strips a JSONP wrapper, the `)]}'` prefix, a byte-order mark and comments; converts single quotes; quotes bare keys; and removes trailing commas. Apply them in place, or review the change side by side in Diff first.
- JSON Formatter: lossless mode. When a document has numbers JavaScript cannot hold exactly, like `12345678901234567890`, format and minify keep them digit for digit instead of rounding them. This includes numbers inside expanded embedded JSON.

### Fixed
- JSON Formatter: with "Expand embedded JSON" on, a key named `__proto__` was silently dropped from the output. It is now kept like any other key.

## [0.3.0] — 2026-09-25

### Added
- HTML to Text: paste HTML and get readable plain text back. Paragraphs, lists and tables keep their structure; `script`, `style`, `head`, `svg`, hidden elements and icon ligatures (`role="img"`) are dropped, and entities are decoded. Link URLs and class-based hidden detection (`.hidden`, `.sr-only`) are optional toggles.

### Fixed
- v0.2.3 was tagged but never released or deployed. The Release workflow pasted the changelog notes straight into a shell command, so the backticks in them were executed as command substitution and the step failed after the tag had been pushed, skipping Deploy. The notes are now passed through an environment variable. This release ships the 0.2.3 fixes as well.

## [0.2.3] — 2026-09-24

### Fixed
- The security note in the ID generator rendered as overlapping fragments. It was a paragraph with `display: flex`, which makes every inline child — both text runs and the inline `<code>` — a separate flex item laid out in a row.
- Dropdowns had cramped padding and the native arrow overlapped the border at our control height. The native arrow is now suppressed and replaced with a chevron drawn inside the padding box, with room reserved for it.
- The preset dropdown always displayed "Preset…" regardless of the settings in use. It now shows whichever preset the current options match, derived from those options rather than stored, so it survives a reload and falls back to "Custom" as soon as any field changes.

### Changed
- The sidebar collapse control moved from the bottom of the tool list to the top, where it is visible without scrolling, and the collapse now animates. Both respect `prefers-reduced-motion`.

## [0.2.2] — 2026-09-24

### Fixed
- Releases tagged correctly but never deployed. The Release workflow only started Deploy when no `RELEASE_TOKEN` was configured, assuming a PAT-pushed tag would trigger it natively. With a PAT present that assumption took over silently: the tag was pushed, Release reported success, and Deploy had zero runs. Release now always starts Deploy explicitly.

## [0.2.1] — 2026-09-24

### Fixed
- The Release workflow checked out the commit that triggered it rather than the branch tip, so any re-run built on a stale base and its push was rejected as a non-fast-forward. It now checks out `main`, and each push is guarded so a partially-completed attempt resumes instead of blocking every retry.
- `.env` is now ignored. Nothing here needs one — the app has no backend and no runtime secrets — but an untracked `.env` is exactly what gets committed by accident on a public repository.

## [0.2.0] — 2026-09-24

### Added
- **ID Generator** — prefixed identifiers in the Stripe style (`sk_live_` plus 24 random characters): set a prefix, separator, length, alphabet and batch size. Doubles as a password generator via a symbol alphabet and an option to drop confusable glyphs (`0`/`O`, `1`/`l`/`I`).
  - Live entropy readout with a qualitative strength verdict. Deliberately no "time to crack" figure: that depends entirely on assumed hardware and on whether the value is hashed, so quoting one would be false precision.
  - Presets for Stripe secret and test keys, object ids, API tokens, hex session ids, passwords and human-readable codes.
  - Values come from `crypto.getRandomValues` with rejection sampling, never `value % n`, which biases toward the start of the alphabet.
  - Settings persist; **generated values never do**.
- Collapsible sidebar, kept as an icon rail with accessible names intact.
- Link to the GitHub repository in the header.
- Continuous integration on every pull request, including an entry-bundle size budget so a heavy dependency escaping a lazy chunk fails the build rather than reaching production.
- Release automation: merging to `main` creates a version tag, and the **tag** is what deploys. A merge that does not change the version in `package.json` releases nothing, so merging and releasing are separate decisions.

### Fixed
- Focus rings on full-bleed text areas were drawn outside the element and clipped by the surrounding pane, so only the top and right edges were visible. They are now drawn inset.

### Changed
- Unbiased randomness primitives moved to `src/lib/random.ts`, now shared by the list shuffler and the ID generator.

## [0.1.0] — 2026-09-24

First public release. Five tools, live at <https://devtools.fadeltd.dev>.

### Added

#### Diff Checker
- Side-by-side and unified views, sharing one editor state so toggling keeps cursor and scroll position.
- Word-level highlighting inside changed lines, collapsed unchanged regions, and exact `+n −m ~k` statistics computed from the diff rather than scraped from the rendered view.
- `Alt+↑` / `Alt+↓` to jump between changes; file picker per side.
- Size guardrails: degrades to line-only highlighting over 2 MB and refuses input that cannot be displayed usefully, rather than hanging.

#### Base64
- Encode and decode with correct UTF-8 handling via `TextEncoder`, using the native `Uint8Array` base64 API where available and a chunked fallback elsewhere.
- base64url alphabet, optional padding, and PEM/MIME line wrapping.
- Input sanitiser that strips `data:` URI headers, percent-encoding, BOMs and line wrapping — and reports every change it made, so a failed decode is never ambiguous about whether the tool mangled the input.
- Invalid characters are located by line and column, since the native API throws without a position.

#### List Tools
- Sort (natural, alphabetical, codepoint, length), remove duplicates with four output modes, randomize, reverse.
- Correct handling of trailing newlines, CRLF and lone CR, and byte-order marks. `a\nb\n` is two lines, not three.
- Explicit blank-line policy rather than silently dropping them.
- Warns when lines differ only by Unicode normalisation form.

#### JSON Formatter
- Format, minify, sort keys, escape and unescape JSON strings.
- Reports every distinct problem — not just the first — each with line, column and a tab-aware caret. Trailing commas are reported at the comma rather than at the closing brace that failed to parse.
- Detects NDJSON and offers to wrap it as an array.
- Warns separately about numbers that lose precision and numbers whose value survives but whose printed form changes.
- **Expands JSON that was serialised into a string**, recursively, for the double-encoded payloads that structured logs produce. Expansion is a view over the source, so it is reversible exactly.

#### Text Statistics
- Characters in all four meanings that differ in practice: grapheme clusters, code points, UTF-16 units and UTF-8 bytes.
- Letter, digit, punctuation, symbol and whitespace breakdown.
- Words, unique words, average and longest word, via `Intl.Segmenter` rather than whitespace splitting.
- Sentence counting that does not split on abbreviations or initials.
- Paragraphs, lines, longest line, reading and speaking time.
- Word and phrase frequency with density, and an opt-in stop-word filter.

#### Application
- Command palette (`⌘K`) that searches titles, aliases and competitor names, and prefetches a tool's code as you arrow through results.
- Pin up to nine tools to `⌘1`–`⌘9`; `?` shows a cheatsheet generated from the live shortcut registry.
- Per-tool state persistence that restores your last input, splitting small state (localStorage) from large payloads (IndexedDB). Tools handling credentials never persist and show a visible "Not saved" badge.
- Responsive layout that stacks panes on mobile rather than shrinking them.
- Build-time prerendering per tool route plus a generated sitemap, so each tool has real HTML for cold loads and link previews.

### Security
- Content Security Policy with no `unsafe-eval`, which also acts as a dependency filter.
- No backend, no analytics, and no third-party requests. Fonts are self-hosted so the page contacts nothing but its own origin.
