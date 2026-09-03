# Contributing

This repository holds the browser-facing half of the project: the two Chrome
extensions and the prototype web apps. The tools catalog and the toolkit core
they are built from live in the
[toolkit repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit),
so the first question is which repo your contribution belongs in.

## Which repo does my contribution go to?

| I want to... | Where |
|--------------|-------|
| **Find an issue** (new auditor) | Toolkit repo → `tools/auditors/` |
| **Fix an issue** (new adapter) | Toolkit repo → `tools/adapters/` |
| **Combine adapters for a need** (new skill) | Toolkit repo → `toolkit/skills/builtin/` |
| **Add or tune a profile** | Toolkit repo → `tools/profiles/settings.json` |
| **Change the extension UI** (popup, background, content script) | Here → `extension/` |
| **Work on onboarding, memory, the Adapter Builder or Skill Builder, voice mode** | Here → `personalized-extension/` |
| **Work on the web app prototypes** | Here → `webapp/` |

Rule of thumb from the catalog side: **need a new primitive → adapter (code);
need a new recipe → skill (no code).** A skill only composes adapters that
already exist. Both are toolkit-repo contributions; this repo picks them up
through its built bundles.

## Set up

```bash
git clone https://github.com/josifiin/AI-for-Accessibility-Extension.git
```

No build step is needed to run what is here: the bundles are committed.

- Chrome: `chrome://extensions` → Developer mode on → **Load unpacked** → `extension/`
- Personalized extension: **Load unpacked** → `personalized-extension/extension/` (keep Developer mode on; its generated adapters run as user scripts)

## The registry and settings vocabulary

The canonical registry moved into the toolkit:
[`personalized-extension/skills/registry.js`](personalized-extension/skills/registry.js)
is now a one-line re-export of `@ai4a11y/toolkit/registry`, whose
`settingsMeta` is the full settings vocabulary — every key, its type, and
its valid range — and is what `validateSkill` checks recipes against. When
an adapter lands in the toolkit repo's catalog, it becomes available here
through a one-line re-export in `personalized-extension/skills/builtin/`;
its registry entry (`supportAreas`, `settings`, a one-line `description`,
`quickStart: true` for fast onboarding) is made in the toolkit repo's
`toolkit/registry/tools.js`.

Note: the re-export files and the full builds resolve the toolkit code from
the vendored `@ai4a11y/toolkit` and `@ai4a11y/tools` packages, so the
bundles rebuild here: `npm ci` in both roots, then `npm run build`. Commit
the rebuilt outputs with your change; CI fails on stale bundles. See
"Builds and tests" in the README.

## Testing

```bash
npm test   # Librarian regression suite (86 checks, no install needed)
```

`personalized-extension/test/verifier-test.mjs` also runs here, now that
its imports resolve from the vendored packages; CI runs it. Two browser
tests need a local Chromium and are skipped in CI —
`personalized-extension/test/skills-page-test.js` and `demo-beats-e2e.js`.
Run them locally if you touched the Skill Builder page or the demo.

Then try your change on real pages: load the extension and use it. Test on
more than one kind of page (an article, a form, a data table).

## PR Guidelines

- One feature per PR
- Test on real sites
- `npm test` and `npm run check:loadable` must pass; both run on a bare
  checkout with no install
- If you touched a manifest, a service worker or a committed bundle, run
  `npm run check:chrome` too (needs Chrome and one `npm ci`)
- Describe who benefits (which disability/profile)
- The committed bundles are the runnable state. Do not hand-edit a
  `*.bundle.js` or a generated `personalized-extension/extension/lib/` file;
  if your change affects them, rebuild (`npm run build`) and commit the
  outputs, or CI fails on the drift

## Code Style

- ES modules, bundled by esbuild
- Use the AI provider abstraction for AI features (`utils/ai.js` in the
  `@ai4a11y/tools` package; canonical source in the toolkit repo)
- Document which profiles/disabilities the feature helps
- No large binaries — use Git LFS or link externally

## Ethics

- People with disabilities must be involved in design and evaluation
- Compensate participants
- Handle user profiles and personalization data carefully
- Don't simulate ability profiles without community input

## Questions?

Open an issue or ping [@chuanenlin](https://github.com/chuanenlin) (David).
