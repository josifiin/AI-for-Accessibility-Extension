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
// pin in vendor/PIN.json, and refreshes both lockfiles (npm ci verifies the
// integrity hash recorded for file: tarballs, so a stale lock fails).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
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
const repo = arg('--repo') ?? 'https://github.com/anoopsinha/AI-for-Accessibility-Toolkit-Draft';
if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
  console.error('usage: node scripts/update-vendor.mjs --commit <sha> [--repo <url-or-local-path>]');
  process.exit(1);
}

function run(cmd, cmdArgs, cwd) {
  return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
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
  copyFileSync(packed.toolkit, path.join(repoRoot, 'vendor', 'ai4a11y-toolkit.tgz'));
  copyFileSync(packed.tools, path.join(repoRoot, 'vendor', 'ai4a11y-tools.tgz'));
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

  // Refresh both lockfiles so npm ci's integrity check matches the new tarballs.
  for (const dir of [repoRoot, path.join(repoRoot, 'personalized-extension')]) {
    run('npm', ['install', '--no-audit', '--no-fund', '--silent'], dir);
  }
  console.log(`vendored @ai4a11y/toolkit and @ai4a11y/tools at ${fullSha}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
