(() => {
  // extension/browser-harness/src/agent/constants.js
  var BH_AGENT_KEY = "bhAgent";
  var BH_AGENT_LOG_LIMIT = 200;
  var BH_AGENT_HISTORY_CHAR_THRESHOLD = 3e4;
  var BH_AGENT_HISTORY_KEEP_TAIL = 3;
  var BH_AGENT_EXTRACTED_INLINE_MAX = 1500;
  var BH_AGENT_LOADED_SKILLS_MAX = 5;
  var BH_AGENT_SKILL_INLINE_MAX = 8e3;
  var BH_AGENT_ACTION_TIMEOUT_MS = 18e4;
  var BH_AGENT_GROUP_COLORS = ["blue", "red", "yellow", "green"];
  var BH_AGENT_COLOR_KEY = "bhAgentNextColor";
  var _BH_AGENT_TERMINATES_SEQUENCE = /* @__PURE__ */ new Set([
    "navigate",
    "go_back",
    "go_forward",
    "refresh",
    "open_tab",
    "switch_tab",
    "close_tab",
    "done"
  ]);
  var BH_AGENT_SYSTEM_PROMPT_BASE = `You are a browser agent. You see a screenshot of a web page and decide what action to take next.

Every response is ONE JSON object. Two shapes are accepted:

(A) Single action (default for a single intent):
{
  "evaluation_previous_goal": "what happened on the last step -- did the previous action work? empty on the first turn.",
  "memory": "everything you want to carry forward: task constraints, user-supplied data, what you've extracted, what's left to do, errors. Reuse and extend the prior memory; don't drop facts.",
  "next_goal": "the single concrete thing you're about to do",
  "action": "<action name>", "reason": "...",
  ...action-specific fields...
}

(B) Multi-action (preferred for form-filling and short safe sequences):
{
  "evaluation_previous_goal": "...",
  "memory": "...",
  "next_goal": "Fill the sign-in form and submit",
  "actions": [
    {"action": "type_index", "index": 5, "text": "user@example.com", "reason": "email"},
    {"action": "type_index", "index": 6, "text": "secret", "reason": "password"},
    {"action": "click_index", "index": 7, "reason": "submit"}
  ]
}
Use multi-action whenever you can predict the next 2-5 actions confidently (e.g. typing into multiple form fields in a known order, then clicking submit). Page-changing actions (navigate / go_back / refresh / switch_tab / open_tab / close_tab / done) terminate the sequence -- put them LAST. If a sub-action's URL change or active-tab change is detected mid-batch, the harness aborts the rest and you'll get a fresh state next turn. Keep batches short and safe; one bad guess wastes the whole batch.

Action shapes:

{"action": "click_index", "index": 12, "reason": "clicking the search bar by its index"}
{"action": "click", "x": 340, "y": 200, "reason": "clicking a spot with no index (canvas, chart, image map)"}
{"action": "type_index", "index": 5, "text": "hello world", "reason": "typing into the field at index 5 (focuses, clears, types, fires input/change for framework reactivity)"}
{"action": "type_index", "index": 5, "text": "hello", "clear": false, "reason": "appending without clearing existing value"}
{"action": "type", "text": "hello world", "reason": "typing into whatever element currently has focus (no index)"}
{"action": "fill_input", "selector": "input[name=email]", "text": "user@example.com", "reason": "selector-based fill -- prefer type_index when the field has an index"}
{"action": "dropdown_options", "index": 8, "reason": "reading the available options of a <select> or aria listbox"}
{"action": "select_dropdown", "index": 8, "text": "California", "reason": "picking an option by visible text in a native <select> or aria listbox"}
{"action": "upload_file", "index": 14, "file": "/path/to/local.pdf", "reason": "attaching a file to a <input type=file>"}
{"action": "go_back", "reason": "history.back() \u2014 return to the previous page"}
{"action": "go_forward", "reason": "history.forward()"}
{"action": "refresh", "reason": "reload the current page"}
{"action": "refresh", "hard": true, "reason": "reload bypassing cache"}
{"action": "press_key", "key": "Enter", "reason": "submitting the form"}
{"action": "scroll", "x": 600, "y": 400, "dy": -300, "reason": "scrolling down to see more"}
{"action": "navigate", "url": "https://example.com", "reason": "going to the target page"}
{"action": "navigate", "url": "https://amazon.com/cart", "read_skills": ["cart"], "reason": "going to the cart and pre-loading the cart playbook in one step"}
{"action": "wait", "seconds": 2, "reason": "waiting for page to load"}
{"action": "wait_for_element", "selector": "#submit-btn", "visible": true, "reason": "SPA route just changed -- waiting for the submit button to render"}
{"action": "wait_for_network_idle", "reason": "form just submitted, waiting for XHR to settle"}
{"action": "handle_dialog", "accept": true, "reason": "page popped a confirm() -- clicking OK"}
{"action": "js", "code": "document.title", "reason": "checking what page we're on"}
{"action": "js", "code": "Array.from(document.querySelectorAll('h2.product-title')).map(h => h.textContent.trim())", "reason": "extracting the product titles for memory"}
{"action": "open_tab", "url": "https://example.com", "read_skills": ["scraping"], "reason": "opening a second tab and pre-loading its scraping playbook"}
{"action": "switch_tab", "tab": 1, "reason": "going back to the first tab to copy the value"}
{"action": "close_tab", "tab": 2, "reason": "no longer need the comparison tab"}
{"action": "read_skill", "kind": "domain", "name": "cart", "host": "amazon", "reason": "loading the playbook for the current site"}
{"action": "read_skill", "kind": "interaction", "name": "dialogs", "reason": "loading the generic dialogs guide"}
{"action": "write_skill", "kind": "domain", "name": "checkout-trick", "host": "etsy", "content": "# Etsy checkout\\nThe Pay button is keyboard-only; ...", "reason": "saving what I learned for next time"}
{"action": "done", "summary": "task complete -- here's what I found: ..."}

Rules:
- Always respond with a single JSON object, nothing else. Include evaluation_previous_goal, memory, next_goal on every turn.
- "memory" is your long-running scratchpad. The previous turn's memory is shown above as "Current memory"; treat it as your starting point and rewrite a complete, updated version each turn. Don't drop facts unless they're truly stale.
- Use "reason" to explain your thinking for this single action.
- After clicking or typing, you'll get a new screenshot to verify.
- If you see a login wall, respond with {"action": "done", "summary": "Hit a login wall -- need to sign in first."}
- The current page's interactive elements are listed under "Interactive elements" in the prompt as a tab-indented tree where each clickable element is \`[index]<tag attrs />\`. Indentation shows DOM containment. An element's visible text appears as an indented child line directly below its tag. Lines without an \`[index]\` are non-clickable structural containers (\`<form />\`, \`<ul />\`, \`<table />\`, \`<nav />\`, etc.) that group their children together \u2014 use them only as grouping cues to disambiguate "which form is this input in"; do NOT pass them to click_index. Example:
    <form />
    	[35]<input type=text placeholder="Enter name" />
    	*[38]<button aria-label="Submit form" />
    		Submit
    [40]<a />
    	About us
- The same indexes are drawn as numbered badges on the screenshot. The textual list is your source of truth for which indexes exist and what each element is; the screenshot lets you reason about layout and verify after actions.
- Only interact with elements that have a numeric [index] assigned in the list. Only use indexes that are explicitly provided this turn \u2014 don't reuse indexes from previous turns; they are recomputed every step from the current page.
- Prefix markers in the list:
    - \`*[index]\` \u2014 element appeared since the previous step (e.g. autocomplete suggestion, dropdown, modal). Often what you want to interact with next.
    - \`|SCROLL|\` \u2014 scrollable container. You can scroll inside it with the scroll action targeting a point inside the box.
    - \`|SHADOW(open)|\` / \`|SHADOW(closed)|\` \u2014 element lives inside a shadow root. click_index works on these directly; do NOT try to use querySelector / js() to reach them.
- Prefer click_index over coordinate "click" -- the harness resolves indexes to the element's exact DOM-derived center, while LLM coordinates from vision are typically 10-30 px off. Use coordinate "click" only when the target has no index in the list (e.g. clicking a specific point on a canvas / chart / map / image).
- Only elements in the current viewport are listed. If you don't see what you need, scroll first; the next turn will list the new viewport's elements.
- For autocomplete / combobox / search-with-suggestions fields: type into the field, then WAIT one turn for suggestions to render (they will show up as \`*[index]\` markers). Click the right suggestion by its index \u2014 don't press Enter unless no suggestions appeared.
- For form fields: prefer type_index over (click_index + type) -- it focuses, clears, types, and fires input/change events for React/Vue reactivity in a single action. Use type (no index) only when the field already has focus.
- For native <select> or role=listbox/combobox dropdowns: do NOT click_index a <select> (it opens a native picker the agent cannot interact with). Use dropdown_options(index) to read the options first, then select_dropdown(index, text) to pick one. The harness fires input/change/blur so framework-bound forms update.
- For file uploads: do NOT click_index an <input type=file> (it opens an OS file chooser the agent cannot interact with). Use upload_file(index, file) with a path string the browser can read.
- click_index will refuse to click <select> / <input type=file> / print buttons and tell you which action to use instead. Trust the hint.
- click_index errors: "stale_index" / "stale_element" mean the page changed since the index list was built. Just look at the new screenshot and list, pick a fresh index, retry.
- Coordinates and scroll deltas are pixel positions on the screenshot you see (top-left origin, x right, y down). Read them directly off the image; the harness handles the conversion to CSS pixels.
- "tab" indices match the "Tabs" list in each turn. You only see and control tabs you opened in this run; the user's other tabs are not accessible.
- Domain skills are surfaced once, in the turn AFTER you navigate/open_tab to a host. Either read them via read_skill or pre-load with navigate's read_skills field. Save what you learn with write_skill so future runs benefit.
- Prefer fill_input over type for any form field on a real site -- type uses Input.insertText which bypasses React/Vue change tracking and leaves submit buttons disabled.
- After submits or SPA route changes, wait_for_element or wait_for_network_idle before the next action; document.readyState is "complete" before the framework finishes rendering.
- If the screenshot or pageInfo shows {"dialog": ...}, the page's JS thread is frozen -- handle_dialog before doing anything else.
- Use "js" to extract structured data (titles, lists, attributes, JSON from the page). The return value is recorded in the history and visible to you on the next turn -- preferable to remembering it in "memory" by hand for anything large.`;

  // extension/browser-harness/src/agent/state.js
  var _bhAgentSystemPrompt = BH_AGENT_SYSTEM_PROMPT_BASE;
  function setSystemPrompt(s) {
    _bhAgentSystemPrompt = s;
  }
  function getSystemPrompt() {
    return _bhAgentSystemPrompt;
  }
  var _bhAgentNavSurface = null;
  function setNavSurface(s) {
    _bhAgentNavSurface = s;
  }
  function getNavSurface() {
    return _bhAgentNavSurface;
  }
  var _bhAgentLoadedSkills = [];
  function setLoadedSkills(arr) {
    _bhAgentLoadedSkills = arr;
  }
  function getLoadedSkills() {
    return _bhAgentLoadedSkills;
  }
  function pushLoadedSkill(s) {
    _bhAgentLoadedSkills.push(s);
  }
  function shiftLoadedSkill() {
    _bhAgentLoadedSkills.shift();
  }
  var _bhGeminiCall = null;
  function setGeminiCaller(fn) {
    _bhGeminiCall = fn;
  }
  function getGeminiCaller() {
    return _bhGeminiCall;
  }
  var _bhAgentStop = false;
  function setStop(v) {
    _bhAgentStop = !!v;
  }
  function shouldStop() {
    return _bhAgentStop;
  }
  var _bhAgentRunning = false;
  function setRunning(v) {
    _bhAgentRunning = !!v;
  }
  function isRunning() {
    return _bhAgentRunning;
  }
  var _bhAgentTabId = null;
  function setTabId(id) {
    _bhAgentTabId = id;
  }
  function getTabId() {
    return _bhAgentTabId;
  }
  var _bhAgentOwnedTabs = /* @__PURE__ */ new Set();
  var _bhAgentGroupId = null;
  function setGroupId(id) {
    _bhAgentGroupId = id;
  }
  function getGroupId() {
    return _bhAgentGroupId;
  }
  var _bhAgentCreatingTab = false;
  function setCreatingTab(v) {
    _bhAgentCreatingTab = !!v;
  }
  function isCreatingTab() {
    return _bhAgentCreatingTab;
  }
  var _bhAgentSwallow = /* @__PURE__ */ new Set();
  var _bhAgentCurrentMemory = "";
  function setCurrentMemory(s) {
    _bhAgentCurrentMemory = s;
  }
  function getCurrentMemory() {
    return _bhAgentCurrentMemory;
  }
  var _bhAgentImageScale = 1;
  var _bhAgentImageWidth = 0;
  var _bhAgentImageHeight = 0;
  function setImage(scale, w, h) {
    _bhAgentImageScale = scale;
    _bhAgentImageWidth = w;
    _bhAgentImageHeight = h;
  }
  function getImageScale() {
    return _bhAgentImageScale;
  }
  var _bhAgentLastInteractiveHashes = /* @__PURE__ */ new Set();
  function setLastInteractiveHashes(s) {
    _bhAgentLastInteractiveHashes = s;
  }
  function getLastInteractiveHashes() {
    return _bhAgentLastInteractiveHashes;
  }
  async function _bhAgentRead() {
    const cur = await chrome.storage.local.get(BH_AGENT_KEY);
    return cur[BH_AGENT_KEY] || { task: "", status: "idle", log: [] };
  }
  async function _bhAgentWrite(state) {
    await chrome.storage.local.set({ [BH_AGENT_KEY]: state });
  }
  async function _bhAgentPatch(patch) {
    const state = await _bhAgentRead();
    Object.assign(state, patch);
    await _bhAgentWrite(state);
  }
  async function _bhAgentLog(entry) {
    const state = await _bhAgentRead();
    state.log = (state.log || []).concat({ t: Date.now(), ...entry }).slice(-BH_AGENT_LOG_LIMIT);
    await _bhAgentWrite(state);
  }
  function _bhAgentTruncate(s, n = 220) {
    s = (s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
  }
  function _bhAgentResolveTabIdx(idx) {
    const ordered = [..._bhAgentOwnedTabs];
    if (typeof idx !== "number" || idx < 0 || idx >= ordered.length) return null;
    return ordered[idx];
  }
  async function _bhAgentTabsContext() {
    const tabs = [];
    let activeIdx = -1;
    for (const id of _bhAgentOwnedTabs) {
      try {
        const t = await chrome.tabs.get(id);
        const idx = tabs.length;
        if (id === _bhAgentTabId) activeIdx = idx;
        tabs.push({ idx, tabId: id, title: t.title || "", url: t.url || "" });
      } catch {
        _bhAgentOwnedTabs.delete(id);
      }
    }
    return { tabs, activeIdx };
  }
  function resetRunState() {
    _bhAgentRunning = false;
    _bhAgentTabId = null;
    _bhAgentOwnedTabs.clear();
    _bhAgentGroupId = null;
    _bhAgentSwallow.clear();
    _bhAgentLoadedSkills = [];
    _bhAgentNavSurface = null;
    _bhAgentCurrentMemory = "";
    _bhAgentImageScale = 1;
    _bhAgentImageWidth = 0;
    _bhAgentImageHeight = 0;
    _bhAgentLastInteractiveHashes = /* @__PURE__ */ new Set();
    _bhAgentSystemPrompt = BH_AGENT_SYSTEM_PROMPT_BASE;
  }

  // extension/browser-harness/src/agent/prompt.js
  async function _bhBuildSystemPrompt() {
    const Skills = globalThis.BrowserSkills;
    if (!Skills) return BH_AGENT_SYSTEM_PROMPT_BASE;
    const interaction = await Skills.listInteraction().catch(() => []);
    if (!interaction.length) return BH_AGENT_SYSTEM_PROMPT_BASE;
    return BH_AGENT_SYSTEM_PROMPT_BASE + '\n\nInteraction skills available (load any with read_skill kind="interaction"): ' + interaction.join(", ") + ".";
  }
  function _bhAgentHostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }
  async function _bhAgentConsumeNavSurface() {
    const surface = getNavSurface();
    setNavSurface(null);
    if (!surface) return "";
    if (!surface.skills || !surface.skills.length) {
      return `Just navigated to ${surface.host}. No domain skills indexed for this host.`;
    }
    return `Just navigated to ${surface.host}. Domain skills available (load with read_skill kind="domain", host="${surface.host}"): ${surface.skills.join(", ")}.`;
  }
  function _bhAgentLoadedSkillsBlock() {
    const loaded = getLoadedSkills();
    if (!loaded.length) return "";
    const lines = ["### Loaded skill content"];
    for (const s of loaded) {
      const tag = s.kind === "domain" ? `domain/${s.host}/${s.name}` : `interaction/${s.name}`;
      const body = s.content.length > BH_AGENT_SKILL_INLINE_MAX ? s.content.slice(0, BH_AGENT_SKILL_INLINE_MAX) + "\n...[truncated]" : s.content;
      lines.push(`#### ${tag}`);
      lines.push(body);
    }
    return lines.join("\n");
  }
  async function _bhAgentSurfaceForHost(host) {
    const Skills = globalThis.BrowserSkills;
    if (!Skills || !host) {
      setNavSurface(null);
      return;
    }
    const h = Skills.normalizeHost(host);
    const skills = await Skills.listDomain(h).catch(() => []);
    setNavSurface({ host: h, skills });
  }
  async function _bhAgentPreloadDomainSkills(host, names) {
    const Skills = globalThis.BrowserSkills;
    if (!Skills || !host || !Array.isArray(names) || !names.length) return;
    const h = Skills.normalizeHost(host);
    for (const name of names) {
      if (typeof name !== "string" || !name) continue;
      try {
        const md = await Skills.read("domain", name, host);
        pushLoadedSkill({ kind: "domain", name, host: h, content: md });
        await _bhAgentLog({ kind: "info", text: `Pre-loaded domain skill ${name} (${h})` });
      } catch (e) {
        await _bhAgentLog({
          kind: "error",
          text: `Pre-load skipped ${name} (${h}): ${e.message}`
        });
      }
    }
    while (getLoadedSkills().length > BH_AGENT_LOADED_SKILLS_MAX) {
      shiftLoadedSkill();
    }
  }

  // extension/browser-harness/src/agent/format.js
  function _bhAgentFormatInteractiveList(items, structurals, prevHashes) {
    if (!items || !items.length) return { text: "", hashes: /* @__PURE__ */ new Set() };
    const hashes = /* @__PURE__ */ new Set();
    const childrenOf = /* @__PURE__ */ new Map();
    childrenOf.set(null, []);
    const pushChild = (pid, node) => {
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid).push(node);
    };
    for (const it of items) pushChild(it.parent_id, it);
    for (const s of structurals || []) pushChild(s.parent_id, s);
    const formatAttrs = (attrs) => {
      if (!attrs) return "";
      const parts = [];
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === "") continue;
        const s = String(v);
        const needsQuotes = /[\s"<>&]/.test(s);
        parts.push(needsQuotes ? `${k}="${s.replace(/"/g, "&quot;")}"` : `${k}=${s}`);
      }
      return parts.join(" ");
    };
    const lines = [];
    const renderNode = (node, depth) => {
      const indent = "	".repeat(depth);
      if (node.kind === "structural") {
        lines.push(`${indent}<${node.tag} />`);
      } else {
        const bx = Math.round((node.bbox && node.bbox.x) / 10) || 0;
        const by = Math.round((node.bbox && node.bbox.y) / 10) || 0;
        const role = node.attrs && node.attrs.role || "";
        const text = node.text || "";
        const hash = `${node.tag}|${role}|${text}|${bx},${by}`;
        hashes.add(hash);
        const isNew = prevHashes && prevHashes.size && !prevHashes.has(hash);
        let prefix = "";
        if (node.scrollable) prefix += "|SCROLL|";
        if (node.shadowMode) prefix += `|SHADOW(${node.shadowMode})|`;
        prefix += isNew ? "*" : "";
        const attrsStr = formatAttrs(node.attrs);
        const tag = `<${node.tag}${attrsStr ? " " + attrsStr : ""} />`;
        lines.push(`${indent}${prefix}[${node.idx}]${tag}`);
        if (text) lines.push(`${"	".repeat(depth + 1)}${text}`);
      }
      const kids = childrenOf.get(node.id);
      if (kids) {
        for (const k of kids) renderNode(k, depth + 1);
      }
    };
    for (const top of childrenOf.get(null) || []) renderNode(top, 0);
    return {
      text: "Interactive elements (use click_index with these indexes):\n" + lines.join("\n"),
      hashes
    };
  }

  // extension/browser-harness/src/agent/tabs.js
  async function _bhAgentGroupTab(tabId, task, existingGroupId = null) {
    if (!chrome.tabs?.group || !chrome.tabGroups?.update) return null;
    try {
      const groupId = existingGroupId != null ? await chrome.tabs.group({ tabIds: [tabId], groupId: existingGroupId }) : await chrome.tabs.group({ tabIds: [tabId] });
      if (existingGroupId == null) {
        const data = await chrome.storage.local.get(BH_AGENT_COLOR_KEY);
        const idx = (data[BH_AGENT_COLOR_KEY] || 0) % BH_AGENT_GROUP_COLORS.length;
        await chrome.storage.local.set({ [BH_AGENT_COLOR_KEY]: idx + 1 });
        await chrome.tabGroups.update(groupId, {
          title: _bhAgentTruncate(task, 40),
          color: BH_AGENT_GROUP_COLORS[idx]
        });
      }
      return groupId;
    } catch (e) {
      console.warn("[BrowserAgent] group tab failed:", e.message);
      return null;
    }
  }
  async function _bhAgentRedirectInto(newTabId, url) {
    if (!getTabId()) return;
    try {
      await globalThis.BrowserHarness.gotoUrl(getTabId(), url);
      try {
        await chrome.tabs.remove(newTabId);
      } catch {
      }
      await _bhAgentLog({ kind: "info", text: `Caught popup \u2192 ${url}` });
    } catch (e) {
      console.warn("[BrowserAgent] redirect failed:", e.message);
    }
  }
  function _bhAgentOnTabCreated(tab) {
    if (!isRunning() || isCreatingTab()) return;
    if (_bhAgentOwnedTabs.has(tab.id)) return;
    if (!_bhAgentOwnedTabs.has(tab.openerTabId)) return;
    _bhAgentSwallow.add(tab.id);
    const url = tab.pendingUrl || tab.url;
    if (url && url !== "about:blank" && url !== "chrome://newtab/") {
      _bhAgentSwallow.delete(tab.id);
      _bhAgentRedirectInto(tab.id, url);
    }
  }
  function _bhAgentOnTabUpdated(tabId, changeInfo) {
    if (!_bhAgentSwallow.has(tabId)) return;
    const url = changeInfo.url || changeInfo.pendingUrl;
    if (!url || url === "about:blank" || url === "chrome://newtab/") return;
    _bhAgentSwallow.delete(tabId);
    _bhAgentRedirectInto(tabId, url);
  }
  function _bhAgentOnTabRemoved(tabId) {
    _bhAgentOwnedTabs.delete(tabId);
    _bhAgentSwallow.delete(tabId);
    if (getTabId() === tabId) {
      const fallback = _bhAgentOwnedTabs.values().next().value;
      setTabId(fallback || null);
    }
  }
  async function _bhAgentEnsureUsableTab(task) {
    if (getTabId()) return;
    const H = globalThis.BrowserHarness;
    if (!H || !H.newTab) return;
    setCreatingTab(true);
    try {
      const created = await H.newTab("about:blank", { active: false });
      if (!created || created.tabId == null) return;
      _bhAgentOwnedTabs.add(created.tabId);
      setTabId(created.tabId);
      setGroupId(await _bhAgentGroupTab(created.tabId, task, getGroupId()));
      await _bhAgentLog({
        kind: "info",
        text: "No usable tab; opened fresh about:blank."
      });
    } catch (e) {
      console.warn("[BrowserAgent] ensureUsableTab failed:", e.message);
    } finally {
      setCreatingTab(false);
    }
  }
  if (chrome.tabs?.onCreated && !chrome.tabs.onCreated._bhAgentInstalled) {
    chrome.tabs.onCreated.addListener(_bhAgentOnTabCreated);
    chrome.tabs.onUpdated.addListener(_bhAgentOnTabUpdated);
    chrome.tabs.onRemoved.addListener(_bhAgentOnTabRemoved);
    chrome.tabs.onCreated._bhAgentInstalled = true;
  }

  // extension/browser-harness/src/agent/notify.js
  function _bhAgentNotify(outcome, task, message) {
    if (!chrome.notifications || !chrome.notifications.create) return;
    const titles = {
      done: "Browser agent finished",
      error: "Browser agent failed",
      stopped: "Browser agent stopped"
    };
    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: titles[outcome] || "Browser agent",
        message: _bhAgentTruncate(`${task}

${message || ""}`),
        priority: outcome === "error" ? 2 : 1
      });
    } catch (e) {
      console.warn("[BrowserAgent] notify failed:", e.message);
    }
  }
  async function _bhAgentShowPageCursor(tabId, cssX, cssY) {
    const H = globalThis.BrowserHarness;
    if (!H || !H.js) return;
    const x = Number(cssX) | 0;
    const y = Number(cssY) | 0;
    const arrowSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 19" width="22" height="32"><path d="M 0 0 L 0 17 L 5 13 L 8 19 L 10 18 L 7 12 L 13 12 Z" fill="white" stroke="black" stroke-width="1"/></svg>';
    const expr = `(()=>{
    const x=${x}, y=${y};
    const cur=document.createElement('div');
    cur.dataset.bhAgent='cursor';
    cur.style.cssText='position:fixed;left:'+x+'px;top:'+y+'px;width:22px;height:32px;pointer-events:none;z-index:2147483647;transform:scale(1.4);transform-origin:0 0;transition:opacity .55s ease-out, transform .55s ease-out;opacity:0;filter:drop-shadow(0 1px 3px rgba(0,0,0,.45));';
    cur.innerHTML=${JSON.stringify(arrowSvg)};
    const rip=document.createElement('div');
    rip.dataset.bhAgent='ripple';
    rip.style.cssText='position:fixed;left:'+(x-14)+'px;top:'+(y-14)+'px;width:28px;height:28px;border-radius:50%;background:rgba(234,67,53,.55);box-shadow:0 0 0 2px rgba(234,67,53,.85);pointer-events:none;z-index:2147483646;transform:scale(.4);opacity:0;transition:transform .5s ease-out, opacity .5s ease-out;';
    document.documentElement.appendChild(rip);
    document.documentElement.appendChild(cur);
    requestAnimationFrame(()=>{
      cur.style.opacity='1'; cur.style.transform='scale(1)';
      rip.style.opacity='1'; rip.style.transform='scale(2)';
      setTimeout(()=>{
        cur.style.opacity='0'; rip.style.opacity='0';
        setTimeout(()=>{ cur.remove(); rip.remove(); }, 650);
      }, 1100);
    });
  })()`;
    try {
      await H.js(tabId, expr);
    } catch {
    }
  }

  // extension/browser-harness/src/agent/action-extract.js
  function _bhAgentParseAction(text) {
    let s = (text || "").trim();
    if (s.startsWith("```")) {
      s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    }
    try {
      return JSON.parse(s);
    } catch (e) {
      const err = new Error(`response was not valid JSON: ${e.message}`);
      err.rawText = text;
      throw err;
    }
  }
  function _bhAgentExtractBatch(response) {
    const meta = {
      evaluation_previous_goal: response.evaluation_previous_goal,
      memory: response.memory,
      next_goal: response.next_goal
    };
    if (Array.isArray(response.actions) && response.actions.length) {
      return { actions: response.actions, meta };
    }
    const { evaluation_previous_goal, memory, next_goal, actions, ...rest } = response;
    if (rest && typeof rest.action === "string") {
      return { actions: [rest], meta };
    }
    return { actions: [], meta };
  }
  async function _bhAgentCurrentUrlSafe(tabId) {
    if (!tabId) return null;
    try {
      const r = await globalThis.BrowserHarness.cdp(
        tabId,
        "Runtime.evaluate",
        { expression: "location.href", returnByValue: true },
        { timeoutMs: 1e3 }
      );
      return r && r.result && r.result.value || null;
    } catch {
      return null;
    }
  }

  // extension/browser-harness/src/agent/error.js
  async function _bhWithActionTimeout(label, ms, fn) {
    if (!Number.isFinite(ms) || ms <= 0) return fn();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`action ${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  function _bhClassifyAgentError(err) {
    const msg = err && err.message || String(err);
    if (/browser_crashed|browser_unresponsive|debugger detached/i.test(msg)) {
      return { kind: "terminal", msg };
    }
    if (/timed out after \d+ms/i.test(msg)) {
      return { kind: "timeout", msg };
    }
    if (err && typeof err === "object" && "rawText" in err) {
      return { kind: "parse", msg };
    }
    return { kind: "transient", msg };
  }

  // extension/browser-harness/src/agent/history.js
  async function _bhAgentCompactHistoryIfNeeded(history, task) {
    const callGemini = getGeminiCaller();
    if (!callGemini) return false;
    if (history.length <= BH_AGENT_HISTORY_KEEP_TAIL + 2) return false;
    const rendered = _bhAgentRenderHistory(history);
    if (rendered.length < BH_AGENT_HISTORY_CHAR_THRESHOLD) return false;
    const prompt = [
      "You are compacting a browser-agent history into a memory note so a future turn can continue the task without rereading every step.",
      "",
      "Preserve: the task requirements, constraints/inputs given by the user, key facts learned about the site (URLs, selectors, IDs), decisions made, partial progress, errors encountered, and any data already extracted.",
      "Drop: redundant click/scroll narration, duplicated screenshot observations, anything trivially recoverable from the next screenshot.",
      "",
      `Task: ${task}`,
      "",
      "Full history so far:",
      rendered,
      "",
      'Write a plain-text summary of ~250 words. No markdown headings, no JSON. Address the future agent in the first person ("I have\u2026", "Next I should\u2026").'
    ].join("\n");
    let summary;
    try {
      summary = await callGemini(prompt, null, {});
    } catch (e) {
      console.warn("[BrowserAgent] compaction failed:", e.message);
      return false;
    }
    if (!summary || typeof summary !== "string") return false;
    const compacted = {
      is_compacted: true,
      memory: summary.trim(),
      t: Date.now()
    };
    const removeStart = 1;
    const removeCount = history.length - BH_AGENT_HISTORY_KEEP_TAIL - 1;
    if (removeCount > 0) {
      history.splice(removeStart, removeCount, compacted);
      await _bhAgentLog({
        kind: "info",
        text: `Compacted ${removeCount} history steps into a summary (${rendered.length} -> ~${summary.length} chars)`
      });
      return true;
    }
    return false;
  }
  function _bhAgentRenderHistoryEntry(h, idx) {
    if (h.is_compacted) {
      return [
        `Step ${idx + 1} (compacted summary of earlier steps):`,
        h.memory || "(no summary)"
      ].join("\n");
    }
    const actionView = {};
    for (const k of Object.keys(h)) {
      if ([
        "evaluation_previous_goal",
        "memory",
        "next_goal",
        "reason",
        "is_compacted",
        "extracted",
        "error",
        "t"
      ].includes(k)) continue;
      actionView[k] = h[k];
    }
    const lines = [`Step ${idx + 1}:`];
    if (h.evaluation_previous_goal) lines.push(`  evaluation_previous_goal: ${h.evaluation_previous_goal}`);
    if (h.next_goal) lines.push(`  next_goal: ${h.next_goal}`);
    lines.push(`  action: ${JSON.stringify(actionView)}`);
    if (h.reason) lines.push(`  reason: ${h.reason}`);
    if (h.extracted !== void 0 && h.extracted !== null) {
      let blob;
      try {
        blob = JSON.stringify(h.extracted);
      } catch {
        blob = String(h.extracted);
      }
      lines.push(`  result: ${_bhAgentTruncate(blob, BH_AGENT_EXTRACTED_INLINE_MAX)}`);
    }
    if (h.error) lines.push(`  error: ${_bhAgentTruncate(h.error, 400)}`);
    return lines.join("\n");
  }
  function _bhAgentRenderHistory(history) {
    if (!history.length) return "No previous actions yet.";
    return "History (full):\n\n" + history.map(_bhAgentRenderHistoryEntry).join("\n\n");
  }

  // extension/browser-harness/src/agent/ask.js
  async function _bhAgentAsk(task, screenshotB64, history, opts = {}) {
    const callGemini = getGeminiCaller();
    if (!callGemini) throw new Error("agent: gemini caller not configured");
    const { pendingError = null, pendingRaw = null, interactiveListText = "" } = opts;
    const histText = _bhAgentRenderHistory(history);
    const memoryText = getCurrentMemory() ? `### Current memory
${getCurrentMemory()}` : "";
    const { tabs, activeIdx } = await _bhAgentTabsContext();
    const tabsText = tabs.length ? "Tabs you have open (only these are accessible):\n" + tabs.map(
      (t) => `  [${t.idx}]${t.idx === activeIdx ? " (current)" : ""} ${_bhAgentTruncate(t.title || "(untitled)", 60)} \u2014 ${_bhAgentTruncate(t.url, 80)}`
    ).join("\n") : "No tabs currently tracked.";
    const navText = await _bhAgentConsumeNavSurface();
    const loadedText = _bhAgentLoadedSkillsBlock();
    const retryBlock = pendingError ? [
      "",
      "### Previous attempt failed",
      pendingRaw ? "Your previous output was:" : "",
      pendingRaw ? "```\n" + _bhAgentTruncate(pendingRaw, 1200) + "\n```" : "",
      "Error:",
      _bhAgentTruncate(pendingError, 600),
      "Pick a valid action from the list above and try again."
    ].filter(Boolean).join("\n") : "";
    const prompt = [
      getSystemPrompt(),
      "",
      `Task: ${task}`,
      "",
      "Here is the current browser screenshot (attached as image).",
      "",
      interactiveListText ? "\n" + interactiveListText : "",
      "",
      tabsText,
      navText ? "\n" + navText : "",
      loadedText ? "\n" + loadedText : "",
      memoryText ? "\n" + memoryText : "",
      retryBlock,
      "",
      histText,
      "",
      "What single action should I take next? Respond with JSON only, including evaluation_previous_goal, memory, next_goal."
    ].filter(Boolean).join("\n");
    const text = await callGemini(prompt, null, {
      images: screenshotB64 ? [`data:image/png;base64,${screenshotB64}`] : [],
      mimeType: "application/json"
    });
    try {
      return _bhAgentParseAction(text);
    } catch (e) {
      if (!e.rawText) e.rawText = text;
      throw e;
    }
  }

  // extension/browser-harness/src/agent/exec.js
  async function _bhAgentGate(action) {
    const V = globalThis.Validation;
    if (!V || !V.isRunning()) return { allowed: true };
    const described = [
      action.action,
      action.text,
      action.label,
      action.selector,
      action.url
    ].filter(Boolean).join(" ");
    try {
      return await V.allow(described);
    } catch {
      return { allowed: true };
    }
  }
  async function _bhAgentExec(tabId, action, task) {
    const H = globalThis.BrowserHarness;
    const gate = await _bhAgentGate(action);
    if (!gate.allowed) {
      _bhAgentLog({
        kind: "action",
        action: "blocked",
        detail: `held: ${(gate.waitingOn || []).join(", ")}`
      });
      return {
        keepGoing: true,
        summary: `Held. ${gate.say || "Waiting on the person."} Do not retry this step; wait for their answer.`
      };
    }
    switch (action.action) {
      case "click": {
        const s = getImageScale() || 1;
        const cssX = action.x / s;
        const cssY = action.y / s;
        const snap = await H.clickAt(tabId, cssX, cssY);
        const visX = snap && Number.isFinite(snap.x) ? snap.x : cssX;
        const visY = snap && Number.isFinite(snap.y) ? snap.y : cssY;
        _bhAgentShowPageCursor(tabId, visX, visY);
        if (snap && snap.snapped) {
          const dx = Math.round(visX - cssX);
          const dy = Math.round(visY - cssY);
          const tagInfo = snap.tag + (snap.role ? " role=" + snap.role : "");
          const occluded = snap.occluded ? " OCCLUDED\u2192jsClick" : "";
          const fallback = snap.fallback ? " (jsClick fallback \u2713)" : "";
          await _bhAgentLog({
            kind: "info",
            text: `Click @(${Math.round(cssX)}, ${Math.round(cssY)}) \u2192 snap[${snap.via}] to <${tagInfo}> \u0394(${dx}, ${dy})${occluded}${fallback}.`
          });
        } else {
          await _bhAgentLog({
            kind: "info",
            text: `Click @(${Math.round(cssX)}, ${Math.round(cssY)}) raw \u2014 no interactive target at point (page-side + AX both empty).`
          });
        }
        await H.wait(500);
        return { keepGoing: true };
      }
      // Index-based click: looks up the element by its position in the most
      // recent enumerate() snapshot. The agent step loop enumerates before
      // every screenshot so indexes are always fresh. browser_use's dominant
      // click mode -- DOM-derived coords are pixel-exact, no vision
      // approximation involved.
      case "click_index": {
        const idx = action.index;
        if (!Number.isInteger(idx) || idx < 0) {
          throw new Error("click_index: missing or invalid `index`");
        }
        let result;
        try {
          result = await H.clickIndex(tabId, idx);
        } catch (e) {
          throw new Error(e.message || String(e));
        }
        if (result && Number.isFinite(result.x) && Number.isFinite(result.y)) {
          _bhAgentShowPageCursor(tabId, result.x, result.y);
        }
        const tagInfo = (result.tag || "?") + (result.role ? " role=" + result.role : "");
        const occluded = result.occluded ? " OCCLUDED\u2192jsClick" : "";
        const fallback = result.fallback ? " (jsClick \u2713)" : "";
        const recovered = result.recoveredFromIdx !== void 0 ? ` (recovered ${result.recoveredFromIdx}\u2192${result.recoveredToIdx})` : "";
        await _bhAgentLog({
          kind: "info",
          text: `click_index[${idx}]${recovered} \u2192 <${tagInfo}>${occluded}${fallback}.`
        });
        await H.wait(500);
        return { keepGoing: true };
      }
      case "type":
        await H.typeText(tabId, action.text);
        await H.wait(300);
        return { keepGoing: true };
      case "type_index": {
        const idx = action.index;
        if (!Number.isInteger(idx) || idx < 0) {
          throw new Error("type_index: missing or invalid `index`");
        }
        const text = typeof action.text === "string" ? action.text : "";
        const result = await H.typeIndex(tabId, idx, text, { clear: action.clear !== false });
        const recovered = result.recoveredFromIdx !== void 0 ? ` (recovered ${result.recoveredFromIdx}\u2192${result.recoveredToIdx})` : "";
        await _bhAgentLog({
          kind: "info",
          text: `type_index[${idx}]${recovered} <${result.tag || "?"}${result.type ? " type=" + result.type : ""}> \u2190 ${JSON.stringify(text.slice(0, 40))}${text.length > 40 ? "\u2026" : ""}.`
        });
        await H.wait(300);
        return { keepGoing: true };
      }
      case "upload_file": {
        const idx = action.index;
        if (!Number.isInteger(idx) || idx < 0) {
          throw new Error("upload_file: missing or invalid `index`");
        }
        const files = Array.isArray(action.files) ? action.files : action.file ? [action.file] : [];
        if (!files.length) throw new Error("upload_file: missing `file` (string) or `files` (array)");
        const result = await H.uploadFileIndex(tabId, idx, files);
        await _bhAgentLog({ kind: "info", text: `upload_file[${idx}] \u2190 ${result.files.join(", ")}.` });
        return { keepGoing: true };
      }
      case "dropdown_options": {
        const idx = action.index;
        if (!Number.isInteger(idx) || idx < 0) {
          throw new Error("dropdown_options: missing or invalid `index`");
        }
        const data = await H.dropdownOptions(tabId, idx);
        await _bhAgentLog({
          kind: "info",
          text: `dropdown_options[${idx}] (${data.kind}): ${data.options.length} options.`
        });
        return {
          keepGoing: true,
          extracted: { kind: data.kind, multiple: !!data.multiple, options: data.options }
        };
      }
      case "select_dropdown": {
        const idx = action.index;
        if (!Number.isInteger(idx) || idx < 0) {
          throw new Error("select_dropdown: missing or invalid `index`");
        }
        const text = typeof action.text === "string" ? action.text : "";
        if (!text) throw new Error("select_dropdown: missing `text`");
        const result = await H.selectDropdown(tabId, idx, text);
        await _bhAgentLog({
          kind: "info",
          text: `select_dropdown[${idx}] (${result.kind}) \u2190 ${JSON.stringify(text)} \u2192 ${JSON.stringify(result.selectedText || "")}.`
        });
        await H.wait(300);
        return { keepGoing: true };
      }
      case "go_back": {
        await H.goBack(tabId);
        await H.waitForLoad(tabId);
        return { keepGoing: true };
      }
      case "go_forward": {
        await H.goForward(tabId);
        await H.waitForLoad(tabId);
        return { keepGoing: true };
      }
      case "refresh": {
        await H.refresh(tabId, { ignoreCache: !!action.hard });
        await H.waitForLoad(tabId);
        return { keepGoing: true };
      }
      case "press_key":
        await H.pressKey(tabId, action.key);
        await H.wait(500);
        return { keepGoing: true };
      case "scroll": {
        const s = getImageScale() || 1;
        await H.scroll(
          tabId,
          (action.x ?? 600) / s,
          (action.y ?? 400) / s,
          (action.dy ?? -300) / s,
          (action.dx ?? 0) / s
        );
        await H.wait(500);
        return { keepGoing: true };
      }
      case "navigate": {
        await H.gotoUrl(tabId, action.url);
        await H.waitForLoad(tabId);
        await _bhAgentSurfaceForHost(_bhAgentHostOf(action.url));
        if (Array.isArray(action.read_skills) && action.read_skills.length) {
          await _bhAgentPreloadDomainSkills(_bhAgentHostOf(action.url), action.read_skills);
        }
        return { keepGoing: true };
      }
      case "wait":
        await H.wait((action.seconds ?? 1) * 1e3);
        return { keepGoing: true };
      case "open_tab": {
        setCreatingTab(true);
        let created;
        try {
          created = await H.newTab(action.url || "about:blank", { active: false });
        } finally {
          setCreatingTab(false);
        }
        if (created?.tabId == null) throw new Error("failed to open tab");
        _bhAgentOwnedTabs.add(created.tabId);
        await _bhAgentGroupTab(created.tabId, task, getGroupId());
        setTabId(created.tabId);
        if (action.url && action.url !== "about:blank") {
          await H.waitForLoad(created.tabId);
          await _bhAgentSurfaceForHost(_bhAgentHostOf(action.url));
          if (Array.isArray(action.read_skills) && action.read_skills.length) {
            await _bhAgentPreloadDomainSkills(_bhAgentHostOf(action.url), action.read_skills);
          }
        }
        return { keepGoing: true, newTabId: created.tabId };
      }
      case "switch_tab": {
        const next = _bhAgentResolveTabIdx(action.tab);
        if (next == null) throw new Error(`switch_tab: no tab at index ${action.tab}`);
        setTabId(next);
        await H.attach(next);
        return { keepGoing: true, newTabId: next };
      }
      case "close_tab": {
        const target = _bhAgentResolveTabIdx(action.tab);
        if (target == null) throw new Error(`close_tab: no tab at index ${action.tab}`);
        try {
          await chrome.tabs.remove(target);
        } catch {
        }
        if (!getTabId()) {
          return { keepGoing: false, summary: "closed last agent tab" };
        }
        return { keepGoing: true };
      }
      case "read_skill": {
        const Skills = globalThis.BrowserSkills;
        if (!Skills) throw new Error("skills registry not loaded");
        const kind = action.kind === "domain" ? "domain" : "interaction";
        const md = await Skills.read(kind, action.name, action.host);
        pushLoadedSkill({
          kind,
          name: action.name,
          host: kind === "domain" ? Skills.normalizeHost(action.host) : null,
          content: md
        });
        while (getLoadedSkills().length > BH_AGENT_LOADED_SKILLS_MAX) {
          shiftLoadedSkill();
        }
        await _bhAgentLog({
          kind: "info",
          text: `Loaded ${kind} skill ${action.name}${action.host ? ` (${action.host})` : ""}`
        });
        return { keepGoing: true };
      }
      case "write_skill": {
        const Skills = globalThis.BrowserSkills;
        if (!Skills) throw new Error("skills registry not loaded");
        const kind = action.kind === "domain" ? "domain" : "interaction";
        await Skills.write(kind, action.name, action.content, action.host);
        await _bhAgentLog({
          kind: "info",
          text: `Saved ${kind} skill ${action.name}${action.host ? ` (${action.host})` : ""}`
        });
        return { keepGoing: true };
      }
      case "fill_input": {
        if (!action.selector || typeof action.text !== "string") {
          throw new Error("fill_input: selector and text are required");
        }
        await H.fillInput(tabId, action.selector, action.text, {
          clearFirst: action.clear_first !== false,
          timeoutMs: action.timeout_ms || 0
        });
        await H.wait(300);
        return { keepGoing: true };
      }
      case "wait_for_element": {
        if (!action.selector) throw new Error("wait_for_element: selector is required");
        const found = await H.waitForElement(tabId, action.selector, {
          timeoutMs: action.timeout_ms ?? 1e4,
          visible: !!action.visible
        });
        if (!found) {
          throw new Error(`wait_for_element: ${action.selector} not found within ${action.timeout_ms ?? 1e4}ms`);
        }
        return { keepGoing: true };
      }
      case "wait_for_network_idle": {
        const idle = await H.waitForNetworkIdle(tabId, {
          timeoutMs: action.timeout_ms ?? 1e4,
          idleMs: action.idle_ms ?? 500
        });
        if (!idle) {
          await _bhAgentLog({ kind: "info", text: "wait_for_network_idle: timed out, network still active" });
        }
        return { keepGoing: true };
      }
      case "handle_dialog": {
        await H.handleDialog(tabId, action.accept !== false, action.prompt_text ?? null);
        await H.wait(200);
        return { keepGoing: true };
      }
      case "js": {
        if (!action.code || typeof action.code !== "string") {
          throw new Error("js: code is required");
        }
        const value = await H.js(tabId, action.code);
        return { keepGoing: true, extracted: value };
      }
      case "done":
        return { keepGoing: false };
      default:
        throw new Error(`unknown action: ${action.action}`);
    }
  }

  // extension/browser-harness/src/agent/run.js
  async function _bhDecideTabMode(task, activeTab) {
    const gemini = getGeminiCaller();
    if (!gemini || !activeTab) {
      return { choice: "new", reason: "no LLM caller or no active tab" };
    }
    const url = activeTab.url || "";
    const title = (activeTab.title || "").replace(/\s+/g, " ").slice(0, 200);
    if (!url || /^(chrome|chrome-extension|edge|about|view-source):/.test(url) || url === "about:blank") {
      return { choice: "new", reason: "current tab is not a real web page" };
    }
    const prompt = `Decide whether a browser-agent task should act on the user's currently open page or open a fresh tab.

Task: """${task}"""

Currently open page URL: ${url}
Currently open page title: ${title}

Reply with exactly one word:
CURRENT \u2014 if the task is about this page (e.g. "dismiss the cookie banner", "turn on captions", "summarize this article", or any phrasing implying "the page I'm on").
NEW \u2014 if the task names a different site, asks to search or visit something else, or implies starting fresh.

One word only.`;
    let raw;
    try {
      raw = await gemini(prompt, null);
    } catch (e) {
      return { choice: "new", reason: "autonomy LLM call failed: " + e.message };
    }
    const ans = (raw || "").trim().toUpperCase();
    if (ans.startsWith("CURRENT")) {
      return { choice: "current", reason: "agent picked current tab" };
    }
    return { choice: "new", reason: "agent picked new tab" };
  }
  var _bhPending = [];
  function bhAgentInterject(instruction) {
    const t = String(instruction || "").trim();
    if (!t) return { queued: 0 };
    _bhPending.push(t);
    return { queued: _bhPending.length };
  }
  async function bhAgentRun(task, opts = {}) {
    if (isRunning()) throw new Error("agent already running");
    setRunning(true);
    setStop(false);
    setLoadedSkills([]);
    setNavSurface(null);
    setCurrentMemory("");
    setImage(1, 0, 0);
    setLastInteractiveHashes(/* @__PURE__ */ new Set());
    let systemPrompt = await _bhBuildSystemPrompt();
    setSystemPrompt(systemPrompt);
    const H = globalThis.BrowserHarness;
    const maxSteps = opts.maxSteps ?? 50;
    let tabId = opts.tabId ?? null;
    let openedNewTab = false;
    let usedExistingTab = false;
    let autonomyDecision = null;
    if (tabId == null) {
      let tabMode = opts.tabMode || "auto";
      let activeTab = null;
      if (tabMode === "current" || tabMode === "auto") {
        try {
          const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (t && t.id != null) activeTab = t;
        } catch (_) {
        }
        if (!activeTab) tabMode = "new";
      }
      if (tabMode === "auto") {
        autonomyDecision = await _bhDecideTabMode(task, activeTab);
        tabMode = autonomyDecision.choice;
      }
      if (tabMode === "current" && activeTab) {
        tabId = activeTab.id;
        usedExistingTab = true;
      } else {
        setCreatingTab(true);
        try {
          const created = await H.newTab("about:blank", { active: false });
          if (!created || created.tabId == null) {
            setRunning(false);
            throw new Error("failed to open new tab");
          }
          tabId = created.tabId;
        } finally {
          setCreatingTab(false);
        }
        openedNewTab = true;
        setGroupId(await _bhAgentGroupTab(tabId, task));
      }
    } else {
      usedExistingTab = true;
    }
    setTabId(tabId);
    _bhAgentOwnedTabs.add(tabId);
    if (globalThis.aaDemoTrace) {
      globalThis.aaDemoTrace("skill", "user", "one-off task");
      globalThis.aaDemoTrace("skill", "assistant", "Assistant runs task");
      globalThis.aaDemoTrace("skill", "assistant_perform", task);
    }
    let recallUrl = null;
    try {
      const t = await chrome.tabs.get(tabId);
      if (t && t.url && !/^(chrome|about):/.test(t.url)) recallUrl = t.url;
    } catch (_) {
    }
    if (globalThis.Librarian) {
      try {
        const recall = await globalThis.Librarian.recall(recallUrl, task);
        if (recall && recall.block) {
          systemPrompt += "\n\n## User context (from the Librarian's memory)\n" + recall.block + "\nRespect these preferences and known patterns while completing the task.";
          setSystemPrompt(systemPrompt);
        }
      } catch (e) {
        console.warn("[BrowserAgent] librarian recall failed:", e.message);
      }
    }
    const initialLog = [];
    if (autonomyDecision) {
      initialLog.push({ t: Date.now(), kind: "info", text: `Autonomy: ${autonomyDecision.reason}` });
    }
    let initialText;
    if (openedNewTab) initialText = `Opened new tab (${tabId})`;
    else if (usedExistingTab) initialText = `Acting on existing tab ${tabId}`;
    else initialText = `Starting agent on tab ${tabId}`;
    initialLog.push({ t: Date.now(), kind: "info", text: initialText });
    await _bhAgentWrite({
      task,
      tabId,
      maxSteps,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      summary: null,
      error: null,
      log: initialLog
    });
    try {
      await H.attach(tabId);
      const history = [];
      let pendingError = null;
      let pendingRaw = null;
      for (let step = 0; step < maxSteps; step++) {
        while (_bhPending.length) {
          const said = _bhPending.shift();
          history.push({ role: "user", content: `[You interrupted] ${said}` });
          await _bhAgentLog({ kind: "info", text: `You: ${said}` });
        }
        if (shouldStop()) {
          await _bhAgentPatch({ status: "stopped", endedAt: Date.now() });
          await _bhAgentLog({ kind: "info", text: "Stopped by user" });
          _bhAgentNotify("stopped", task, "Stopped by user");
          return { stopped: true };
        }
        await _bhAgentEnsureUsableTab(task);
        const currentTab = getTabId();
        if (!currentTab) {
          const summary2 = "no tabs left";
          await _bhAgentPatch({ status: "done", endedAt: Date.now(), summary: summary2 });
          await _bhAgentLog({ kind: "info", text: summary2 });
          _bhAgentNotify("done", task, summary2);
          return { summary: summary2 };
        }
        H.setAgentBusy && H.setAgentBusy(true);
        if (H.waitForLoad) {
          try {
            await H.waitForLoad(currentTab, { timeoutMs: 3e3 });
          } catch (_) {
          }
        }
        let shotErr = null;
        const [enumResult, shot] = await Promise.all([
          H.enumerateInteractive ? H.enumerateInteractive(currentTab).catch(() => null) : Promise.resolve(null),
          H.captureScreenshot(currentTab, { maxDim: 1800, cssNormalize: true }).catch((e) => {
            shotErr = e.message || String(e);
            return null;
          })
        ]);
        if (shotErr) {
          await _bhAgentLog({
            kind: "info",
            step: step + 1,
            text: `Screenshot skipped this step: ${shotErr}`
          });
        }
        const items = enumResult && Array.isArray(enumResult.items) ? enumResult.items : [];
        const rawScreenshot = typeof shot === "string" ? shot : shot.data;
        const imgScale = shot && typeof shot === "object" && shot.scale || 1;
        const imgWidth = shot && typeof shot === "object" && shot.width || 0;
        const imgHeight = shot && typeof shot === "object" && shot.height || 0;
        setImage(imgScale, imgWidth, imgHeight);
        let screenshot = rawScreenshot;
        if (items.length && H.drawHighlights) {
          try {
            screenshot = await H.drawHighlights(rawScreenshot, items, { scale: imgScale });
          } catch (e) {
            console.warn("[BrowserAgent] drawHighlights failed:", e.message);
            screenshot = rawScreenshot;
          }
        }
        const structurals = enumResult && Array.isArray(enumResult.structurals) ? enumResult.structurals : [];
        const fmt = _bhAgentFormatInteractiveList(items, structurals, getLastInteractiveHashes());
        const interactiveListText = fmt.text;
        setLastInteractiveHashes(fmt.hashes);
        let response;
        try {
          response = await _bhAgentAsk(task, screenshot, history, { pendingError, pendingRaw, interactiveListText });
        } catch (parseErr) {
          const raw = parseErr.rawText || "";
          pendingError = parseErr.message || String(parseErr);
          pendingRaw = raw || null;
          await _bhAgentLog({
            kind: "error",
            step: step + 1,
            text: `Couldn't parse response, retrying: ${pendingError}`
          });
          H.setAgentBusy && H.setAgentBusy(false);
          continue;
        }
        if (typeof response.memory === "string" && response.memory.trim()) {
          setCurrentMemory(response.memory.trim());
        }
        const { actions: batch, meta } = _bhAgentExtractBatch(response);
        if (!batch.length) {
          pendingError = "response missing both `action` and `actions`";
          pendingRaw = JSON.stringify(response).slice(0, 1200);
          await _bhAgentLog({ kind: "error", step: step + 1, text: pendingError });
          H.setAgentBusy && H.setAgentBusy(false);
          continue;
        }
        let preUrl = await _bhAgentCurrentUrlSafe(currentTab);
        let prevTabId = getTabId();
        let result = null;
        let aborted = false;
        let terminalError = null;
        for (let ai = 0; ai < batch.length; ai++) {
          const sub = batch[ai];
          const turn = ai === 0 ? { ...meta, ...sub, t: Date.now(), batchIdx: ai, batchSize: batch.length } : { ...sub, t: Date.now(), batchIdx: ai, batchSize: batch.length };
          history.push(turn);
          await _bhAgentLog({
            kind: "action",
            step: step + 1,
            action: sub.action,
            text: (batch.length > 1 ? `[${ai + 1}/${batch.length}] ` : "") + (sub.reason || sub.summary || meta.next_goal || JSON.stringify(sub))
          });
          try {
            result = await _bhWithActionTimeout(
              sub.action || "unknown",
              BH_AGENT_ACTION_TIMEOUT_MS,
              () => _bhAgentExec(getTabId(), sub, task)
            );
            if (result && "extracted" in result) turn.extracted = result.extracted;
          } catch (execErr) {
            const { kind, msg } = _bhClassifyAgentError(execErr);
            turn.error = msg;
            if (kind === "terminal") {
              terminalError = msg;
            } else {
              pendingError = kind === "timeout" ? `[timeout] ${msg}` : `[transient] ${msg}`;
              pendingRaw = JSON.stringify(sub);
              const skip = batch.length - ai - 1;
              await _bhAgentLog({
                kind: "error",
                step: step + 1,
                text: `Action ${batch.length > 1 ? `[${ai + 1}/${batch.length}] ` : ""}failed${skip > 0 ? ` (skipping ${skip} remaining)` : ""}: ${pendingError}`
              });
            }
            aborted = true;
            break;
          }
          if (result && !result.keepGoing) break;
          if (ai < batch.length - 1 && _BH_AGENT_TERMINATES_SEQUENCE.has(sub.action)) {
            const skip = batch.length - ai - 1;
            await _bhAgentLog({
              kind: "info",
              step: step + 1,
              text: `Action ${sub.action} terminates sequence; skipping ${skip} remaining.`
            });
            break;
          }
          if (ai < batch.length - 1) {
            const postUrl = await _bhAgentCurrentUrlSafe(getTabId());
            const tabChanged = getTabId() !== prevTabId;
            const urlChanged = postUrl && preUrl && postUrl !== preUrl;
            if (urlChanged || tabChanged) {
              const skip = batch.length - ai - 1;
              await _bhAgentLog({
                kind: "info",
                step: step + 1,
                text: `${tabChanged ? "Active tab" : "URL"} changed mid-batch; skipping ${skip} remaining.`
              });
              break;
            }
            preUrl = postUrl || preUrl;
            prevTabId = getTabId();
            await H.wait(500);
          }
        }
        if (terminalError) {
          await _bhAgentPatch({ status: "error", endedAt: Date.now(), error: terminalError });
          await _bhAgentLog({ kind: "error", step: step + 1, text: `Terminal: ${terminalError}` });
          _bhAgentNotify("error", task, terminalError);
          H.setAgentBusy && H.setAgentBusy(false);
          return { error: terminalError };
        }
        if (aborted) {
          H.setAgentBusy && H.setAgentBusy(false);
          continue;
        }
        const action = batch[batch.length - 1];
        const health = H.healthSnapshot && H.healthSnapshot(currentTab) || {};
        if (health.crashed) {
          if (H.healthClear) H.healthClear(currentTab);
          _bhAgentOwnedTabs.delete(currentTab);
          if (getTabId() === currentTab) setTabId(null);
          pendingError = "[browser_crashed] Tab crashed; opened a fresh tab.";
          pendingRaw = null;
          await _bhAgentLog({
            kind: "error",
            step: step + 1,
            text: pendingError
          });
          H.setAgentBusy && H.setAgentBusy(false);
          continue;
        }
        if (health.unresponsive) {
          if (H.healthClear) H.healthClear(currentTab);
          pendingError = "[browser_unresponsive] Tab failed liveness pings.";
          pendingRaw = null;
          await _bhAgentLog({
            kind: "error",
            step: step + 1,
            text: pendingError
          });
          H.setAgentBusy && H.setAgentBusy(false);
          continue;
        }
        if (health.networkStall) {
          await _bhAgentLog({
            kind: "info",
            step: step + 1,
            text: `Network stall: oldest in-flight request ${Math.round(health.networkStall / 1e3)}s old.`
          });
        }
        await _bhAgentCompactHistoryIfNeeded(history, task);
        H.setAgentBusy && H.setAgentBusy(false);
        pendingError = null;
        pendingRaw = null;
        if (!result.keepGoing) {
          const summary2 = result.summary || action.summary || "task complete";
          try {
            const V = globalThis.Validation;
            if (V?.isRunning?.()) {
              const g = await V.allow("finish the task");
              if (g && g.allowed === false) {
                await _bhAgentLog({
                  kind: "info",
                  step: step + 1,
                  text: `Tried to finish while the person is still being waited on; continuing. ${g.say || ""}`
                });
                bhAgentInterject(`You are not done. ${g.say || "Something is waiting on the person."} Wait for their answer, keep observing the page, and do not declare done again until nothing is waiting.`);
                continue;
              }
            }
          } catch {
          }
          await _bhAgentPatch({ status: "done", endedAt: Date.now(), summary: summary2 });
          await _bhAgentLog({ kind: "done", text: summary2 });
          _bhAgentNotify("done", task, summary2);
          _bhAgentObserveOutcome(task, summary2, true);
          return { summary: summary2 };
        }
      }
      const summary = `reached max steps (${maxSteps})`;
      await _bhAgentPatch({ status: "done", endedAt: Date.now(), summary });
      await _bhAgentLog({ kind: "info", text: summary });
      _bhAgentNotify("done", task, summary);
      _bhAgentObserveOutcome(task, summary, false);
      return { summary };
    } catch (e) {
      const msg = e.message || String(e);
      await _bhAgentPatch({ status: "error", endedAt: Date.now(), error: msg });
      await _bhAgentLog({ kind: "error", text: msg });
      _bhAgentNotify("error", task, msg);
      throw e;
    } finally {
      const Hf = globalThis.BrowserHarness;
      const tabsToDetach = Array.from(_bhAgentOwnedTabs);
      if (Hf && Hf.detach) {
        for (const t of tabsToDetach) {
          try {
            await Hf.detach(t);
          } catch (_) {
          }
        }
      }
      resetRunState();
      if (Hf && Hf.setAgentBusy) Hf.setAgentBusy(false);
    }
  }
  function _bhAgentObserveOutcome(task, summary, success) {
    const L = globalThis.Librarian;
    if (!L) return;
    (async () => {
      let url = null;
      try {
        const tabId = getTabId();
        if (tabId) {
          const t = await chrome.tabs.get(tabId);
          if (t && t.url && !/^(chrome|about):/.test(t.url)) url = t.url;
        }
      } catch (_) {
      }
      await L.logObservation({
        type: "agent-task",
        url,
        text: `Agent task "${task}" finished ${success ? "successfully" : "without completing"}: ${summary}`,
        data: { task, summary, success }
      });
    })().catch(() => {
    });
  }
  function bhAgentStop() {
    setStop(true);
  }
  function bhAgentIsRunning() {
    return isRunning();
  }
  async function bhAgentClear() {
    await chrome.storage.local.remove(BH_AGENT_KEY);
  }

  // extension/browser-harness/src/agent/index.js
  globalThis.BrowserAgent = {
    run: bhAgentRun,
    stop: bhAgentStop,
    clear: bhAgentClear,
    isRunning: bhAgentIsRunning,
    interject: bhAgentInterject,
    setGeminiCaller
  };
})();
