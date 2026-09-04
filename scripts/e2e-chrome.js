// Shared scaffolding for the real-Chrome journeys under extension/test and
// personalized-extension/test: finding Chrome, serving a fixture directory,
// launching Chrome with an unpacked extension over the DevTools Protocol, and
// the small check and wait helpers every journey needs. One copy, so the
// journeys keep asserting against the same browser setup.
//
// Chrome comes from CHROME_PATH or the usual install locations. The extension
// is loaded with Extensions.loadUnpacked rather than --load-extension, which
// Chrome no longer honors; that needs --enable-unsafe-extension-debugging.
// scripts/check-extensions-load-in-chrome.mjs takes the same approach.
//
// CommonJS, because the journeys are. puppeteer-core resolves from the
// repository root, where it is a devDependency.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

// The first Chrome that exists, or exit 1 with the list that was tried.
function findChrome() {
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) {
    console.error('No Chrome found. Set CHROME_PATH, or install Google Chrome.');
    console.error(`Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
    process.exit(1);
  }
  return chrome;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.vtt': 'text/vtt',
};

// Serve the files in `fixtureDir` by basename on an ephemeral 127.0.0.1 port.
// Resolves to the server; its address().port is the port.
function startFixtureServer(fixtureDir) {
  const server = http.createServer((req, res) => {
    const name = path.basename(req.url.split('?')[0]) || 'page.html';
    try {
      const body = fs.readFileSync(path.join(fixtureDir, name));
      res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Launch Chrome with a fresh profile, load the unpacked extension at `extPath`,
// and wait for its service worker. Resolves to { browser, cdp, extId, worker,
// readStorage, close }. `readStorage(keys)` reads sync storage from the worker;
// `close()` closes Chrome and removes the profile.
async function launchWithExtension({ chrome, extPath, profilePrefix }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix));
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir,
    // Puppeteer turns extensions off by default, which would make every
    // assertion in a journey pass for the wrong reason.
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-extension-debugging',
      // Popup and driver tabs stay in the background for a whole journey.
      // Without these their renderers are throttled and clicks stall.
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const close = async () => {
    await browser.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };
  let cdp, extId, worker;
  try {
    cdp = await browser.target().createCDPSession();
    ({ id: extId } = await cdp.send('Extensions.loadUnpacked', { path: extPath }));
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes(extId),
      { timeout: 20000 }
    );
    worker = await swTarget.worker();
  } catch (e) {
    await close();
    throw e;
  }
  console.log(`extension loaded: ${extId}\n`);
  const readStorage = (keys) =>
    worker.evaluate((k) => new Promise((r) => chrome.storage.sync.get(k, r)), keys);
  return { browser, cdp, extId, worker, readStorage, close };
}

// PASS/FAIL lines as they happen, and a summary at the end. `finish()` prints
// the summary and returns how many checks failed.
function makeChecks() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`);
  }
  function finish() {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
      console.log('Failed:');
      for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    }
    return failed.length;
  }
  return { check, finish };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll `read()` until `ready` holds, or give up and hand back the last value
// read so the check that follows prints what it actually saw. Extensions write
// storage and apply settings asynchronously, so a read at a fixed delay races
// them.
async function waitFor(read, ready, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (ready(last)) return last;
    await sleep(100);
  } while (Date.now() < deadline);
  return last;
}

function waitForStorage(readStorage, keys, ready, timeoutMs) {
  return waitFor(() => readStorage(keys), ready, timeoutMs);
}

module.exports = { findChrome, startFixtureServer, launchWithExtension, makeChecks, sleep, waitFor, waitForStorage };
