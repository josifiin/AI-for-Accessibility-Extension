<div align="center">

# AI for Accessibility Extension

**AI-powered Chrome extensions that adapt pages in real time to each person's abilities**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

</div>

---

This is an active research project: a technology probe, pre-alpha, from the AI
for Accessibility Collective. The adapters are demonstrations. Their
effectiveness for any person has not been formally validated, and nothing here
is a finished product.

The repository holds the browser-facing half of the project: the original
Chrome extension, the personalized extension (onboarding, memory, the Adapter
Builder and Skill Builder), and two prototype web apps. The toolkit core it is
built on (the library, the tools catalog, the hosted service) is canonical in
the [toolkit repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit).

## Where things moved

This repository was split out of the toolkit repository with its **full
history preserved**, so every past version of every file is still here.
Paths that used to sit beside the extensions now live in the toolkit repo:
`toolkit/` (the core), `tools/` (auditors, adapters, profiles), `server/`
(the hosted service), `cli/`, `examples/`, and the core design docs.
`projects/` (team project code) and `webapp/` stayed here; the web apps are
candidates to return to their originating teams. The extensions still run
from here unchanged; see "Builds and tests" for how the two repos currently
relate.

## Who this is for

- **People who want a page adapted to their needs**, including people with
  disabilities anywhere in the world — start with "Install" below. No
  programming needed.
- **Developers contributing to the extensions** — extension code, the
  builders, and the web apps live here. New auditors, adapters, and profiles
  belong in the toolkit repo's `tools/`; skills in its `toolkit/skills/`.
- **Developers building on the toolkit, and other builders of agentic AI** —
  the toolkit repository is your entry point.

## Install

The built extension files are committed, so there is nothing to compile.

1. Download this repository: click the green **Code** button on GitHub, then
   **Download ZIP**, and unzip it (or `git clone` if you prefer).
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**
   (toggle in the top-right corner).
3. Click **Load unpacked** and choose the `extension/` folder from the
   unzipped download.
4. Open any article-like page, click the extension's toolbar icon, and pick a
   profile.

For the personalized extension (onboarding, memory, skills built for you),
load the `personalized-extension/extension/` folder the same way, and keep
Developer mode on: the adapters it builds run as user scripts, which Chrome
only allows in Developer mode.

### API key and cost

Many adaptations (bigger text, dark mode, spacing, focus, decluttering) work
with **no key and no cost**. The AI features (alt text for images, captions,
plain-language rewrites, translation) run on your own API key on your own
device: get a [Gemini API key](https://aistudio.google.com/apikey) and paste
it into the extension popup once. Google currently offers a free tier;
beyond it you pay Google directly for what the AI features use.
Cost estimates for typical use: *placeholder — not yet computed from current
provider pricing.*

## What to know before relying on it

- **Custom adapters are linted, not sandboxed.** They run as Chrome user
  scripts with full access to the pages they touch. Only install adapters
  you trust. Details in [SECURITY.md](SECURITY.md).
- **Sensitive sites.** Banking, health, and government sites default to
  no-memory zones: the extension does not record observations about your
  needs there unless you opt in. That gates what is *remembered*, not
  whether a page is *adapted*.
- **Not a substitute.** This is not a replacement for screen readers,
  magnifiers, or any other assistive technology you rely on. For a broader
  (non-comprehensive) starting point on assistive tools and accessible-use
  guidance, see the [W3C Web Accessibility Initiative](https://www.w3.org/WAI/).
- **Where your data lives.** Your profile stays on your device by default.
  Sending it to a server (remote mode) is something you set up yourself in
  the options page, and sharing with another app happens only through a
  grant you approve and can revoke; revoking stops all further reads. Free
  text you wrote and the system's confidence scores are never shared through
  grants. Details in [SECURITY.md](SECURITY.md).

## What is in this repository

- `extension/` — the original extension: profiles, auditors and adapters
  bundled in, popup UI. Loads as-is.
- `personalized-extension/` — the richer extension: onboarding, a memory
  that learns what helps you, the Adapter Builder and Skill Builder, voice
  mode, and an in-extension browser harness. Loads as-is from its
  `extension/` subfolder.
- `webapp/` — two full-stack prototypes (text control and voice control)
  plus a browser-harness copy. Candidates to return to their originating
  teams; kept here until that is decided.
- `docs/` — extension-facing docs ([index](docs/README.md)).
- [VENDORED.md](VENDORED.md) — provenance of third-party code committed in
  this tree.

## Builds and tests

The committed bundles are the runnable state of both extensions, and this
repository rebuilds them itself. The toolkit code they are built from is
consumed as two packages, `@ai4a11y/toolkit` and `@ai4a11y/tools`, vendored
as packed tarballs under `vendor/` and pinned to one toolkit commit by
`vendor/PIN.json`. The source stays canonical in the toolkit repository; a
toolkit upgrade here is a deliberate pin bump
(`node scripts/update-vendor.mjs --commit <sha>`), and CI verifies both that
the tarballs match the pinned commit and that the committed bundles match a
fresh rebuild.

```bash
npm ci && (cd personalized-extension && npm ci)
npm run build    # both extensions, from a fresh clone, no sibling checkout
```

`npm test` runs the Librarian regression suite (86 checks, no install
needed), which is fully self-contained. `personalized-extension/test/`
holds the rest; `verifier-test.mjs` runs here too now that its imports
resolve from the vendored packages.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: one feature per
PR, say who benefits (which disability or profile), and involve people with
disabilities in design and evaluation. Building accessibly remains the page
author's responsibility; this project fixes barriers in pages, it does not
remove the reason to avoid creating them.

## Security & License

Report vulnerabilities via [SECURITY.md](SECURITY.md), not public issues.
Licensed under Apache 2.0 ([LICENSE](LICENSE)).

---

<h2 align="center">AI for Accessibility Collective</h2>

<div align="center">
<p>
  <a href="https://www.stanford.edu/"><img src="docs/logos/stanford.png" alt="Stanford University" height="38"></a>
  &nbsp;&nbsp;
  <a href="https://www.washington.edu/"><img src="docs/logos/uw.png" alt="University of Washington" height="32"></a>
  &nbsp;&nbsp;
  <a href="https://www.media.mit.edu/"><img src="docs/logos/mit.png" alt="MIT Media Lab" height="35"></a>
  &nbsp;&nbsp;
  <a href="https://www.disabilityinnovation.com/"><img src="docs/logos/gdi.jpg" alt="UCL GDI Hub" height="35"></a>
  &nbsp;&nbsp;
  <a href="https://www.rit.edu/ntid/"><img src="docs/logos/rit.png" alt="RIT/NTID" height="40"></a>
  &nbsp;&nbsp;
  <a href="https://thearc.org/"><img src="docs/logos/thearc.png" alt="The Arc" height="35"></a>
  &nbsp;&nbsp;
  <a href="https://rnid.org.uk/"><img src="docs/logos/rnid.png" alt="RNID" height="32"></a>
  &nbsp;&nbsp;
  <a href="https://www.google.org/"><img src="docs/logos/google.png" alt="Google.org" height="28"></a>
</p>

</div>
