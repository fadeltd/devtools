# Bundled fonts

These are third-party fonts redistributed with this project, **not** our work.
Each is licensed under the SIL Open Font License 1.1, which permits bundling and
redistribution — including commercially — but requires the copyright notice and
license text to travel with the font files. That is what the files beside this
one are for. Do not remove them.

| File | Font | Copyright | License |
|---|---|---|---|
| `inter-var.woff2` | [Inter](https://github.com/rsms/inter) | © 2016 The Inter Project Authors | [OFL 1.1](Inter-LICENSE.txt) |
| `jetbrains-mono-var.woff2` | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | © 2020 The JetBrains Mono Project Authors | [OFL 1.1](JetBrainsMono-LICENSE.txt) |

Both are latin-subset **variable** fonts: one file covers every weight, which is
why there is a single file per family rather than one per weight.

They are self-hosted rather than loaded from a CDN because a third-party request
on every page load would contradict this site's one promise — that nothing about
your session leaves the browser. See `CLAUDE.md`.
