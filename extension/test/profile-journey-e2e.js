// Release journey for the original extension.
//
// The journey a person walks: open the popup, tick a profile, watch the page
// change, reload the page and find the change still there, untick the profile,
// and find the page back the way it started. Every step is asserted against
// the fixture page's own computed style, not against the extension's internal
// state, because the page is what the person actually gets.
//
// The profile is Low Vision. Its preset lives in the shared profiles module
// (@ai4a11y/tools/profiles/settings.json) and asks for fontScale 150,
// lineHeight 2 and letterSpacing 0.12em. None of that needs an API key, so
// this journey runs with no credentials present.
//
// Chrome comes from CHROME_PATH or the usual install locations, and the
// extension is loaded over the DevTools Protocol rather than with
// --load-extension, which Chrome no longer honours. This is the same approach
// scripts/check-extensions-load-in-chrome.mjs takes.
//
//   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node extension/test/profile-journey-e2e.js
//
// Needs a local Chrome, so CI skips it.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXT_PATH = path.join(REPO_ROOT, 'extension');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'profile');

// The profile under test and the numbers its preset promises. Read from the
// shared module rather than typed in, so a preset change fails here loudly
// instead of leaving the journey asserting a stale number.
const PROFILE_ID = 'lowVision';
const PRESET = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, 'node_modules', '@ai4a11y', 'tools', 'profiles', 'settings.json'),
    'utf8'
  )
).profiles[PROFILE_ID].tools;

const BASELINE_FONT_PX = 16; // set by the fixture's own stylesheet
const SCALED_FONT_PX = BASELINE_FONT_PX * (PRESET.fontScale / 100);

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

// Tick or untick the profile's checkbox. The popup sits in a background tab
// throughout, so this calls click() on the element directly rather than
// through page.click(), which waits on layout a background tab does not do.
function tickProfile(popup) {
  return popup.evaluate((id) => {
    const box = document.querySelector(`.profile-checkbox input[value="${id}"]`);
    if (!box) throw new Error(`no checkbox for profile ${id}`);
    box.click();
    return box.checked;
  }, PROFILE_ID);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

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

// What the fixture page looks like right now, in the units a person would
// notice, plus the extension's own stylesheets on the page.
//
// `styling` is the list that matters: an adapter that is switched off can leave
// an empty stylesheet behind, which changes nothing a person can see, so the
// assertions below count the ones that actually carry rules.
function readPage(page) {
  return page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('sample'));
    const sheets = Array.from(document.querySelectorAll('style[id^="ai4a11y-"]'));
    return {
      fontSize: s.fontSize,
      letterSpacing: s.letterSpacing,
      lineHeight: s.lineHeight,
      injectedStyles: sheets.map((el) => el.id),
      styling: sheets.filter((el) => el.textContent.trim() !== '').map((el) => el.id),
    };
  });
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) {
    console.error('No Chrome found. Set CHROME_PATH, or install Google Chrome.');
    console.error(`Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
    process.exit(1);
  }

  const server = await startServer();
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/page.html`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-profile-journey-'));

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir,
    // Puppeteer turns extensions off by default, which would make every
    // assertion below pass for the wrong reason.
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-extension-debugging',
      // The popup tab stays in the background for the whole journey. Without
      // these its renderer is throttled and the clicks below stall.
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

    const readStorage = (keys) =>
      worker.evaluate((k) => new Promise((r) => chrome.storage.sync.get(k, r)), keys);

    // The page a person is looking at when they open the popup.
    const fixture = await browser.newPage();
    fixture.on('pageerror', (e) => console.log(`  [fixture pageerror] ${e.message}`));
    // Pin the operating system's display signals, so the journey reads the
    // same on a machine with dark mode or reduced motion switched on.
    await fixture.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ]);
    await fixture.goto(fixtureUrl, { waitUntil: 'load' });

    // The popup, opened as a tab. It is the same document and the same script
    // the toolbar popup runs. popup.js sends its messages to the active tab of
    // its own window, so the fixture has to be the active tab: everything
    // below clicks in the popup while the fixture is in front.
    const popup = await browser.newPage();
    popup.on('pageerror', (e) => console.log(`  [popup pageerror] ${e.message}`));
    await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
    await popup.waitForSelector(`.profile-checkbox input[value="${PROFILE_ID}"]`, { timeout: 10000 });
    await fixture.bringToFront();

    // The content script runs at document_idle and answers messages once it is
    // listening. Waiting for that answer is what makes the rest deterministic.
    const contentScriptReady = await popup
      .evaluate(
        () =>
          new Promise((resolve) => {
            const deadline = Date.now() + 20000;
            const attempt = () => {
              chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                if (!tab || tab.url.startsWith('chrome-extension://')) {
                  return Date.now() < deadline ? setTimeout(attempt, 250) : resolve(false);
                }
                chrome.tabs.sendMessage(tab.id, { type: 'getToolStates' }, (resp) => {
                  void chrome.runtime.lastError;
                  if (resp?.success) return resolve(true);
                  return Date.now() < deadline ? setTimeout(attempt, 250) : resolve(false);
                });
              });
            };
            attempt();
          })
      );
    check('content script is listening on the fixture page', contentScriptReady === true);

    // ---- Step 1: baseline -------------------------------------------------
    const baseline = await readPage(fixture);
    check(
      'baseline: nothing on the fixture page is styled by the extension',
      baseline.styling.length === 0,
      baseline.styling.join(',')
    );
    check(
      `baseline: sample paragraph is ${BASELINE_FONT_PX}px with normal letter spacing`,
      baseline.fontSize === `${BASELINE_FONT_PX}px` && baseline.letterSpacing === 'normal',
      JSON.stringify(baseline)
    );

    // ---- Step 2: choose the profile in the popup --------------------------
    await tickProfile(popup);
    await sleep(500);

    const afterChoice = await readStorage(['selectedProfiles', 'fontScale', 'letterSpacing', 'lineHeight']);
    check(
      `choosing ${PROFILE_ID} records it in sync storage`,
      Array.isArray(afterChoice.selectedProfiles) &&
        afterChoice.selectedProfiles.length === 1 &&
        afterChoice.selectedProfiles[0] === PROFILE_ID,
      JSON.stringify(afterChoice.selectedProfiles)
    );
    check(
      'the stored settings carry the numbers the preset promises',
      afterChoice.fontScale === PRESET.fontScale &&
        afterChoice.letterSpacing === PRESET.letterSpacing &&
        afterChoice.lineHeight === PRESET.lineHeight,
      JSON.stringify(afterChoice)
    );

    // ---- Step 3: the adaptation reaches the page --------------------------
    // Font scaling is written element by element in idle callbacks, so this
    // waits for the size rather than reading it once.
    const scaledLive = await fixture
      .waitForFunction(
        (px) => getComputedStyle(document.getElementById('sample')).fontSize === px,
        { timeout: 15000 },
        `${SCALED_FONT_PX}px`
      )
      .then(() => true)
      .catch(() => false);
    const applied = await readPage(fixture);
    check(
      `the page's text grows to ${SCALED_FONT_PX}px while the popup is still open`,
      scaledLive,
      JSON.stringify(applied)
    );
    check(
      `letter spacing on the page becomes ${PRESET.letterSpacing}em`,
      parseFloat(applied.letterSpacing).toFixed(2) ===
        (PRESET.letterSpacing * SCALED_FONT_PX).toFixed(2),
      JSON.stringify(applied.letterSpacing)
    );
    check(
      'the extension has put its visual-assist stylesheet on the page',
      applied.injectedStyles.includes('ai4a11y-visual-assist'),
      applied.injectedStyles.join(',')
    );

    // ---- Step 4: reload, and the adaptation is still there -----------------
    await fixture.reload({ waitUntil: 'load' });
    const survivedReload = await fixture
      .waitForFunction(
        (px) => getComputedStyle(document.getElementById('sample')).fontSize === px,
        { timeout: 15000 },
        `${SCALED_FONT_PX}px`
      )
      .then(() => true)
      .catch(() => false);
    const afterReload = await readPage(fixture);
    check(
      'the adaptation comes back by itself after a reload',
      survivedReload,
      JSON.stringify(afterReload)
    );

    // ---- Step 5: withdraw the profile -------------------------------------
    await tickProfile(popup);
    await sleep(500);

    const afterWithdrawal = await readStorage(['selectedProfiles', 'fontScale', 'letterSpacing', 'lineHeight']);
    check(
      'unticking the profile empties selectedProfiles',
      Array.isArray(afterWithdrawal.selectedProfiles) && afterWithdrawal.selectedProfiles.length === 0,
      JSON.stringify(afterWithdrawal.selectedProfiles)
    );

    const revertedLive = await fixture
      .waitForFunction(
        (px) => getComputedStyle(document.getElementById('sample')).fontSize === px,
        { timeout: 15000 },
        `${BASELINE_FONT_PX}px`
      )
      .then(() => true)
      .catch(() => false);
    const reverted = await readPage(fixture);
    check('the page returns to its baseline text size on withdrawal', revertedLive, JSON.stringify(reverted));
    check(
      'letter spacing and line height return to the page\'s own values',
      reverted.letterSpacing === baseline.letterSpacing && reverted.lineHeight === baseline.lineHeight,
      JSON.stringify({ baseline, reverted })
    );
    check(
      'no extension stylesheet is left styling the page',
      reverted.styling.length === 0,
      reverted.styling.join(',')
    );

    // ---- Step 6: reload once more, and the withdrawal holds ----------------
    // Withdrawal that only survives until the next page load is not
    // withdrawal, so this is asserted separately from step 5.
    await fixture.reload({ waitUntil: 'load' });
    await sleep(3000);
    const afterFinalReload = await readPage(fixture);
    check(
      'the baseline holds after reloading a page with no profile chosen',
      afterFinalReload.fontSize === baseline.fontSize &&
        afterFinalReload.letterSpacing === baseline.letterSpacing &&
        afterFinalReload.lineHeight === baseline.lineHeight,
      JSON.stringify({ baseline, afterFinalReload })
    );
    check(
      'no extension stylesheet returns to style the page after the reload',
      afterFinalReload.styling.length === 0,
      `styling: ${afterFinalReload.styling.join(',')} / present: ${afterFinalReload.injectedStyles.join(',')}`
    );
  } finally {
    await browser.close().catch(() => {});
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('Failed:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
