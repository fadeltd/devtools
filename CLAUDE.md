# devtools.fadeltd.dev

A client-only developer toolbox deployed as a static SPA on Cloudflare Workers.
**Nothing the user pastes ever leaves the browser.** That is the product thesis,
not a nice-to-have — it is why the site is worth using over the free
alternatives, and several rules below exist only to protect it.

This file holds the rules. The maintainer also keeps `ROADMAP.md` and `TODO.md`
in the working tree — sequence, task board, and the list of deliberately
rejected ideas — but they are intentionally not published, so do not assume a
clone has them. If they are present, read them before re-litigating a decision.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Production build into `dist/` |
| `pnpm test` | Vitest (unit + property tests) |
| `pnpm lint` | oxlint |
| `pnpm exec tsc --noEmit` | Typecheck |
| `pnpm exec wrangler dev` | Serve `dist/` exactly as Cloudflare will |
| `pnpm deploy` | Build + `wrangler deploy` |

**pnpm only.** Never `npm` or `yarn`. `packageManager` is pinned and CI uses
`--frozen-lockfile`. `wrangler` is a dev dependency — always `pnpm exec
wrangler`, never a global install.

## Architecture

### The registry is the source of truth

`src/lib/registry/index.ts` drives the router, the home grid, the sidebar, the
command palette, the build-time prerender, and the sitemap.

**Adding a tool = one new folder under `src/tools/` + one entry in the registry.
Nothing else.** If a change requires hand-editing the router, the sidebar, or
the SEO scripts, the abstraction has been broken — fix that instead of working
around it.

Note the shape in `registry/index.ts`: `RAW_TOOLS` uses `as const satisfies` to
produce the literal `ToolSlug` union, then `TOOLS` is re-exported widened to
`ToolDef`. Both halves are load-bearing — the literal union keeps persistence
keys and links honest, and the widening keeps optional fields (`hidden`) and
full `StoreKind` reachable.

### The `core/` purity rule

`src/tools/*/core/**` imports nothing from React, the DOM, or any store. It
takes strings, bytes and options, and returns data. **All test effort goes
here**; the `.tsx` is a thin shell and is not unit-tested. No component tests,
no Playwright.

This is what makes ~30 tools maintainable and what lets any phase stop and still
ship something correct.

## Design system

The visual language comes from the Stitch output in `design/` — read
`design/stitch_developer_utilities_web_suite/devtools_precision_utility/DESIGN.md`
before changing anything visual. Note that the generated `code.html` files carry
a *different*, Material-derived palette than that DESIGN.md prose; **the prose is
authoritative** and is what `src/styles/global.css` implements.

Load-bearing rules from it:
- Dark only. No shadows, no gradients, no blurs. Hierarchy comes from flat tonal
  steps (`bg` → `surface` → `surface-2`) and 1px hairline borders.
- **Exactly one accent** (`--color-accent`, cyan), reserved for focus rings,
  active nav state, and selected palette rows. A primary button is the *inverse*
  of the canvas (`bg-fg text-bg`), not the accent — so the accent keeps meaning.
- Radius ceiling: `4px` controls, `6px` overlays/panels, `0px` data grids and
  split panes so they align to the hairline grid.
- 28px control height on desktop, 44px touch target below `md`.
- Inter for UI chrome, JetBrains Mono for all data, at 13px/18px.
- Semantic colors (add/del/warn) are for diff and validation only.

**Fonts are self-hosted** in `public/fonts` as latin-subset variable woff2
(~79 KB total, one file per family — Google serves one variable font for all
weights). Do not switch to the Google Fonts CDN: a third-party request on every
page load would contradict the site's one promise, and it would force the CSP
open beyond `font-src 'self'`.

## Rules (stated as prohibitions, because they are)

### Persistence
- **Never persist a secret.** Anything touching a JWT, passphrase, or generated
  password declares `store: { kind: 'none', reason }`, which makes the tool
  render a visible "Not saved" badge. The badge is the point: the behaviour must
  be observable, not just documented.
- **Never write a multi-MB payload to `localStorage`.** It is ~5 MB *and
  synchronous* — a big string both throws and janks the main thread. Declare
  `store: 'idb'` and store `Blob`s directly rather than base64.
- **A failed write must never break a tool.** Quota errors evict and degrade;
  they never propagate.
- No migrations. Bump `stateVersion` on a shape change; mismatched state is
  discarded by design.

### Security
- **The CSP in `public/_headers` is a dependency filter.** No `'unsafe-eval'`,
  ever. A library needing `new Function` or `eval` is rejected on those grounds
  alone — this is why `jsonpath-plus` is not in this project, despite being the
  obvious choice for JSON filtering. `'wasm-unsafe-eval'` is available for wasm.
  (Verified: Workers static assets does honour `_headers`.)
- **Never render user input as HTML.** No `innerHTML`, no
  `dangerouslySetInnerHTML`. Pasted SVG renders only via `<img src={blobUrl}>`,
  which executes no script and fetches no subresources.
- **Never add a fetch proxy.** It would make this an open proxy on our own
  domain (SSRF, abuse) and destroy the no-network guarantee. Tools that would
  need one are scoped down instead.

### Rendering
- **Never render large text into a `<pre>` of `<span>`s.** Either CodeMirror
  (viewport-rendered) or a bare `<textarea>`. Nothing else.
- **A plain `<textarea>` is the default**, via `components/ui/CodeArea`. It is
  faster on 100k lines than any editor and gives native find, select-all, copy
  and undo for free. CodeMirror is justified only in diff and JSON.
- No `manualChunks` in `vite.config.ts`. Splitting follows the registry's
  dynamic imports; hand-tuning is how CodeMirror lands in the entry bundle.
- Entry bundle budget: **~90 kB gzip.** It is ~83 kB today. If it jumps,
  something leaked out of a lazy route. The CodeMirror merge view (~92 kB gzip)
  must stay inside the `diff` route chunk, and `cmdk` inside the lazy
  `CommandPalette` chunk.
- `MergeView` sizing lives in `global.css`, not `EditorView.theme`: the
  `.cm-mergeView` / `.cm-mergeViewEditors` nodes are outside the editor, and
  without explicit width/height the two panes collapse toward their content.

### Mobile
- 16px minimum font on every `input`/`textarea`, or iOS Safari auto-zooms on
  focus and leaves the layout scrolled sideways. `global.css` sets this and
  restores 13px above `md`.
- `dvh`, never `vh` — `100vh` is wrong the moment the keyboard opens.
- Touch targets ≥44px below `md` (the primitives already do this), against the
  28px desktop density target.
- No hover-only affordances; they are unreachable on touch.
- `navigator.clipboard.writeText` must be called directly in the click handler,
  not from an effect, or Safari fails it silently.
- Stack panes, never shrink them. See `components/layout/TwoPane`.

### Correctness details that look like trivia and are not

Each of these is a silent data-corruption bug, not a style preference:

- **Hoist `Intl.Collator`** and extract `.compare` once. Calling
  `localeCompare` per comparison is 12× slower (measured: 806 ms vs 9.7 s on
  100k lines).
- **`crypto.getRandomValues` throws above 65,536 bytes per call.** A naive
  100k-element shuffle crashes. Refill in chunks.
- **Do not use `Number.isSafeInteger`** to detect lossy JSON numbers — it
  false-positives on `9007199254740992`. Use
  `BigInt(lit) !== BigInt(Number(lit))`.
- **`parseLines("a\nb\n")` must yield 2 lines, not 3.** The phantom trailing
  blank line is the #1 bug in every free list tool.
- **Never leave `\r` glued to a line end.** `"a\r" !== "a"` silently breaks both
  dedupe and sort.
- **`btoa` on a string breaks non-ASCII.** Always go through `TextEncoder`, and
  decode with `new TextDecoder('utf-8', { fatal: true })` so invalid input
  throws instead of producing U+FFFD soup.
- **`String.fromCharCode(...bigArray)` blows the argument limit.** Chunk at
  `0x8000`.

## Toolchain notes

- TypeScript 7 (Go-native). `tsc -v` works, `tsc --version` does not.
  `baseUrl` was **removed** — `paths` resolve relative to `tsconfig.json`.
- **Do not install ESLint.** `typescript-eslint` does not support TS 7 and that
  fix is deferred upstream. Use `oxlint`.
- Routing uses React Router in **declarative** mode (`BrowserRouter` +
  `Routes`), not data mode. We use no loaders or actions, and data mode cost
  16.6 kB gzip for nothing.
