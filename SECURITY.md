# Security

## Reporting

Please report vulnerabilities privately through GitHub's
[security advisory](https://github.com/fadeltd/devtools/security/advisories/new)
form rather than opening a public issue.

## Threat model

This is a static site with **no backend, no database and no user accounts**.
Everything runs in your browser, so there is no server-side data to breach and
nothing you paste is transmitted anywhere.

That shifts the interesting risks to the client:

- **Cross-site scripting.** User input is never rendered as HTML. No
  `innerHTML`, no `dangerouslySetInnerHTML`. Pasted SVG is rendered only via
  `<img src={blobUrl}>`, which executes no script and loads no subresources.
- **Content Security Policy.** `public/_headers` sets a CSP with no
  `'unsafe-eval'`, which also acts as a dependency filter — libraries requiring
  `new Function` are not used.
- **Supply chain.** A malicious dependency could exfiltrate what you paste.
  Dependencies are pinned exactly, kept few, and reviewed before addition.
  `connect-src 'self'` in the CSP means an injected script has no obvious
  egress.
- **Local storage.** Tool inputs persist in your browser only. Tools handling
  credentials (JWTs, passphrases, generated passwords) declare
  `store: { kind: 'none' }` and show a visible "Not saved" badge — never
  persisting them.

## What this project cannot protect you from

The site is delivered as JavaScript from a server. If that server or its build
pipeline were compromised, the page could be replaced with one that does
exfiltrate your input. That risk is inherent to every web-based tool, including
every alternative to this one.

For genuinely sensitive material, use local tooling you control — `jq`, `age`,
`openssl` — rather than any website.
