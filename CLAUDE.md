# AI for Accessibility Extension

This repository holds the browser-facing half of the project, split out of
the toolkit repository with full history. The toolkit core, the tools
catalog, and the hosted service are canonical in
<https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit>;
work on them belongs there, not here.

## Architecture

- `extension/` — the original Chrome extension. Its content and popup
  bundles are committed and were built from the toolkit repo's `tools/`
  catalog; the source under `extension/src/` is the extension shell around
  that catalog.
- `personalized-extension/` — the richer extension: onboarding, memory
  (Librarian), the Adapter Builder and Skill Builder, voice mode, an
  in-extension browser harness. Its `extension/lib/{taxonomy,datastore,
  librarian,tools-registry,skills-db}.js` are generated from toolkit source
  and committed.
- `webapp/` — two full-stack prototypes (text control, voice control) plus a
  browser-harness port. Candidates to return to their originating teams.
- `docs/` — extension-facing docs. `VENDORED.md` records third-party code.

## Builds and tests

The committed bundles are the runnable state, and this repository rebuilds
them itself from the vendored `@ai4a11y/toolkit` and `@ai4a11y/tools`
packages (`vendor/`, pinned by `vendor/PIN.json`; bump with
`node scripts/update-vendor.mjs --commit <sha>`). `npm ci` in both roots,
then `npm run build`. Never hand-edit a `*.bundle.js` or a generated
`lib/` file.

```bash
npm test               # Librarian regression suite; the one fully self-contained suite
npm run check:loadable # every file the two manifests and service workers reference
npm run check:chrome   # loads both extensions in a real Chrome (needs Chrome + npm ci)
```

`check:loadable` is what stops a build output going missing from a commit:
an output that is absent, or caught by a `.gitignore` rule, is otherwise
invisible until Chrome refuses to load the extension. CI also rebuilds both
extensions and fails on any diff against the committed outputs.

## Known tradeoffs (context for reviewers)

1. **Gemini API key in URL query parameter** — required by the Gemini API
   when called from browser extensions; avoiding it needs a proxy server.
   Users are told this is a client-side extension. An accepted tradeoff, not
   a security bug.
2. **Custom adapters are linted, not sandboxed** — they run as Chrome user
   scripts with full page access. This is the repo's central disclosure; see
   SECURITY.md. Do not weaken its wording.
3. The acting-user partition and datastore lifecycle notes concern toolkit
   core code and live in the toolkit repo's notes; the generated
   `personalized-extension/extension/lib/` files embody that behavior but
   are not the place to change it.

## Terminology

- **Adapter** — executable code that adapts a page. Developer-authored ones
  live in the toolkit repo's `tools/adapters/`; users generate their own in
  the **Adapter Builder** (`personalized-extension/extension/adapter-builder/`),
  which writes real JS run as a user script. Build one only for a capability
  no adapter has yet.
- **Skill / `SKILL.md`** — a model-facing playbook that composes existing
  adapters into a recipe for a need. Built in the **Skill Builder**
  (`personalized-extension/extension/skill-builder/`) by the Engineer, or
  hand-written in the toolkit repo's `toolkit/skills/builtin/`. No code.
  This is the common case, and where onboarding sends the needs it couldn't
  cover — the Skill Builder hands off to the Adapter Builder only when
  composition fails.
- **Auditor** — code that finds issues for adapters to fix; lives in the
  toolkit repo's `tools/auditors/`.
- *Internal identifiers in `personalized-extension/` (`customSkills`,
  `skillRegistry`, `openSkillBuilder` → the Adapter Builder,
  `openSkillManager` → the Skill Builder, `aa-custom-` user-script IDs,
  storage keys) still say "skill" from an earlier naming — renaming them
  needs a storage migration.*
