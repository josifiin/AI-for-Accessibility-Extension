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
// --load-extension, which Chrome no longer honors. This is the same approach
// scripts/check-extensions-load-in-chrome.mjs takes.
//
//   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node extension/test/profile-journey-e2e.js
//
// Needs a local Chrome, so CI skips it.

const fs = require('fs');
// Chrome discovery, the fixture server, and the extension launch are shared
// with the other journeys in scripts/e2e-chrome.js.
const path = require('path');
const {
  findChrome, startFixtureServer, launchWithExtension, makeChecks, sleep, waitFor, waitForStorage,
} = require('../../scripts/e2e-chrome.js');

const { check, finish } = makeChecks();

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXT_PATH = path.join(REPO_ROOT, 'extension');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'profile');

// The profile under test and the numbers its preset promises. Read from the
// shared module rather than typed in, so a preset change fails here loudly
// instead of leaving the journey asserting a stale number.
const PROFILE_ID = 'lowVision';
const PRESET = JSON.parse(
  fs.readFileSync(require.resolve('@ai4a11y/tools/profiles/settings.json'), 'utf8')
).profiles[PROFILE_ID].tools;

const BASELINE_FONT_PX = 16; // set by the fixture's own stylesheet
const SCALED_FONT_PX = BASELINE_FONT_PX * (PRESET.fontScale / 100);

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
  const chrome = findChrome();
  const server = await startFixtureServer(FIXTURE_DIR);
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/page.html`;

  const session = await launchWithExtension({ chrome, extPath: EXT_PATH, profilePrefix: 'aa-profile-journey-' });
  const { browser, extId, worker, readStorage } = session;

  try {

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
                  if (resp?.success) return resolve(true);
                  return Date.now() < deadline ? setTimeout(attempt, 250) : resolve(false);
                });
              });
            };
            attempt();
          })
      );
    const contentScriptReady = await waitForContentScript();
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
    const afterChoice = await waitForStorage(
      readStorage,
      ['selectedProfiles', 'fontScale', 'letterSpacing', 'lineHeight'],
      (s) => Array.isArray(s.selectedProfiles) && s.selectedProfiles.includes(PROFILE_ID) && s.fontScale === PRESET.fontScale
    );
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
    const afterWithdrawal = await waitForStorage(
      readStorage,
      ['selectedProfiles', 'fontScale', 'letterSpacing', 'lineHeight'],
      (s) => Array.isArray(s.selectedProfiles) && s.selectedProfiles.length === 0 && s.fontScale !== PRESET.fontScale
    );
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
    // This is a negative check (nothing should change), so there is no style
    // to wait for. Wait for the content script to be listening again, then
    // give it the same settling time a person would before reading the page.
    await fixture.reload({ waitUntil: 'load' });
    check('content script is listening again after the final reload', (await waitForContentScript()) === true);
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
    await session.close();
    server.close();
  }

  process.exitCode = finish() ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
