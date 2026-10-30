## What

<!-- What changed, in a few bullets. Name the tool and the TODO id if there is one (e.g. A-14). -->

## Why

<!-- The problem this solves. Link the issue if there is one: "Closes #123". -->

## Testing

<!-- What you ran and what you checked by hand: browser, viewport, and the input you used. -->

## Checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass
- [ ] New logic lives in `packages/core/src/<slug>/` with tests beside it; the `.tsx` stays a thin shell
- [ ] Engine API or behaviour changed → an entry under `## [Unreleased]` in `packages/core/CHANGELOG.md`
- [ ] User-facing change → an entry under `## [Unreleased]` in `CHANGELOG.md` (without one, the merge releases nothing)
- [ ] No network request, third-party resource, `innerHTML`, or dependency that needs `eval`
- [ ] Anything touching a secret declares `store: { kind: 'none' }`; nothing multi-MB goes to `localStorage`
- [ ] First-load JS still under 105 KiB gzip (CI enforces 107520 B)
- [ ] Works at phone width: panes stack, 44px touch targets, no hover-only controls
- [ ] Markdown prose is not hard-wrapped
