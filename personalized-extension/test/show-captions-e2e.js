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

// Chrome discovery, the fixture server, and the extension launch are shared
// with the other journeys in scripts/e2e-chrome.js.
const path = require('path');
const {
  findChrome, startFixtureServer, launchWithExtension, makeChecks, sleep, waitFor,
} = require('../../scripts/e2e-chrome.js');

const { check, finish } = makeChecks();

const EXT_PATH = path.resolve(__dirname, '..', 'extension');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'show-captions');

// The mode of the fixture's only caption track, plus the adapter's own marker
// on the video, read from the page itself.
function readTrack(page) {
  return page.evaluate(() => {
    const v = document.getElementById('clip');
    const t = v.textTracks && v.textTracks[0];
    return { mode: t ? t.mode : 'no-track', marked: v.dataset.ai4a11yCaptions || null };
  });
}

// Poll the page until `ready` holds, since the content script applies stored
// settings after load.
const waitForTrack = (page, ready) => waitFor(() => readTrack(page), ready);

async function main() {
  const chrome = findChrome();
  const server = await startFixtureServer(FIXTURE_DIR);
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/page.html`;

  const session = await launchWithExtension({ chrome, extPath: EXT_PATH, profilePrefix: 'aa-pe-captions-' });
  const { browser, worker } = session;

  try {

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
    await session.close();
    server.close();
  }

  process.exitCode = finish() ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
