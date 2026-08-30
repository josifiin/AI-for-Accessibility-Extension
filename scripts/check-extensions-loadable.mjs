#!/usr/bin/env node
// Does a fresh checkout of this repository actually load in Chrome?
//
// The runnable state of both extensions is committed here rather than built
// here: the build inputs (`tools/`, `toolkit/`) are canonical in the toolkit
// repository. That arrangement is only safe if something notices when a
// required output is missing from the commit, which is how the personalized
// extension came to reference four files that no checkout ever contained.
//
// So this resolves, against the working tree, every file Chrome needs before
// it will run an unpacked extension:
//
//   - the manifest's own entry points (service worker, content scripts,
//     popup, side panel, options page, icons),
//   - every string literal the service worker passes to importScripts, which
//     throws at startup rather than at load time but leaves the extension
//     just as dead,
//   - the local <script src> and <link href> of every HTML page the manifest
//     names.
//
// Deliberately not checked: web_accessible_resources. Those are match
// patterns, not paths, and one of them (validation/corpus.json) is research
// text the extension is written to run without. A missing entry there is a
// supported state, not a broken build.
//
// Exits non-zero and names every missing file. No dependencies, so CI can run
// it on a bare checkout.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXTENSIONS = [
  { name: 'original extension', dir: 'extension' },
  { name: 'personalized extension', dir: 'personalized-extension/extension' },
];

/** Problems found, as { ext, requiredBy, file }. */
const missing = [];
let checked = 0;

/** Resolve a manifest-relative path and record it if it is not on disk. */
function require_(extDir, requiredBy, ref) {
  // Strip a query or fragment; Chrome ignores them for packaged resources.
  const rel = ref.split(/[?#]/)[0];
  if (!rel) return null;
  const abs = path.join(repoRoot, extDir, rel);
  checked += 1;
  if (!fs.existsSync(abs)) {
    missing.push({ ext: extDir, requiredBy, file: rel });
    return null;
  }
  return abs;
}

/**
 * Every brace depth at which a `try` block is open, in source order, so a
 * caller can ask whether a given offset sits inside one. Strings, template
 * literals, regex-ish slashes and comments are skipped so their braces and
 * the word "try" inside them do not count.
 *
 * Approximate by design: it does not parse JavaScript. It answers one
 * question, "is this call guarded", and a wrong answer costs a checker
 * message, not a wrong extension.
 */
function tryDepths(source) {
  const openTryDepths = [];
  const spans = [];   // { from, to, depth } for each try block
  let depth = 0;
  let lastWord = '';
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && next === '*') { i = source.indexOf('*/', i + 2) + 1; if (i < 1) break; continue; }
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
      continue;
    }
    if (c === '{') {
      depth += 1;
      if (lastWord === 'try') openTryDepths.push({ depth, from: i });
      lastWord = '';
      continue;
    }
    if (c === '}') {
      const open = openTryDepths[openTryDepths.length - 1];
      if (open && open.depth === depth) spans.push({ ...openTryDepths.pop(), to: i });
      depth -= 1;
      lastWord = '';
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j += 1;
      lastWord = source.slice(i, j);
      i = j - 1;
      continue;
    }
    if (!/\s/.test(c)) lastWord = '';
  }
  // Anything still open runs to the end of the file.
  for (const open of openTryDepths) spans.push({ ...open, to: source.length });
  return spans;
}

/**
 * The string literals a classic script hands to importScripts, split by
 * whether the call is guarded. A bare call to a missing file kills the
 * service worker on startup; one inside try/catch is how this codebase
 * declares a resource optional, as background.js does for the generated
 * remote-config.js that no fresh checkout has.
 */
function importScriptsTargets(source) {
  const guardedSpans = tryDepths(source);
  const required = [];
  const optional = [];
  for (const call of source.matchAll(/\bimportScripts\s*\(([^)]*)\)/g)) {
    const guarded = guardedSpans.some((s) => call.index > s.from && call.index < s.to);
    for (const literal of call[1].matchAll(/['"]([^'"]+)['"]/g)) {
      (guarded ? optional : required).push(literal[1]);
    }
  }
  return { required, optional };
}

/** Local script and stylesheet references inside an HTML page. */
function pageAssets(html) {
  const refs = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) refs.push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) refs.push(m[1]);
  // Anything with a scheme, and protocol-relative URLs, are not our files.
  return refs.filter((r) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(r));
}

for (const { name, dir } of EXTENSIONS) {
  const manifestPath = path.join(repoRoot, dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    missing.push({ ext: dir, requiredBy: 'repository', file: 'manifest.json' });
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error(`${name}: manifest.json is not valid JSON: ${e.message}`);
    process.exitCode = 1;
    continue;
  }

  /** HTML pages the manifest names, walked after the manifest itself. */
  const pages = [];

  const worker = manifest.background?.service_worker;
  if (worker) {
    const abs = require_(dir, 'manifest background.service_worker', worker);
    if (abs) {
      const workerDir = path.posix.dirname(worker);
      const { required, optional } = importScriptsTargets(fs.readFileSync(abs, 'utf8'));
      for (const target of required) {
        require_(dir, `${worker} importScripts`, path.posix.join(workerDir, target));
      }
      for (const target of optional) {
        const rel = path.posix.join(workerDir, target);
        if (!fs.existsSync(path.join(repoRoot, dir, rel))) {
          console.log(`      (optional, absent: ${rel})`);
        }
      }
    }
  }

  for (const [i, entry] of (manifest.content_scripts || []).entries()) {
    for (const js of entry.js || []) require_(dir, `manifest content_scripts[${i}].js`, js);
    for (const css of entry.css || []) require_(dir, `manifest content_scripts[${i}].css`, css);
  }

  const named = [
    ['action.default_popup', manifest.action?.default_popup],
    ['side_panel.default_path', manifest.side_panel?.default_path],
    ['options_ui.page', manifest.options_ui?.page],
    ['options_page', manifest.options_page],
  ];
  for (const [where, ref] of named) {
    if (!ref) continue;
    if (require_(dir, `manifest ${where}`, ref)) pages.push(ref);
  }

  const icons = { ...(manifest.icons || {}), ...(manifest.action?.default_icon || {}) };
  for (const [size, ref] of Object.entries(icons)) {
    if (typeof ref === 'string') require_(dir, `manifest icons[${size}]`, ref);
  }

  for (const page of pages) {
    const abs = path.join(repoRoot, dir, page);
    const pageDir = path.posix.dirname(page);
    for (const ref of pageAssets(fs.readFileSync(abs, 'utf8'))) {
      require_(dir, page, path.posix.normalize(path.posix.join(pageDir, ref)));
    }
  }

  const count = missing.filter((m) => m.ext === dir).length;
  console.log(count === 0 ? `ok    ${name} (${dir})` : `FAIL  ${name} (${dir}): ${count} missing`);
}

if (missing.length > 0) {
  console.error(`\n${missing.length} referenced file(s) are not in this checkout:\n`);
  for (const m of missing) console.error(`  ${m.ext}/${m.file}\n      required by ${m.requiredBy}`);
  console.error(
    '\nBoth extensions load unpacked from what is committed here. If one of\n' +
      'these is a build output, rebuild it in the toolkit repository and commit\n' +
      'it, and check it is not caught by a .gitignore rule.\n'
  );
  process.exit(1);
}

console.log(`\n${checked} referenced files resolved. Both extensions load from this checkout.`);
