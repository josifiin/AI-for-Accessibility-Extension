# Troubleshooting

Common issues and solutions for the two extensions in this repository.

Both extensions load unpacked from what is committed here, so most fixes below
are a reload rather than a rebuild. Rebuilding happens in the toolkit
repository, where the code the bundles are built from is canonical. See
"Rebuilding" at the end.

## Chrome Extension

### Extension not loading

**Symptoms:** Extension doesn't appear in Chrome toolbar or content script doesn't run.

**Solutions:**
1. Verify extension is enabled at `chrome://extensions`
2. Check for manifest errors in the extension card
3. Confirm you loaded the right folder: `extension/` for the original
   extension, `personalized-extension/extension/` for the personalized one
4. Reload the extension, then reload the page you are testing on
5. If Chrome reports a missing file, run `npm run check:loadable` from the
   repository root. It resolves every file the two manifests and service
   workers reference, and names any that a checkout does not contain

### AI features not working

**Symptoms:** Alt text not generated, text not simplified, "API key not set" errors.

**Solutions:**
1. Open extension popup → Settings
2. Verify Gemini API key is entered correctly
3. Test the key at [Google AI Studio](https://aistudio.google.com/apikey)
4. Check browser console for API errors (F12 → Console)

**Rate limits:** Free tier allows 15 requests/minute, 1500/day. For heavier use, enable billing in [Google Cloud Console](https://console.cloud.google.com/).

### Visual settings not applying

**Symptoms:** Font size, dark mode, or other visual settings don't change the page.

**Solutions:**
1. Check if the site uses `!important` CSS (may override our styles)
2. Try a different site to isolate the issue
3. Open DevTools → Check for `ai4a11y-*` style tags in `<head>`
4. Some sites (Google Docs, Figma) run in iframes that block content scripts

### Content script errors

**Symptoms:** Red errors in browser console mentioning `content.bundle.js`.

**Solutions:**
1. Reload the extension, then refresh the page
2. Check the page is not one Chrome blocks content scripts on
   (`chrome://` pages, the Chrome Web Store)
3. `extension/content.bundle.js` is a committed build output. If the bundle
   itself is at fault, the source it is built from is in the toolkit
   repository; see "Rebuilding"

## CLI

The `ai4a11y` command line tool is not part of this repository. It is
canonical in the [toolkit
repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit),
along with the auditors and adapters it drives.

## Voice/Text Control Web Apps

### Backend won't start

**Symptoms:** `uvicorn` fails or "module not found" errors.

**Solutions:**
```bash
cd webapp/voicecontrol/backend  # or textcontrol/backend
cp .env.example .env
# Edit .env with your Gemini API key

# Voice control
uv run python main.py

# Text control
uv run uvicorn main:app --host 0.0.0.0 --port 8080
```

### Chrome not connecting

**Symptoms:** "CDP not reachable" or "browser-harness daemon not available".

**Solutions:**
1. Launch Chrome with remote debugging:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222 \
     --user-data-dir=/tmp/chrome-debug
   ```
2. Verify Chrome is listening: `curl http://localhost:9222/json/version`
3. Check no other process uses port 9222

### Voice not working

**Symptoms:** Mic button doesn't respond or no audio playback.

**Solutions:**
1. Allow microphone access when prompted
2. Check browser permissions: `chrome://settings/content/microphone`
3. Verify mic works in another app
4. Check WebSocket connection status in the UI

### WebSocket disconnects

**Symptoms:** Frequent "connecting..." status or dropped sessions.

**Solutions:**
1. Check backend logs for errors
2. Ensure stable network connection
3. Voice control uses Gemini Live API which requires real-time streaming

## Personalized Extension

### Onboarding flow issues

**Symptoms:** Onboarding doesn't start or recommendations don't appear.

**Solutions:**
1. Clear extension storage: DevTools → Application → Storage → Clear
2. Reload the extension at `chrome://extensions`, then start onboarding again
3. Check for Gemini API key in the onboarding flow

### Custom skills not running

**Symptoms:** Saved skills don't apply to pages.

**Solutions:**
1. Chrome 120+ required for userScripts API
2. Enable Developer Mode at `chrome://extensions`
3. Check skill is enabled in extension popup
4. View skill errors in DevTools console

### Skill builder lint errors

**Symptoms:** "Code didn't look safe to run" during skill creation.

**Solutions:**
1. Skills cannot use `eval`, `fetch`, `import`, `document.write`
2. For AI-powered skills, choose "With AI" option (uses `chrome.runtime.sendMessage`)
3. Review the generated code in the code viewer

## Rebuilding

There is no build step in this repository. The bundles both extensions run
are committed, and the code they are built from (`tools/`, `toolkit/`) is
canonical in the [toolkit
repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit).
A change to an auditor, adapter, profile or the toolkit core is made there,
and the refreshed bundles arrive here as a commit.

Making this repository buildable on its own means consuming the toolkit core
as a dependency instead of reading a sibling checkout. That work is planned
and tracked as issue #2.

### Checking a checkout is complete

```bash
npm run check:loadable   # no install, no browser
npm run check:chrome     # needs Chrome and `npm ci`
```

The first resolves every file the two manifests and service workers
reference. The second loads both extensions in a real Chrome and checks each
one starts. Use them after pulling, and before reporting that an extension
will not load.

### `npm test` fails

**Solutions:**
1. Check Node version: `node --version` (requires Node 20.19+)
2. `npm test` runs the Librarian regression suite and needs no install. If it
   fails on a fresh checkout, that is a real regression worth reporting

## Getting Help

If your issue isn't listed:

1. Search this repository's issues for extension problems, and the [toolkit
   repository's](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/issues)
   for anything in the auditors, adapters, profiles or the toolkit core
2. Open a new issue with:
   - Browser/OS version
   - Steps to reproduce
   - Console errors (F12 → Console)
   - Extension version
3. Ping [@chuanenlin](https://github.com/chuanenlin) (David)
