// Real-Chrome check that the personalized extension switches on the captions a
// video already carries when the Show Captions quick-start setting is stored.
//
// The onboarding card for show-captions writes `showCaptions: true` to sync
// storage (skillIdsToSyncSettings in extension/onboarding/onboarding.js). This
// seeds that key the same way and reads the page's own <track> mode, because
// the track mode is what a Deaf or hard-of-hearing person actually gets.
//
// Chrome comes from CHROME_PATH or the usual install locations, and the
// extension is loaded over the DevTools Protocol, the same way
// profile-journey-e2e.js does it.
//
//   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node personalized-extension/test/show-captions-e2e.js
//
// Needs a local Chrome, so CI skips it.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const EXT_PATH = path.resolve(__dirname, '..', 'extension');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'show-captions');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.vtt': 'text/vtt' };

function startServer() {
  const server = http.createServer((req, res) => {
    const name = path.basename(req.url.split('?')[0]) || 'page.html';
    try {
      const body = fs.readFileSync(path.join(FIXTURE_DIR, name));
      res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// The mode of the fixture's only caption track, plus the adapter's own marker
// on the video, read from the page itself.
function readTrack(page) {
  return page.evaluate(() => {
    const v = document.getElementById('clip');
    const t = v.textTracks && v.textTracks[0];
    return { mode: t ? t.mode : 'no-track', marked: v.dataset.ai4a11yCaptions || null };
  });
}

// Poll the page until `ready` holds or the time runs out, handing back the last
// reading so a failed check prints what it saw. The content script applies
// stored settings after load, so a read at a fixed delay would race it.
async function waitForTrack(page, ready, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await readTrack(page);
    if (ready(last)) return last;
    await sleep(100);
  } while (Date.now() < deadline);
  return last;
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) {
    console.error('No Chrome found. Set CHROME_PATH, or install Google Chrome.');
    process.exit(1);
  }

  const server = await startServer();
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/page.html`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-pe-captions-'));

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-extension-debugging',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  try {
    const cdp = await browser.target().createCDPSession();
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: EXT_PATH });
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes(extId),
      { timeout: 20000 }
    );
    const worker = await swTarget.worker();
    console.log(`extension loaded: ${extId}\n`);

    const setStorage = (obj) =>
      worker.evaluate((o) => new Promise((r) => chrome.storage.sync.set(o, r)), obj);
    // Send a message to the fixture tab the way the voice actuation port does.
    const tellPage = (msg) =>
      worker.evaluate(
        (m) =>
          new Promise((resolve) => {
            chrome.tabs.query({ url: 'http://127.0.0.1/*' }, (tabs) => {
              if (!tabs.length) return resolve({ error: 'no fixture tab' });
              chrome.tabs.sendMessage(tabs[0].id, m, (resp) => {
                resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : resp);
              });
            });
          }),
        msg
      );

    // ---- Baseline: no setting, the track stays off -------------------------
    await setStorage({ enabled: true, onboardingComplete: true });
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
    await page.goto(fixtureUrl, { waitUntil: 'load' });
    await sleep(1500);
    const baseline = await readTrack(page);
    check('baseline: the caption track starts disabled', baseline.mode === 'disabled', JSON.stringify(baseline));
    check('baseline: the adapter has not marked the video', baseline.marked === null, JSON.stringify(baseline));

    // ---- The quick-start setting, as onboarding stores it -------------------
    await setStorage({ showCaptions: true });
    await page.reload({ waitUntil: 'load' });
    const on = await waitForTrack(page, (t) => t.mode === 'showing');
    check('with showCaptions stored, the caption track is showing after load', on.mode === 'showing', JSON.stringify(on));
    check('the adapter marks the video it handled', on.marked === 'on', JSON.stringify(on));

    // ---- Live disable, the message the actuation port sends ----------------
    const off = await tellPage({ type: 'disableTool', tool: 'ShowCaptions' });
    check('the content script answers disableTool for ShowCaptions', off && off.success === true, JSON.stringify(off));
    const restored = await waitForTrack(page, (t) => t.mode === 'disabled');
    check('disabling restores the track to its own mode', restored.mode === 'disabled', JSON.stringify(restored));
    check('disabling clears the marker', restored.marked === null, JSON.stringify(restored));

    // ---- Live enable, the same way -----------------------------------------
    const again = await tellPage({ type: 'enableTool', tool: 'ShowCaptions' });
    check('the content script answers enableTool for ShowCaptions', again && again.success === true, JSON.stringify(again));
    const showing = await waitForTrack(page, (t) => t.mode === 'showing');
    check('enabling switches the track back on', showing.mode === 'showing', JSON.stringify(showing));

    // ---- Withdrawal: the setting written false, as the actuation port does --
    // A plain remove of the key is not a withdrawal here: the background records
    // every explicit setting with the Librarian, and init() overlays those
    // records on the stored baseline after a reload. "Turn captions off" writes
    // false, and that false is what the Librarian then remembers.
    await setStorage({ showCaptions: false });
    await page.reload({ waitUntil: 'load' });
    await sleep(1500);
    const withdrawn = await readTrack(page);
    check('with showCaptions false, the track stays disabled after a reload', withdrawn.mode === 'disabled', JSON.stringify(withdrawn));
    check('and the video carries no marker', withdrawn.marked === null, JSON.stringify(withdrawn));
  } finally {
    await browser.close().catch(() => {});
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
