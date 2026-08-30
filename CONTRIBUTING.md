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

The personalized extension's skill registry lives here:
[`personalized-extension/skills/registry.js`](personalized-extension/skills/registry.js).
`settingsMeta` in that file is the full settings vocabulary — every key, its
type, and its valid range — and it is what `validateSkill` checks recipes
against. When an adapter lands in the toolkit repo's catalog, it becomes
available here through a one-line re-export in
`personalized-extension/skills/builtin/` plus a registry entry with its
metadata (`supportAreas`, `settings`, a one-line `description`, and
`quickStart: true` to show it in fast onboarding).

Note: the re-export files and the full builds resolve paths into the toolkit
repo's tree, so **rebuilding the bundles currently happens there**, where
both trees exist side by side. If your change needs a rebuild, say so in the
PR; see "Builds and tests" in the README.

## Testing

```bash
npm test   # Librarian regression suite (86 checks, no install needed)
```

The remaining suites import toolkit source and run in the toolkit repo. Two
browser tests need a local Chromium and are skipped in CI —
`personalized-extension/test/skills-page-test.js` and `demo-beats-e2e.js`.
Run them locally if you touched the Skill Builder page or the demo.

Then try your change on real pages: load the extension and use it. Test on
more than one kind of page (an article, a form, a data table).

## PR Guidelines

- One feature per PR
- Test on real sites
- `npm test` must pass
- Describe who benefits (which disability/profile)
- The committed bundles are the runnable state. Do not hand-edit a
  `*.bundle.js` or a generated `personalized-extension/extension/lib/` file;
  if your change requires regenerating them, note it in the PR

## Code Style

- ES modules, bundled by esbuild
- Use the AI provider abstraction for AI features (canonical in the toolkit
  repo's `tools/utils/ai.js`)
- Document which profiles/disabilities the feature helps
- No large binaries — use Git LFS or link externally

## Ethics

- People with disabilities must be involved in design and evaluation
- Compensate participants
- Handle user profiles and personalization data carefully
- Don't simulate ability profiles without community input

## Questions?

Open an issue or ping [@chuanenlin](https://github.com/chuanenlin) (David).
