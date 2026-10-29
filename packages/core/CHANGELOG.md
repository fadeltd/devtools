# Changelog

All notable changes to `@fadeltd/devtools-core` are documented here. It is versioned separately from the devtools.fadeltd.dev site.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor version may change the API.

## [Unreleased]

Nothing yet.

## [0.1.0] — 2026-10-29

### Added
- First release: the engines behind devtools.fadeltd.dev, published as one ESM package with a subpath per tool: `/list`, `/json`, `/diff`, `/base64`, `/id-gen`, `/text-stats`, `/html-text`, plus the shared `/text` and `/random` helpers. Pure functions with type declarations, no DOM, Node 22.12+ or a current browser.
