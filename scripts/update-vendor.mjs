// Refresh the vendored toolkit packages under vendor/.
//
// This repository consumes @ai4a11y/toolkit and @ai4a11y/tools as packed
// tarballs pinned to one toolkit commit, because npm cannot install a package
// that lives in a subdirectory of a git repository. The tarballs are build
// inputs only; the shipped extensions run from the committed bundles either
// way. If the packages are ever published to a registry, vendor/ goes away
// and each dependency becomes a one-line version specifier.
//
// Usage:
//   node scripts/update-vendor.mjs --commit <sha> [--repo <url-or-local-path>]
//
// Fetches the commit into a temporary clone, runs `npm pack` in toolkit/ and
// tools/, copies the tarballs to version-less names under vendor/, records the
// pin in vendor/PIN.json, then refreshes both lockfiles. `npm ci` verifies the
// integrity hash a lockfile records for a file: tarball, so a stale hash fails
// the install. `npm install` alone does not help: the tarball path never
// changes across a re-vendor, so npm treats the entry as up to date and keeps
// the old hash. The script therefore rewrites the four integrity fields itself
// from the bytes of the new tarballs, and only then runs `npm install` in both
// roots to pick up any change in the packages' own dependencies.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
const commit = arg('--commit');
const repo = arg('--repo') ?? 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit';
if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
  console.error('usage: node scripts/update-vendor.mjs --commit <sha> [--repo <url-or-local-path>]');
  process.exit(1);
}

function run(cmd, cmdArgs, cwd) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

// The same string ssri produces for a tarball, and the form npm writes into a
// lockfile: the algorithm name, then the base64 of the raw SHA-512 digest.
function integrityOf(file) {
  return `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`;
}

// Rewrite the integrity of every entry that resolves to one of our vendored
// tarballs. `hashes` maps a tarball file name to its new integrity string. The
// two lockfiles spell the path differently (`file:vendor/...` at the root,
// `file:../vendor/...` under personalized-extension/), so entries are matched
// on the file name rather than the whole path. Everything else in the JSON is
// left as it was: npm's own format is two-space indent and a trailing newline,
// which is what a parse and re-serialize round trip gives back.
function refreshLockIntegrity(lockPath, hashes) {
  const before = readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(before);
  for (const entry of Object.values(lock.packages ?? {})) {
    const match = /^file:(?:\.\.\/)*vendor\/(.+)$/.exec(entry?.resolved ?? '');
    if (!match || !Object.hasOwn(hashes, match[1])) continue;
    entry.integrity = hashes[match[1]];
  }
  const after = `${JSON.stringify(lock, null, 2)}\n`;
  if (after !== before) writeFileSync(lockPath, after);
  return after !== before;
}

const tmp = mkdtempSync(path.join(tmpdir(), 'ai4a11y-vendor-'));
try {
  // Plain clone rather than a by-SHA fetch: fetching an arbitrary commit
  // needs uploadpack.allowReachableSHA1InWant on the server, which local
  // path remotes do not enable.
  const clone = path.join(tmp, 'toolkit-src');
  run('git', ['clone', '--quiet', '--no-checkout', repo, clone], tmp);
  run('git', ['checkout', '--quiet', commit], clone);
  const fullSha = run('git', ['rev-parse', 'HEAD'], clone).trim();

  const packed = {};
  for (const dir of ['toolkit', 'tools']) {
    const out = run('npm', ['pack', '--pack-destination', tmp, '--silent'], path.join(clone, dir));
    packed[dir] = path.join(tmp, out.trim().split('\n').pop());
  }

  mkdirSync(path.join(repoRoot, 'vendor'), { recursive: true });
  const tarballs = {
    'ai4a11y-toolkit.tgz': path.join(repoRoot, 'vendor', 'ai4a11y-toolkit.tgz'),
    'ai4a11y-tools.tgz': path.join(repoRoot, 'vendor', 'ai4a11y-tools.tgz'),
  };
  copyFileSync(packed.toolkit, tarballs['ai4a11y-toolkit.tgz']);
  copyFileSync(packed.tools, tarballs['ai4a11y-tools.tgz']);
  writeFileSync(
    path.join(repoRoot, 'vendor', 'PIN.json'),
    JSON.stringify(
      {
        repo,
        commit: fullSha,
        note: 'Rebuild these tarballs with: node scripts/update-vendor.mjs --commit <sha>',
        node: process.version,
        npm: run('npm', ['--version'], repoRoot).trim(),
      },
      null,
      2
    ) + '\n'
  );

  // Refresh both lockfiles so npm ci's integrity check matches the new
  // tarballs. The hashes go in first, by hand, because npm will not revisit
  // them on its own; the install that follows settles the rest of the tree.
  const hashes = Object.fromEntries(
    Object.entries(tarballs).map(([name, file]) => [name, integrityOf(file)])
  );
  for (const dir of [repoRoot, path.join(repoRoot, 'personalized-extension')]) {
    const lockPath = path.join(dir, 'package-lock.json');
    if (refreshLockIntegrity(lockPath, hashes)) {
      console.log(`updated vendored tarball hashes in ${path.relative(repoRoot, lockPath)}`);
    }
    run('npm', ['install', '--no-audit', '--no-fund', '--silent'], dir);
  }
  console.log(`vendored @ai4a11y/toolkit and @ai4a11y/tools at ${fullSha}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
