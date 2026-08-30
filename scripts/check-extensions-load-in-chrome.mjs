#!/usr/bin/env node
// Load both extensions in a real Chrome, the way a person does, and fail if
// either one does not come up.
//
// scripts/check-extensions-loadable.mjs answers a cheaper question: does every
// path a manifest names resolve to a file. It cannot tell whether Chrome
// accepts the manifest, or whether the service worker survives its own
// startup. This does, and it is the check that would have caught the four
// missing build outputs by watching the extension fail rather than by
// inspecting the tree.
//
// Not `--load-extension`: Chrome no longer honours that flag for this (checked
// on Chrome 151). The supported path is the DevTools Protocol's
// Extensions.loadUnpacked, which needs --enable-unsafe-extension-debugging.
//
// The page it visits is served from a local HTTP server rather than a public
// URL, so the check does not depend on the network. Content scripts match
// <all_urls>, which covers http://127.0.0.1 but not about:blank or data:.
//
// A service-worker target existing proves only that Chrome created the worker
// context, not that the worker's own startup script ran to the end. So before
// loading anything we turn on Target.setAutoAttach with waitForDebuggerOnStart,
// which holds each new worker before its first statement until we have a
// Runtime.exceptionThrown listener on it. An exception anywhere in startup then
// reaches us instead of being swallowed.
//
// Chrome comes from CHROME_PATH, or the usual install locations. Requires
// puppeteer-core, the only dependency this repository installs, and only for
// this check: `npm test` and `npm run check:loadable` still run on a bare
// checkout.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('No Chrome found. Set CHROME_PATH, or install Google Chrome.');
  console.error(`Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  process.exit(1);
}

/**
 * What each extension must be true of after Chrome loads it.
 *
 * `globals` are the service-worker globals the extension's own startup is
 * supposed to define. For the personalized extension they are the direct
 * regression test for the missing build outputs: `BrowserHarness` and
 * `BrowserAgent` come from browser-harness/dist/, `Validation` from
 * validation/dist/, `Librarian` from the generated lib/. If any of those files
 * goes missing again, importScripts throws, startup stops, and these are
 * undefined.
 */
const EXTENSIONS = [
  { name: 'original extension', dir: 'extension', globals: [] },
  {
    name: 'personalized extension',
    dir: 'personalized-extension/extension',
    globals: ['BrowserHarness', 'BrowserAgent', 'Validation', 'Librarian'],
  },
];

/** A minimal page with the shapes a content script is likely to touch. */
const TEST_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Load check</title></head><body><h1>Load check</h1>
<p>A paragraph, <a href="#x">a link</a>, and <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""> an image.</p>
<button type="button">A button</button></body></html>`;

/** @type {{ name: string, message: string }[]} */
const failures = [];
const fail = (name, message) => failures.push({ name, message });

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(TEST_PAGE);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

for (const { name, dir, globals } of EXTENSIONS) {
  const absDir = path.join(repoRoot, dir);
  console.log(`\n${name} (${dir})`);
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      // Puppeteer disables extensions by default, which would make every
      // extension silently absent and every assertion below meaningless.
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--enable-unsafe-extension-debugging',
      ],
    });

    const cdp = await browser.target().createCDPSession();

    // Every uncaught exception any service worker throws, startup included.
    // The listener is in place before Extensions.loadUnpacked below, and every
    // worker is held at its first statement until we resume it, so there is no
    // window in which an early throw could be missed.
    const workerErrors = [];
    cdp.on('Target.attachedToTarget', async ({ sessionId, targetInfo, waitingForDebugger }) => {
      const session = cdp.connection().session(sessionId);
      if (!session) return;
      try {
        if (targetInfo.type === 'service_worker') {
          session.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
            workerErrors.push((d.exception?.description || d.text).split('\n').slice(0, 2).join(' '));
          });
          await session.send('Runtime.enable');
        }
      } catch {
        // An unusable session is reported by the assertions below, not here.
      } finally {
        // Always resume, or a worker we failed to instrument hangs forever.
        if (waitingForDebugger) await session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
      }
    });
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

    let id;
    try {
      ({ id } = await cdp.send('Extensions.loadUnpacked', { path: absDir }));
    } catch (e) {
      fail(name, `Chrome refused to load it. ${e.message.split('\n')[0]}`);
      continue;
    }
    console.log(`  loaded, id ${id}`);

    // The service worker registers a moment after the extension installs.
    const sw = await browser
      .waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(id), { timeout: 20000 })
      .catch(() => null);
    if (!sw) {
      fail(name, `service worker never started.`);
      continue;
    }
    console.log('  service worker running');

    if (globals.length > 0) {
      const worker = await sw.worker();
      const found = await worker
        .evaluate((names) => Object.fromEntries(names.map((n) => [n, typeof globalThis[n]])), globals)
        .catch((e) => ({ __error: String(e).split('\n')[0] }));
      if (found.__error) {
        fail(name, `could not read service-worker globals. ${found.__error}`);
      } else {
        const missing = globals.filter((n) => found[n] === 'undefined');
        if (missing.length > 0) {
          fail(
            name,
            `service worker started but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} undefined. ` +
              'A script it imports is missing or threw.'
          );
        } else {
          console.log(`  service-worker globals defined: ${globals.join(', ')}`);
        }
      }
    }

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
    page.on('console', (m) => {
      if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`.slice(0, 300));
    });
    await page.goto(pageUrl, { waitUntil: 'load', timeout: 30000 });
    // Content scripts run at document_idle, and this one has work to do.
    await new Promise((r) => setTimeout(r, 4000));
    if (pageErrors.length > 0) {
      fail(name, `${pageErrors.length} error(s) on a plain page:\n      ${pageErrors.slice(0, 6).join('\n      ')}`);
    } else {
      console.log('  no errors on a plain page');
    }

    // Last, because a startup exception can surface after the worker target
    // appears and after the page settles.
    if (workerErrors.length > 0) {
      fail(
        name,
        `${workerErrors.length} uncaught error(s) in the service worker:\n      ` +
          workerErrors.slice(0, 6).join('\n      ')
      );
    } else {
      console.log('  service worker startup threw nothing');
    }
  } catch (e) {
    fail(name, `check could not run. ${e.message.split('\n')[0]}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

server.close();

if (failures.length > 0) {
  const affected = new Set(failures.map((f) => f.name)).size;
  console.error(
    `\n${affected} of ${EXTENSIONS.length} extensions did not load cleanly ` +
      `(${failures.length} failure${failures.length === 1 ? '' : 's'}):\n`
  );
  for (const f of failures) console.error(`  ${f.name}: ${f.message}`);
  console.error(
    '\nBoth extensions are expected to load unpacked from what is committed\n' +
      'here, so this is a defect in the tree, not in the check. Reproduce\n' +
      'locally with `npm run check:chrome`, or by hand: chrome://extensions,\n' +
      'Developer mode, Load unpacked.\n'
  );
  process.exit(1);
}

console.log('\nBoth extensions load in Chrome and start cleanly.');
