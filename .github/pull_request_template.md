## What does this PR do?

## Which part(s) does it affect?

- [ ] Original extension (`extension/`)
- [ ] Personalized extension (`personalized-extension/`)
- [ ] Adapter Builder / Skill Builder (`personalized-extension/extension/{adapter,skill}-builder/`)
- [ ] Browser harness (`personalized-extension/extension/browser-harness/`)
- [ ] Validation layer (`personalized-extension/extension/validation/`)
- [ ] Voice/Text Control (`webapp/`)
- [ ] Docs

Auditors, adapters, profiles, the toolkit core and the CLI are canonical in
the [toolkit repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit).
A change to any of those goes there, and the rebuilt bundles arrive here as a
commit.

## Who benefits?

Which profiles/disabilities does this help?

## How to test

1. `npm test` (Librarian regression gate) and `npm run check:loadable`
2. Load the extension in Chrome: `chrome://extensions` → Developer mode →
   Load unpacked → `extension/`, or `personalized-extension/extension/` for
   the personalized one. There is no build step: the bundles are committed
3. ...

## Committed build outputs

If this PR changes a `*.bundle.js`, a file under
`personalized-extension/extension/lib/`, or anything under a `dist/`
directory, say which build produced it and in which repository. These are
generated files, not hand-edited ones.
