# Vendored third-party code

Third-party code committed into this repository, where it came from, and how
it is maintained. Versions below are read from the files' own headers.

## Browser Harness (browser-use)

Upstream: <https://github.com/browser-use/browser-harness>, MIT license
(Copyright (c) 2026 Browser Use). The exact upstream commit it was taken from
was not recorded at the time; the upstream LICENSE is preserved alongside each
adaptation's code.

Two first-party adaptations of it live in this repository. They are ports, not
copies, and have diverged from upstream by design:

- `webapp/browser-harness/` — the Python daemon form, close to upstream's
  shape, driving a remote-debugging Chrome over a WebSocket.
- `personalized-extension/extension/browser-harness/` — a JavaScript port of
  the same primitives to `chrome.debugger`, so the harness can run inside the
  extension's service worker. Its README records the port.

A third copy of the upstream project
(`personalized-extension/extension/browser-harness/browser-harness-orig/`)
was reduced to the part the extension actually consumes at runtime. The JS
port loads upstream's markdown knowledge files from that folder through
`chrome.runtime.getURL` (the build bakes their index into
`skills-manifest.json`), so `interaction-skills/` and
`agent-workspace/domain-skills/` stay, together with the upstream LICENSE
and README. The duplicate implementation around them (the Python daemon
source, tests, docs, and packaging) was removed; it exists in this
repository's history and at the upstream URL. The kept domain skills
include playbooks for sites unrelated to accessibility; whether to prune
them is a behavior decision for the maintainers, because the in-extension
agent reads them.

## axe-core (Deque)

- `extension/lib/axe.min.js` — v4.11.3, vendored copy loaded by the original
  extension.
- `personalized-extension/extension/lib/axe.min.js` — v4.12.1, not
  hand-vendored: `personalized-extension/build.js` copies it from the
  `axe-core` npm dependency at build time; the committed copy keeps the
  extension loadable without a build.

The two extensions currently pin different axe versions and can disagree
about what counts as a violation. Aligning them means moving the original
extension's copy onto the same npm-managed path, which needs its build to run
from this repository again (see the README on builds).

## Other libraries vendored in `extension/lib/`

| File | Project | Version (from header) |
|---|---|---|
| `ally.min.js` | ally.js | v1.4.1 |
| `darkreader.js` | Dark Reader | v4.9.120 |
| `easy-speech.js` | EasySpeech | not stated in header |
| `focus-trap.min.js` | focus-trap | 7.6.4 |
| `readability.js` | Mozilla Readability | not stated in header |
| `tabbable.min.js` | tabbable | 6.2.0 |
| `OpenDyslexic-Regular.woff2` | OpenDyslexic font | n/a |
