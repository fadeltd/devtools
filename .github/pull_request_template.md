## What

<!-- What changed, in a few bullets. Name the tool and the TODO id if there is one (e.g. A-14). -->

## Why

<!-- The problem this solves. Link the issue if there is one: "Closes #123". -->

## Testing

<!-- What you ran and what you checked by hand: browser, viewport, and the input you used. -->

## Checklist

- [ ] `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build` all pass
- [ ] New logic lives in `src/tools/<slug>/core/` with tests beside it; the `.tsx` stays a thin shell
- [ ] User-facing change → an entry under `## [Unreleased]` in `CHANGELOG.md` (without one, the merge releases nothing)
- [ ] No network request, third-party resource, `innerHTML`, or dependency that needs `eval`
- [ ] Anything touching a secret declares `store: { kind: 'none' }`; nothing multi-MB goes to `localStorage`
- [ ] Entry bundle still under ~90 kB gzip (CI enforces 92160 B)
- [ ] Works at phone width: panes stack, 44px touch targets, no hover-only controls
- [ ] Markdown prose is not hard-wrapped
