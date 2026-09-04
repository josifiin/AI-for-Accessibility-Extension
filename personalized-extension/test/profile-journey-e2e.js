// Release journey for the personalized extension.
//
// The journey a person walks: finish onboarding, tick an access need in the
// popup, watch the page change, reload and find the change still there and the
// saved profile still there, untick the need, and find the page back the way it
// started. The page assertions read the fixture's own computed style rather
// than the extension's internal state, because the page is what the person
// actually gets.
//
// Onboarding is seeded, not clicked through: onboarding.js's saveAndFinish
// sends saveUserProfile, two librarianSetProfileField calls, and a
// chrome.storage.sync write, and this sends the same four things from an
// extension page. demo-beats-e2e.js already drives the onboarding wizard
// itself, so repeating it here would only slow the journey down.
//
// The access need is "Bigger text & spacing" (`biggerText` in
// extension/popup/popup.js), whose preset is text size, line height, letter
// spacing, a large cursor and stronger focus rings. None of that calls a model,
// so this journey runs with no credentials present.
//
// Chrome comes from CHROME_PATH or the usual install locations, and the
// extension is loaded over the DevTools Protocol rather than with
// --load-extension, which Chrome no longer honors. This is the same approach
// scripts/check-extensions-load-in-chrome.mjs takes.
//
//   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node personalized-extension/test/profile-journey-e2e.js
//
// Needs a local Chrome, so CI skips it.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const EXT_PATH = path.resolve(__dirname, '..', 'extension');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'profile');

// The access need under test, by the value its checkbox carries in
// extension/popup/popup.html.
const NEED_ID = 'biggerText';

// What onboarding would have saved. Support areas and free text are the two
// fields onboarding collects and hands to the Librarian.
const ONBOARDING = {
  supportAreas: ['vision'],
  freeText: 'small text is hard to read',
};

const BASELINE_FONT_PX = 16; // set by the fixture's own stylesheet

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

// Poll sync storage until `ready` holds, or give up and hand back the last
// value read so the check that follows prints what it actually saw. The popup
// writes storage asynchronously after a click returns, so a read at a fixed
// delay races those writes.
async function waitForStorage(readStorage, keys, ready, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await readStorage(keys);
    if (ready(last)) return last;
    await sleep(100);
  } while (Date.now() < deadline);
  return last;
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

// Tick or untick the access need's checkbox. The popup sits in a background tab
// for the whole journey, so this calls click() on the element directly rather
// than through page.click(), which waits on layout a background tab does not do.
function tickNeed(popup) {
  return popup.evaluate((id) => {
    const box = document.querySelector(`#profilesSection .profile-checkbox input[value="${id}"]`);
    if (!box) throw new Error(`no checkbox for access need ${id}`);
    box.click();
    return box.checked;
  }, NEED_ID);
}

// Ask the background for whatever it has stored, from an extension page, the
// way onboarding and the popup do.
function ask(driver, message) {
  return driver.evaluate(
    (m) =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(m, (resp) => {
          void chrome.runtime.lastError;
          resolve(resp ?? null);
        });
      }),
    message
  );
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-pe-journey-'));

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
      // The popup and driver tabs stay in the background for the whole
      // journey. Without these their renderers are throttled and the clicks
      // below stall.
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

    // An extension page to send background messages from. Service-worker code
    // cannot message itself, and onboarding sends these from a page.
    const driver = await browser.newPage();
    driver.on('pageerror', (e) => console.log(`  [driver pageerror] ${e.message}`));
    await driver.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`, { waitUntil: 'load' });

    // ---- Step 1: onboarding, seeded the way saveAndFinish writes it --------
    await ask(driver, {
      type: 'saveUserProfile',
      profile: { ...ONBOARDING, createdAt: new Date().toISOString() },
    });
    await ask(driver, {
      type: 'librarianSetProfileField',
      path: 'supportAreas',
      value: ONBOARDING.supportAreas,
    });
    await ask(driver, {
      type: 'librarianSetProfileField',
      path: 'freeText',
      value: ONBOARDING.freeText,
    });
    await driver.evaluate(
      () => new Promise((r) => chrome.storage.sync.set({ enabled: true, onboardingComplete: true }, r))
    );

    const seeded = await readStorage(['onboardingComplete']);
    check('onboarding is recorded as complete', seeded.onboardingComplete === true, JSON.stringify(seeded));

    // ---- Step 2: the page before anything is switched on -------------------
    const fixture = await browser.newPage();
    fixture.on('pageerror', (e) => console.log(`  [fixture pageerror] ${e.message}`));
    // The personalized extension turns adapters on from the operating system's
    // own signals, so pin them here. Without this the journey's result depends
    // on whether the person running it has dark mode on.
    await fixture.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ]);
    await fixture.goto(fixtureUrl, { waitUntil: 'load' });

    // The popup, opened as a tab. It is the same document and the same script
    // the toolbar popup runs. popup.js sends its messages to the active tab of
    // its own window, so the fixture has to be the active tab: everything below
    // clicks in the popup while the fixture is in front.
    const popup = await browser.newPage();
    popup.on('pageerror', (e) => console.log(`  [popup pageerror] ${e.message}`));
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'load' });
    await popup.waitForSelector(`#profilesSection .profile-checkbox input[value="${NEED_ID}"]`, {
      timeout: 10000,
    });
    await fixture.bringToFront();

    // The content script runs at document_idle and answers messages once it is
    // listening. Waiting for that answer is what makes the rest deterministic.
    // A tab whose URL the extension cannot see (no host access, or a page still
    // navigating) is retried rather than dereferenced, so a slow start ends in
    // a FAIL line instead of a promise that never settles.
    const waitForContentScript = () =>
      popup.evaluate(
        () =>
          new Promise((resolve) => {
            const deadline = Date.now() + 20000;
            const attempt = () => {
              chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                if (!tab || !tab.url || tab.url.startsWith('chrome-extension://')) {
                  return Date.now() < deadline ? setTimeout(attempt, 250) : resolve(false);
                }
                chrome.tabs.sendMessage(tab.id, { type: 'getToolStates' }, (resp) => {
                  void chrome.runtime.lastError;
                  if (resp?.states) return resolve(true);
                  return Date.now() < deadline ? setTimeout(attempt, 250) : resolve(false);
                });
              });
            };
            attempt();
          })
      );
    const contentScriptReady = await waitForContentScript();
    check('content script is listening on the fixture page', contentScriptReady === true);

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

    // ---- Step 3: switch the access need on --------------------------------
    await tickNeed(popup);
    const activated = await waitForStorage(
      readStorage,
      ['selectedProfiles', 'fontScale', 'letterSpacing', 'lineHeight'],
      (s) => Array.isArray(s.selectedProfiles) && s.selectedProfiles.includes(NEED_ID) && typeof s.fontScale === 'number' && s.fontScale > 100
    );
    check(
      `switching on ${NEED_ID} records it in sync storage`,
      Array.isArray(activated.selectedProfiles) &&
        activated.selectedProfiles.length === 1 &&
        activated.selectedProfiles[0] === NEED_ID,
      JSON.stringify(activated.selectedProfiles)
    );
    check(
      'the stored text size is larger than the page default',
      typeof activated.fontScale === 'number' && activated.fontScale > 100,
      JSON.stringify(activated)
    );

    // The size the preset promises, derived from what the popup actually stored
    // rather than typed in here, so a preset change moves this with it.
    const scaledFontPx = BASELINE_FONT_PX * (activated.fontScale / 100);

    const grewLive = await fixture
      .waitForFunction(
        (px) => getComputedStyle(document.getElementById('sample')).fontSize === px,
        { timeout: 15000 },
        `${scaledFontPx}px`
      )
      .then(() => true)
      .catch(() => false);
    const applied = await readPage(fixture);
    check(
      `the page's text grows to ${scaledFontPx}px while the popup is still open`,
      grewLive,
      JSON.stringify(applied)
    );
    check(
      `letter spacing on the page becomes ${activated.letterSpacing}em`,
      parseFloat(applied.letterSpacing).toFixed(2) ===
        (activated.letterSpacing * scaledFontPx).toFixed(2),
      JSON.stringify({ stored: activated.letterSpacing, onPage: applied.letterSpacing })
    );
    check(
      'the extension has put its visual-assist stylesheet on the page',
      applied.injectedStyles.includes('ai4a11y-visual-assist'),
      applied.injectedStyles.join(',')
    );

    // ---- Step 4: reload; the adaptation and the saved profile both hold ----
    await fixture.reload({ waitUntil: 'load' });
    const survivedReload = await fixture
      .waitForFunction(
        (px) => getComputedStyle(document.getElementById('sample')).fontSize === px,
        { timeout: 15000 },
        `${scaledFontPx}px`
      )
      .then(() => true)
      .catch(() => false);
    check(
      'the adaptation comes back by itself after a reload',
      survivedReload,
      JSON.stringify(await readPage(fixture))
    );

    const storedProfile = await ask(driver, { type: 'getUserProfile' });
    check(
      'the saved profile round-trips: support areas come back as onboarding wrote them',
      JSON.stringify(storedProfile?.profile?.supportAreas) === JSON.stringify(ONBOARDING.supportAreas),
      JSON.stringify(storedProfile?.profile)
    );
    check(
      'the saved profile round-trips: the free text comes back unchanged',
      storedProfile?.profile?.freeText === ONBOARDING.freeText,
      JSON.stringify(storedProfile?.profile?.freeText)
    );

    const librarianProfile = await ask(driver, { type: 'librarianGetProfile' });
    check(
      'the Librarian holds the same support areas',
      Array.isArray(librarianProfile?.profile?.supportAreas) &&
        ONBOARDING.supportAreas.every((a) => librarianProfile.profile.supportAreas.includes(a)),
      JSON.stringify(librarianProfile?.profile?.supportAreas)
    );

    // ---- Step 5: withdraw the access need ---------------------------------
    await tickNeed(popup);
    const withdrawn = await waitForStorage(
      readStorage,
      ['selectedProfiles', 'fontScale', 'letterSpacing'],
      (s) => Array.isArray(s.selectedProfiles) && s.selectedProfiles.length === 0 && !(s.fontScale > 100)
    );
    check(
      'unticking the access need empties selectedProfiles',
      Array.isArray(withdrawn.selectedProfiles) && withdrawn.selectedProfiles.length === 0,
      JSON.stringify(withdrawn.selectedProfiles)
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
      "letter spacing and line height return to the page's own values",
      reverted.letterSpacing === baseline.letterSpacing && reverted.lineHeight === baseline.lineHeight,
      JSON.stringify({ baseline, reverted })
    );
    check(
      'no extension stylesheet is left styling the page',
      reverted.styling.length === 0,
      reverted.styling.join(',')
    );

    // ---- Step 6: reload once more; the withdrawal holds, the profile stays --
    // Withdrawal that only survives until the next page load is not
    // withdrawal, so this is asserted separately from step 5. The person's
    // saved profile is a different thing from the adaptation, and withdrawing
    // one access need must not throw it away.
    // This is a negative check (nothing should change), so there is no style
    // to wait for. Wait for the content script to be listening again, then
    // give it the same settling time a person would before reading the page.
    await fixture.reload({ waitUntil: 'load' });
    check('content script is listening again after the final reload', (await waitForContentScript()) === true);
    await sleep(3000);
    const afterFinalReload = await readPage(fixture);
    check(
      'the baseline holds after reloading a page with no access need switched on',
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

    const profileAfterWithdrawal = await ask(driver, { type: 'getUserProfile' });
    check(
      'withdrawing the access need leaves the saved profile alone',
      profileAfterWithdrawal?.profile?.freeText === ONBOARDING.freeText,
      JSON.stringify(profileAfterWithdrawal?.profile)
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
