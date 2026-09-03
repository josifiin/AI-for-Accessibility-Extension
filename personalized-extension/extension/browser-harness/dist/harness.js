(() => {
  // extension/browser-harness/src/harness/state.js
  var BH_ATTACHED = /* @__PURE__ */ new Set();
  var BH_EVENTS = /* @__PURE__ */ new Map();
  var BH_PENDING_DIALOGS = /* @__PURE__ */ new Map();
  var BH_DIALOG_AUTO_TIMERS = /* @__PURE__ */ new Map();
  var BH_NET_INFLIGHT = /* @__PURE__ */ new Map();
  var BH_UNRESP_COUNT = /* @__PURE__ */ new Map();
  var _BH_LAST_ITEMS = /* @__PURE__ */ new Map();
  var BH_WATCHDOGS = [];
  var BH_HEALTH = {
    crashed: /* @__PURE__ */ new Set(),
    // tabId set
    unresponsive: /* @__PURE__ */ new Set(),
    // tabId set
    networkStall: /* @__PURE__ */ new Map()
    // tabId -> oldest in-flight age (ms)
  };
  var BH_HEALTH_ENABLED = true;
  function bhHealthIsEnabled() {
    return BH_HEALTH_ENABLED;
  }
  var BH_AUTO_DIALOG_ENABLED = true;
  function bhSetAutoDialog(enabled) {
    BH_AUTO_DIALOG_ENABLED = !!enabled;
    if (!enabled) {
      for (const t of BH_DIALOG_AUTO_TIMERS.values()) clearTimeout(t);
      BH_DIALOG_AUTO_TIMERS.clear();
    }
  }
  function bhAutoDialogIsEnabled() {
    return BH_AUTO_DIALOG_ENABLED;
  }
  var BH_AGENT_BUSY = false;
  function bhSetAgentBusy(busy) {
    BH_AGENT_BUSY = !!busy;
  }
  function bhAgentIsBusy() {
    return BH_AGENT_BUSY;
  }
  function bhHealthSnapshot(tabId) {
    return {
      crashed: BH_HEALTH.crashed.has(tabId),
      unresponsive: BH_HEALTH.unresponsive.has(tabId),
      networkStall: BH_HEALTH.networkStall.get(tabId) || 0
    };
  }
  function bhHealthClear(tabId) {
    BH_HEALTH.crashed.delete(tabId);
    BH_HEALTH.unresponsive.delete(tabId);
    BH_HEALTH.networkStall.delete(tabId);
    BH_UNRESP_COUNT.delete(tabId);
    for (const [rid, e] of BH_NET_INFLIGHT) {
      if (e.tabId === tabId) BH_NET_INFLIGHT.delete(rid);
    }
  }
  function bhDrainEvents(tabId) {
    const buf = BH_EVENTS.get(tabId) || [];
    BH_EVENTS.set(tabId, []);
    return buf;
  }
  function bhPendingDialog(tabId) {
    return BH_PENDING_DIALOGS.get(tabId) || null;
  }

  // extension/browser-harness/src/harness/constants.js
  var BH_INTERNAL = ["chrome://", "chrome-untrusted://", "devtools://", "chrome-extension://", "about:"];
  var BH_DEBUGGER_VERSION = "1.3";
  var BH_CDP_TIMEOUT_MS = 6e4;
  var BH_EVENT_LIMIT = 500;
  var BH_AUTO_DISMISS_MS = 500;
  var BH_NETWORK_STALL_MS = 3e4;
  var BH_NET_MAX_AGE_MS = 12e4;
  var BH_NET_TRACKED_TYPES = /* @__PURE__ */ new Set(["Document", "XHR", "Fetch"]);
  var BH_UNRESPONSIVE_THRESHOLD = 3;
  var BH_LIVENESS_PERIOD_MIN = 0.5;
  var BH_PING_TIMEOUT_MS = 2e3;
  var BH_REATTACH_RE = /detached|disconnected|target closed|no tab|not attached|debugger is not attached|session with given id not found/i;
  var _BH_AX_INTERACTIVE_ROLES = /* @__PURE__ */ new Set([
    "button",
    "link",
    "menuitem",
    "option",
    "radio",
    "checkbox",
    "tab",
    "textbox",
    "combobox",
    "slider",
    "spinbutton",
    "listbox",
    "search",
    "searchbox",
    "row",
    "cell",
    "gridcell"
  ]);
  var _BH_HIGHLIGHT_COLORS = [
    "#e6194B",
    "#3cb44b",
    "#4363d8",
    "#f58231",
    "#911eb4",
    "#42d4f4",
    "#f032e6",
    "#bfef45"
  ];
  var BH_KEYS = {
    Enter: [13, "Enter", "\r"],
    Tab: [9, "Tab", "	"],
    Backspace: [8, "Backspace", ""],
    Escape: [27, "Escape", ""],
    Delete: [46, "Delete", ""],
    " ": [32, "Space", " "],
    ArrowLeft: [37, "ArrowLeft", ""],
    ArrowUp: [38, "ArrowUp", ""],
    ArrowRight: [39, "ArrowRight", ""],
    ArrowDown: [40, "ArrowDown", ""],
    Home: [36, "Home", ""],
    End: [35, "End", ""],
    PageUp: [33, "PageUp", ""],
    PageDown: [34, "PageDown", ""]
  };
  var BH_KC = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, " ": 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

  // extension/browser-harness/src/harness/cdp.js
  function _bhTimeout(ms, label) {
    let timer;
    const promise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`CDP ${label} timed out after ${ms}ms`)), ms);
    });
    return { promise, cancel: () => clearTimeout(timer) };
  }
  function _bhSendCmd(target, method, params, timeoutMs) {
    const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : BH_CDP_TIMEOUT_MS;
    const send = new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(target, method, params || {}, (result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(`${method}: ${err.message}`));
        else resolve(result || {});
      });
    });
    if (!Number.isFinite(ms)) return send;
    const t = _bhTimeout(ms, method);
    return Promise.race([send, t.promise]).finally(() => t.cancel());
  }
  function _bhSendRaw(tabId, method, params, timeoutMs) {
    return _bhSendCmd({ tabId }, method, params, timeoutMs);
  }

  // extension/browser-harness/src/harness/lifecycle.js
  async function bhAttach(tabId) {
    if (BH_ATTACHED.has(tabId)) return;
    await chrome.debugger.attach({ tabId }, BH_DEBUGGER_VERSION);
    BH_ATTACHED.add(tabId);
    for (const d of ["Page", "DOM", "Runtime", "Network", "Accessibility"]) {
      try {
        await _bhSendRaw(tabId, `${d}.enable`);
      } catch {
      }
    }
  }
  async function bhDetach(tabId) {
    if (!BH_ATTACHED.has(tabId)) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
    }
    BH_ATTACHED.delete(tabId);
  }
  async function bhCdp(tabId, method, params = {}, opts = {}) {
    const tm = opts.timeoutMs;
    try {
      return await _bhSendRaw(tabId, method, params, tm);
    } catch (e) {
      if (!BH_REATTACH_RE.test(e.message)) throw e;
      BH_ATTACHED.delete(tabId);
      try {
        await bhAttach(tabId);
      } catch {
        throw e;
      }
      return await _bhSendRaw(tabId, method, params, tm);
    }
  }
  if (!chrome.debugger.onDetach._bhInstalled) {
    chrome.debugger.onDetach.addListener((source) => {
      if (source && source.tabId != null) {
        BH_ATTACHED.delete(source.tabId);
        BH_EVENTS.delete(source.tabId);
        BH_PENDING_DIALOGS.delete(source.tabId);
        const t = BH_DIALOG_AUTO_TIMERS.get(source.tabId);
        if (t) clearTimeout(t);
        BH_DIALOG_AUTO_TIMERS.delete(source.tabId);
        bhHealthClear(source.tabId);
      }
    });
    chrome.debugger.onDetach._bhInstalled = true;
  }
  if (!chrome.debugger.onEvent._bhInstalled) {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      const tabId = source && source.tabId;
      if (tabId == null) return;
      for (const w of BH_WATCHDOGS) w._dispatch(tabId, method, params);
      let buf = BH_EVENTS.get(tabId);
      if (!buf) {
        buf = [];
        BH_EVENTS.set(tabId, buf);
      }
      buf.push({ method, params, t: Date.now() });
      if (buf.length > BH_EVENT_LIMIT) buf.shift();
    });
    chrome.debugger.onEvent._bhInstalled = true;
  }

  // extension/browser-harness/src/harness/dialog.js
  async function bhHandleDialog(tabId, accept = true, promptText = null) {
    await bhAttach(tabId);
    const params = { accept };
    if (promptText != null) params.promptText = promptText;
    await bhCdp(tabId, "Page.handleJavaScriptDialog", params);
  }

  // extension/browser-harness/src/harness/watchdog.js
  var _BhWatchdog = class {
    constructor(name) {
      this.name = name;
      this.handlers = /* @__PURE__ */ new Map();
    }
    on(method, handler) {
      this.handlers.set(method, handler);
      return this;
    }
    _dispatch(tabId, method, params) {
      if (!BH_ATTACHED.has(tabId)) return;
      const h = this.handlers.get(method);
      if (!h) return;
      try {
        const r = h(tabId, params);
        if (r && typeof r.catch === "function") {
          r.catch((e) => console.warn(
            `[BrowserHarness] watchdog ${this.name}.${method} failed:`,
            e && e.message
          ));
        }
      } catch (e) {
        console.warn(
          `[BrowserHarness] watchdog ${this.name}.${method} threw:`,
          e && e.message
        );
      }
    }
  };
  var _bhPopupsWatchdog = new _BhWatchdog("popups").on("Page.javascriptDialogOpening", (tabId, params) => {
    BH_PENDING_DIALOGS.set(tabId, params);
    if (bhAutoDialogIsEnabled() && !BH_DIALOG_AUTO_TIMERS.has(tabId)) {
      const handle = setTimeout(
        () => _bhAutoDismissDialog(tabId, params),
        BH_AUTO_DISMISS_MS
      );
      BH_DIALOG_AUTO_TIMERS.set(tabId, handle);
    }
  }).on("Page.javascriptDialogClosed", (tabId) => {
    BH_PENDING_DIALOGS.delete(tabId);
    const t = BH_DIALOG_AUTO_TIMERS.get(tabId);
    if (t) clearTimeout(t);
    BH_DIALOG_AUTO_TIMERS.delete(tabId);
  });
  var _bhCrashWatchdog = new _BhWatchdog("crash").on("Target.targetCrashed", (tabId) => {
    if (bhHealthIsEnabled()) BH_HEALTH.crashed.add(tabId);
  }).on("Inspector.targetCrashed", (tabId) => {
    if (bhHealthIsEnabled()) BH_HEALTH.crashed.add(tabId);
  }).on("Network.requestWillBeSent", (tabId, params) => {
    const rid = params && params.requestId;
    const type = params && params.type;
    if (rid && BH_NET_TRACKED_TYPES.has(type)) {
      BH_NET_INFLIGHT.set(rid, { tabId, t: Date.now() });
    }
  }).on("Network.responseReceived", (_tabId, params) => {
    const rid = params && params.requestId;
    if (!rid || !BH_NET_INFLIGHT.has(rid)) return;
    const mime = params && params.response && params.response.mimeType || "";
    if (mime === "text/event-stream" || mime === "application/grpc") {
      BH_NET_INFLIGHT.delete(rid);
    }
  }).on("Network.loadingFinished", (_tabId, params) => {
    const rid = params && params.requestId;
    if (rid) BH_NET_INFLIGHT.delete(rid);
  }).on("Network.loadingFailed", (_tabId, params) => {
    const rid = params && params.requestId;
    if (rid) BH_NET_INFLIGHT.delete(rid);
  }).on("Page.frameNavigated", (tabId, params) => {
    const frame = params && params.frame;
    if (!frame || frame.parentId) return;
    for (const [rid, e] of BH_NET_INFLIGHT) {
      if (e.tabId === tabId) BH_NET_INFLIGHT.delete(rid);
    }
  });
  BH_WATCHDOGS.push(_bhPopupsWatchdog, _bhCrashWatchdog);
  async function _bhAutoDismissDialog(tabId, params) {
    BH_DIALOG_AUTO_TIMERS.delete(tabId);
    if (!BH_PENDING_DIALOGS.has(tabId)) return;
    const type = params && params.type || "alert";
    const accept = type !== "prompt";
    try {
      await bhHandleDialog(tabId, accept, null);
    } catch {
      return;
    }
    const buf = BH_EVENTS.get(tabId);
    if (buf) {
      buf.push({
        method: "bh.autoDialog",
        params: {
          type,
          message: params && params.message || "",
          defaultPrompt: params && params.defaultPrompt || "",
          accept
        },
        t: Date.now()
      });
      if (buf.length > BH_EVENT_LIMIT) buf.shift();
    }
  }

  // extension/browser-harness/src/harness/liveness.js
  async function _bhPing(tabId) {
    if (!bhHealthIsEnabled()) return;
    if (bhAgentIsBusy()) return;
    if (!BH_ATTACHED.has(tabId)) return;
    try {
      await bhCdp(
        tabId,
        "Runtime.evaluate",
        { expression: "1", returnByValue: true },
        { timeoutMs: BH_PING_TIMEOUT_MS }
      );
      BH_UNRESP_COUNT.delete(tabId);
      BH_HEALTH.unresponsive.delete(tabId);
    } catch {
      const n = (BH_UNRESP_COUNT.get(tabId) || 0) + 1;
      BH_UNRESP_COUNT.set(tabId, n);
      if (n >= BH_UNRESPONSIVE_THRESHOLD) BH_HEALTH.unresponsive.add(tabId);
    }
  }
  if (typeof chrome !== "undefined" && chrome.alarms && !chrome.alarms.onAlarm._bhInstalled) {
    chrome.alarms.create("bhLiveness", { periodInMinutes: BH_LIVENESS_PERIOD_MIN });
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name !== "bhLiveness" || !bhHealthIsEnabled()) return;
      const now = Date.now();
      BH_HEALTH.networkStall.clear();
      for (const [rid, { tabId, t }] of BH_NET_INFLIGHT) {
        const age = now - t;
        if (age >= BH_NET_MAX_AGE_MS) {
          BH_NET_INFLIGHT.delete(rid);
          continue;
        }
        if (age >= BH_NETWORK_STALL_MS) {
          const prev = BH_HEALTH.networkStall.get(tabId) || 0;
          if (age > prev) BH_HEALTH.networkStall.set(tabId, age);
        }
      }
      await Promise.all(Array.from(BH_ATTACHED).map(_bhPing));
    });
    chrome.alarms.onAlarm._bhInstalled = true;
  }

  // extension/browser-harness/src/harness/navigation.js
  async function bhGotoUrl(tabId, url) {
    await bhAttach(tabId);
    return await bhCdp(tabId, "Page.navigate", { url });
  }
  async function bhGoBack(tabId) {
    await bhAttach(tabId);
    await bhCdp(tabId, "Runtime.evaluate", { expression: "history.back()" });
  }
  async function bhGoForward(tabId) {
    await bhAttach(tabId);
    await bhCdp(tabId, "Runtime.evaluate", { expression: "history.forward()" });
  }
  async function bhRefresh(tabId, opts = {}) {
    await bhAttach(tabId);
    return await bhCdp(tabId, "Page.reload", { ignoreCache: !!opts.ignoreCache });
  }
  async function bhPageInfo(tabId) {
    await bhAttach(tabId);
    const dialog = bhPendingDialog(tabId);
    if (dialog) return { dialog };
    const r = await bhCdp(tabId, "Runtime.evaluate", {
      expression: "JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})",
      returnByValue: true
    });
    if (r && r.result && r.result.value) return JSON.parse(r.result.value);
    return { url: "", title: "", w: 0, h: 0, sx: 0, sy: 0, pw: 0, ph: 0 };
  }

  // extension/browser-harness/src/harness/injected/page-helpers.bhinject
  var page_helpers_default = `// In-page interactive-element helper. Bundled in by esbuild's text loader
// (.bhinject suffix) and handed to Runtime.evaluate verbatim, so this file
// runs in the *page's* JS context, not the service worker's. It must
// therefore be self-contained: no imports, no SW APIs.
//
// Returns an IIFE expression evaluating to { findTarget, enumerate }:
//   findTarget(x, y) -- nearest interactive ancestor at (x, y); used by
//     coordinate-click snap and JS-click fallback.
//   enumerate(opts)  -- index every interactive, visible, in-viewport
//     element AND every "structural" container; cache live element refs
//     at window.__bhInteractive[idx] so click_index can later resolve idx
//     -> live element without a backendNodeId round-trip.
//
// Heuristic mirrors browser_use/dom/serializer/clickable_elements.py:
//   - STRICT tier (deepest-first): semantic clickables (a[href], button,
//     input not hidden, select, textarea, option, optgroup, summary,
//     details, label-without-for that wraps a form control, span that
//     wraps a form control, [onclick|onmousedown|onmouseup|onkeydown|
//     onkeyup], [role=button|link|menuitem|...], tabindex>=0,
//     contentEditable, getEventListeners-detected click handlers).
//   - POINTER tier (topmost in unbroken cursor:pointer chain): catches
//     clickable wrappers that have no semantic markup but use cursor
//     styling. cursor:pointer is inherited so we pick the topmost rather
//     than the deepest, otherwise we'd snap to inner spans inside buttons.
// Strict beats pointer when both exist.
//
// getEventListeners() requires Runtime.evaluate with includeCommandLineAPI=true
// (DevTools-only API); calls to Runtime.callFunctionOn would not have it in
// scope.

(function() {
  const SKIP_TAG = new Set(['HTML', 'BODY']);
  const ROLE_RX = /^(button|link|tab|menuitem|checkbox|radio|switch|option|combobox|menuitemcheckbox|menuitemradio|treeitem|listbox|textbox|slider|spinbutton|search|searchbox|row|cell|gridcell)$/i;
  const EVENT_ATTRS = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup'];
  const FORM_TAG_RX = /^(INPUT|SELECT|TEXTAREA)$/i;
  const SEARCH_KW_RX = /(^|[\\s\\-_:])(search|magnify|glass|searchbox)([\\s\\-_:]|$)/i;
  const ICON_TRIGGER_ATTRS = ['role', 'onclick', 'data-action', 'aria-label'];

  const hasFormDescendant = (el, depth) => {
    if (depth <= 0 || !el || el.nodeType !== 1) return false;
    for (const c of el.children) {
      if (FORM_TAG_RX.test(c.tagName)) return true;
      if (hasFormDescendant(c, depth - 1)) return true;
    }
    return false;
  };

  const hasJsListener = (el) => {
    try {
      if (typeof getEventListeners !== 'function') return false;
      const ls = getEventListeners(el);
      return !!(ls && (ls.click || ls.mousedown || ls.mouseup || ls.pointerdown || ls.pointerup));
    } catch (_) { return false; }
  };

  const matchesSearchKw = (el) => {
    const cls = el.getAttribute('class');
    if (cls && SEARCH_KW_RX.test(cls)) return true;
    const id = el.getAttribute('id');
    if (id && SEARCH_KW_RX.test(id)) return true;
    const attrs = el.attributes;
    if (!attrs) return false;
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (a.name && a.name.indexOf('data-') === 0 && a.value && SEARCH_KW_RX.test(a.value)) return true;
    }
    return false;
  };

  const isIconSized = (el) => {
    const r = el.getBoundingClientRect();
    if (!r || r.width < 10 || r.width > 50 || r.height < 10 || r.height > 50) return false;
    for (let i = 0; i < ICON_TRIGGER_ATTRS.length; i++) {
      if (el.hasAttribute(ICON_TRIGGER_ATTRS[i])) return true;
    }
    return false;
  };

  const isStrict = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (SKIP_TAG.has(tag)) return false;
    if (el.disabled === true) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (tag === 'A' && el.hasAttribute('href')) return true;
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA'
        || tag === 'OPTION' || tag === 'OPTGROUP' || tag === 'SUMMARY'
        || tag === 'DETAILS' || tag === 'AREA' || tag === 'MAP') return true;
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      return t !== 'hidden';
    }
    if (tag === 'LABEL') {
      if (el.hasAttribute('for')) return false;
      return hasFormDescendant(el, 2);
    }
    if (tag === 'SPAN' && hasFormDescendant(el, 2)) return true;
    if (el.isContentEditable) return true;
    for (let i = 0; i < EVENT_ATTRS.length; i++) {
      if (el.hasAttribute(EVENT_ATTRS[i])) return true;
    }
    const role = el.getAttribute('role');
    if (role && ROLE_RX.test(role)) return true;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && ti !== '') {
      const n = parseInt(ti, 10);
      if (Number.isFinite(n) && n >= 0) return true;
    }
    if (hasJsListener(el)) return true;
    if (matchesSearchKw(el)) return true;
    if (isIconSized(el)) return true;
    return false;
  };

  const isVisible = (el, rect) => {
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const cs = window.getComputedStyle(el);
    if (!cs) return true; // detached -- conservative include
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (cs.opacity === '0') return false;
    return true;
  };

  // Truncate strings for prompt budget management.
  const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '\u2026' : (s || ''));

  // Direct text content only (excludes descendant element text). This is
  // what browser_use renders as an indented child line under the element's
  // tag -- "Submit" under a [12]<button /> rather than concatenated into
  // the tag itself. textContent would pull all descendant text including
  // inner spans / icons, which would duplicate content already represented
  // by descendant interactive elements.
  const getDirectText = (el) => {
    let text = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const c = el.childNodes[i];
      if (c.nodeType === 3) text += c.nodeValue;
    }
    return truncate(text.trim().replace(/\\s+/g, ' '), 80);
  };

  // Element attributes worth surfacing to the LLM. Mirrors browser_use's
  // include_attributes default set (type, placeholder, name, role,
  // aria-label, aria-labelledby, title, alt). Returns {} when nothing
  // useful is set.
  const getRenderAttrs = (el) => {
    const attrs = {};
    const tag = el.tagName;
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      attrs.type = t;
      const ph = el.getAttribute('placeholder');
      if (ph) attrs.placeholder = truncate(ph.trim(), 80);
      const name = el.getAttribute('name');
      if (name) attrs.name = truncate(name.trim(), 80);
      const v = el.value;
      if (v) attrs.value = truncate(String(v).trim(), 80);
      // Compound-component info for range / number sliders. Mirrors
      // browser_use's compound_components: surfaces min/max/step so the
      // LLM knows the valid value range without having to introspect.
      if (t === 'range' || t === 'number') {
        const min = el.getAttribute('min');
        const max = el.getAttribute('max');
        const step = el.getAttribute('step');
        if (min) attrs.min = min;
        if (max) attrs.max = max;
        if (step) attrs.step = step;
      }
    } else if (tag === 'TEXTAREA' || tag === 'SELECT') {
      const name = el.getAttribute('name');
      if (name) attrs.name = truncate(name.trim(), 80);
      const ph = el.getAttribute('placeholder');
      if (ph) attrs.placeholder = truncate(ph.trim(), 80);
    } else if (tag === 'METER' || tag === 'PROGRESS') {
      const min = el.getAttribute('min');
      const max = el.getAttribute('max');
      const v = el.getAttribute('value');
      if (min) attrs.min = min;
      if (max) attrs.max = max;
      if (v) attrs.value = v;
    }
    const role = el.getAttribute('role');
    if (role) attrs.role = role;
    // ARIA value attributes for slider / spinbutton / progressbar / etc.
    // These reveal current/range data the LLM needs to understand the
    // widget's state.
    if (role === 'slider' || role === 'spinbutton' || role === 'progressbar') {
      const valuemin = el.getAttribute('aria-valuemin');
      const valuemax = el.getAttribute('aria-valuemax');
      const valuenow = el.getAttribute('aria-valuenow');
      const valuetext = el.getAttribute('aria-valuetext');
      if (valuemin) attrs.min = valuemin;
      if (valuemax) attrs.max = valuemax;
      if (valuenow) attrs.value = valuenow;
      if (valuetext) attrs['value-text'] = truncate(valuetext.trim(), 40);
    }
    // ARIA state for toggleable widgets
    const checked = el.getAttribute('aria-checked');
    if (checked) attrs.checked = checked;
    const expanded = el.getAttribute('aria-expanded');
    if (expanded) attrs.expanded = expanded;
    const pressed = el.getAttribute('aria-pressed');
    if (pressed) attrs.pressed = pressed;
    const selected = el.getAttribute('aria-selected');
    if (selected) attrs.selected = selected;
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) attrs['aria-label'] = truncate(ariaLabel.trim(), 80);
    // aria-labelledby resolved to text
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\\s+/).filter(Boolean);
      const parts = [];
      for (let i = 0; i < ids.length; i++) {
        const r = document.getElementById(ids[i]);
        if (r && r.textContent) parts.push(r.textContent.trim());
      }
      if (parts.length) attrs['aria-labelledby'] = truncate(parts.join(' ').replace(/\\s+/g, ' '), 80);
    }
    const title = el.getAttribute('title');
    if (title) attrs.title = truncate(title.trim(), 80);
    const alt = el.getAttribute('alt');
    if (alt) attrs.alt = truncate(alt.trim(), 80);
    return attrs;
  };


  const findTarget = (X, Y) => {
    let el = document.elementFromPoint(X, Y);
    if (!el || el.tagName === 'IFRAME' || SKIP_TAG.has(el.tagName)) return null;
    let strict = null;
    let pointer = null;
    let pointerChainBroken = false;
    let cur = el;
    let depth = 0;
    while (cur && depth < 8) {
      if (SKIP_TAG.has(cur.tagName)) break;
      if (!strict && isStrict(cur)) strict = cur;
      if (!pointerChainBroken) {
        const cs = window.getComputedStyle(cur);
        if (cs && cs.cursor === 'pointer') pointer = cur;
        else if (pointer) pointerChainBroken = true;
      }
      cur = cur.parentElement;
      depth++;
    }
    return strict || pointer;
  };

  // Recursively walk the document AND every open shadow root AND every
  // same-origin iframe, returning a flat array of {el, offsetX, offsetY}
  // entries where offsetX/Y is the cumulative top-left of the element's
  // owning viewport relative to the parent viewport. Closed shadow roots
  // and cross-origin iframes are inaccessible from page JS and skipped
  // silently. The offset lets downstream code translate iframe-local
  // bounding boxes (getBoundingClientRect returns coords relative to the
  // iframe's own viewport) back into parent-viewport coords for CDP
  // mouse-event dispatch and highlight overlays.
  const collectAllElements = (root, out, offsetX, offsetY) => {
    const els = root.querySelectorAll('*');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      out.push({ el, offsetX, offsetY });
      if (el.shadowRoot) collectAllElements(el.shadowRoot, out, offsetX, offsetY);
      if (el.tagName === 'IFRAME') {
        // Same-origin iframe: contentDocument is accessible. Cross-origin
        // throws SecurityError or returns null. Tracking the iframe's
        // own bbox lets us add it to the child offset so descendants
        // come out in parent-viewport coordinates.
        try {
          const doc = el.contentDocument;
          if (doc) {
            const r = el.getBoundingClientRect();
            collectAllElements(doc, out, offsetX + r.left, offsetY + r.top);
          }
        } catch (_) { /* cross-origin -- skip */ }
      }
    }
  };

  const isScrollable = (el) => {
    const cs = window.getComputedStyle(el);
    if (!cs) return false;
    const ov = (cs.overflow || '') + (cs.overflowX || '') + (cs.overflowY || '');
    if (!/auto|scroll/.test(ov)) return false;
    return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  };

  const shadowModeOf = (el) => {
    const root = el.getRootNode();
    return (root && root.host && root.mode) ? root.mode : null;
  };

  // Enumerate every interactive, visible, in-viewport element. Stores live
  // element references in window.__bhInteractive[idx] keyed by integer
  // index so a follow-up click_index action can look up the element by
  // name. Returns serialised metadata only. Hard-caps the result at
  // maxIndexes to keep the numbered overlay readable on pathological
  // pages (long sidebars, mega-menus, infinite-scroll pre-renders); over
  // the cap the LLM falls back to coordinate clicks for the un-indexed
  // elements.
  const enumerate = (opts) => {
    opts = opts || {};
    const onlyViewport = opts.onlyViewport !== false;
    const maxIndexes = Number.isFinite(opts.maxIndexes) ? opts.maxIndexes : 100;
    const all = [];
    collectAllElements(document, all, 0, 0);
    // Mirror browser_use's heavy-page guard: getEventListeners() iteration
    // can take 10s+ on >10k-element pages. Skip it; rely on the rest of
    // the heuristic.
    const detectListeners = all.length <= 10000 && typeof getEventListeners === 'function';
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const refs = [];
    const offsets = []; // parallel to refs -- {x, y} parent-viewport offset
    const items = [];
    const elToIdx = new Map(); // element -> numeric idx (for click_index lookup)
    let capped = false;
    for (let i = 0; i < all.length; i++) {
      const { el, offsetX, offsetY } = all[i];
        // Never the assistant's own UI.
        //
        // Anything the extension draws on the page is furniture for the
        // PERSON, not part of the site the agent is working on. Enumerating
        // it put our controls in the agent's index: in a recorded run it
        // spent ten steps trying to dismiss "the helper overlay" blocking
        // the buy box, pressed our own Got it and Leave it \u2014 which marks the
        // person's findings as dealt with \u2014 and missed once into a size
        // radio. An agent that can answer the questions meant for the person
        // is not being checked by them.
        if (el.closest && el.closest('[data-bh-ignore]')) continue;
      if (!isStrict(el)) continue;
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, rect)) continue;
      // Absolute (parent-viewport) coords for viewport filter and bbox.
      const ax = rect.left + offsetX;
      const ay = rect.top + offsetY;
      if (onlyViewport && (ax + rect.width <= 0 || ay + rect.height <= 0 || ax >= vw || ay >= vh)) continue;
      if (refs.length >= maxIndexes) { capped = true; break; }
      const idx = refs.length;
      refs.push(el);
      offsets.push({ x: offsetX, y: offsetY });
      elToIdx.set(el, idx);
      let listener = false;
      if (detectListeners) {
        try {
          const ls = getEventListeners(el);
          listener = !!(ls && (ls.click || ls.mousedown || ls.mouseup || ls.pointerdown || ls.pointerup));
        } catch (_) {}
      }
      const tag = el.tagName.toLowerCase();
      items.push({
        idx,
        id: 'i' + idx,
        kind: 'indexed',
        parent_id: null, // resolved in pass 3 below
        bbox: { x: ax, y: ay, w: rect.width, h: rect.height },
        tag,
        attrs: getRenderAttrs(el),
        text: getDirectText(el),
        hasJsListener: listener,
        scrollable: isScrollable(el),
        shadowMode: shadowModeOf(el),
        inIframe: offsetX !== 0 || offsetY !== 0,
      });
    }

    // Pass 2: detect structural containers (non-interactive grouping nodes
    // like <form>, <ul>, <table>, <nav>, etc.) that hold \u22652 indexed
    // descendants. Mirrors browser_use's behaviour where containers
    // without their own interactivity still render in the tree as
    // grouping cues so the LLM can disambiguate "which form is this
    // input in" / "which row is this cell from". Generic <div>/<span>
    // wrappers are intentionally excluded -- without a clear semantic
    // signal they'd add tree noise without grouping benefit. Iframe
    // boundaries are NOT crossed in the parent walk -- iframe-contained
    // elements form their own subtrees in the tree.
    const STRUCTURAL_TAGS = new Set([
      'FORM', 'FIELDSET',
      'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'MAIN', 'SECTION', 'ARTICLE',
      'UL', 'OL', 'DL', 'MENU',
      'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR',
      'DIALOG',
    ]);
    // Map every walked element -> its offset, so structural bbox
    // computation can convert iframe-local rects to parent-viewport.
    const elToOffset = new Map();
    for (let i = 0; i < all.length; i++) {
      elToOffset.set(all[i].el, { x: all[i].offsetX, y: all[i].offsetY });
    }
    const descCount = new Map(); // structural-eligible element -> count of indexed descendants whose nearest enumerated ancestor is this element
    for (const el of refs) {
      let cur = el.parentNode;
      while (cur) {
        if (cur.nodeType === 1) {
          if (elToIdx.has(cur)) break; // hit an interactive ancestor -- stop counting upward
          if (STRUCTURAL_TAGS.has(cur.tagName)) {
            descCount.set(cur, (descCount.get(cur) || 0) + 1);
          }
          cur = cur.parentNode;
        } else if (cur.host) {
          cur = cur.host;
        } else { break; }
      }
    }
    // Promote eligible containers to structural nodes
    const structurals = [];
    const elToSid = new Map();
    let nextSid = 0;
    for (const [el, count] of descCount) {
      if (count < 2) continue;
      const r = el.getBoundingClientRect();
      if (!isVisible(el, r)) continue;
      const off = elToOffset.get(el) || { x: 0, y: 0 };
      const sid = 's' + (nextSid++);
      elToSid.set(el, sid);
      structurals.push({
        id: sid,
        kind: 'structural',
        parent_id: null,
        tag: el.tagName.toLowerCase(),
        bbox: { x: r.left + off.x, y: r.top + off.y, w: r.width, h: r.height },
        domOrderEl: el, // temp -- used for sorting & parent resolution; stripped before return
      });
    }

    // Pass 3: resolve parent_id for items AND structurals. Walk up; the
    // nearest ancestor that's either indexed or structural becomes parent.
    const idForEl = (el) => {
      if (elToIdx.has(el)) return 'i' + elToIdx.get(el);
      if (elToSid.has(el)) return elToSid.get(el);
      return null;
    };
    const resolveParent = (el) => {
      let cur = el.parentNode;
      while (cur) {
        if (cur.nodeType === 1) {
          const id = idForEl(cur);
          if (id) return id;
          cur = cur.parentNode;
        } else if (cur.host) {
          cur = cur.host;
        } else { break; }
      }
      return null;
    };
    for (let i = 0; i < items.length; i++) {
      items[i].parent_id = resolveParent(refs[i]);
    }
    for (const s of structurals) {
      s.parent_id = resolveParent(s.domOrderEl);
    }

    // Pass 4: sort structurals into DOM order relative to items so the
    // tree-rendering downstream gets siblings in visual order. Items are
    // already in DOM order from collectAllElements; for each structural,
    // compute a (domIndex) by binary-search-ish position relative to
    // refs. Easier: pre-index every element by its position in the walk.
    const allOrder = new Map();
    for (let i = 0; i < all.length; i++) allOrder.set(all[i], i);
    structurals.sort((a, b) => (allOrder.get(a.domOrderEl) || 0) - (allOrder.get(b.domOrderEl) || 0));
    for (const s of structurals) delete s.domOrderEl;

    window.__bhInteractive = refs;
    window.__bhInteractiveOffset = offsets;
    window.__bhInteractiveStamp = Date.now();
    return {
      count: items.length,
      total: all.length,
      viewport: { w: vw, h: vh },
      items,
      structurals,
      capped,
      listenerScanSkipped: !detectListeners,
    };
  };

  return { findTarget, enumerate };
})()
`;

  // extension/browser-harness/src/harness/interactive.js
  var _BH_INTERACTIVE_SRC = page_helpers_default + ".findTarget";
  async function _bhSnapToInteractive(tabId, x, y) {
    const fallback = { x, y, snapped: false };
    const deadline = new Promise((resolve) => setTimeout(() => resolve(fallback), 3e3));
    const work = (async () => {
      const expr = `
      (() => {
        const findTarget = ${_BH_INTERACTIVE_SRC};
        const target = findTarget(${Math.round(x)}, ${Math.round(y)});
        if (!target) return null;
        // Multi-quad selection: getClientRects() returns one rect per
        // line for inline-wrapped elements (e.g. links spanning two
        // lines). The center of getBoundingClientRect() can land in dead
        // space between lines. Pick the largest quad that intersects the
        // viewport so the click lands on actual rendered content.
        const rects = target.getClientRects();
        if (!rects || rects.length === 0) {
          const br = target.getBoundingClientRect();
          if (!br || br.width <= 0 || br.height <= 0) return null;
          var cx = br.left + br.width / 2;
          var cy = br.top + br.height / 2;
        } else {
          const vw = window.innerWidth || document.documentElement.clientWidth;
          const vh = window.innerHeight || document.documentElement.clientHeight;
          let best = null;
          let bestArea = 0;
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.width <= 0 || r.height <= 0) continue;
            const x0 = Math.max(0, r.left);
            const y0 = Math.max(0, r.top);
            const x1 = Math.min(vw, r.right);
            const y1 = Math.min(vh, r.bottom);
            const visW = Math.max(0, x1 - x0);
            const visH = Math.max(0, y1 - y0);
            const area = visW * visH;
            if (area > bestArea) { bestArea = area; best = r; }
          }
          if (!best) {
            for (let i = 0; i < rects.length; i++) {
              const r = rects[i];
              if (r.width > 0 && r.height > 0) { best = r; break; }
            }
          }
          if (!best) return null;
          var cx = best.left + best.width / 2;
          var cy = best.top + best.height / 2;
        }
        // Occlusion check: confirm the topmost paint layer at (cx, cy) is
        // the target or one of its descendants. If something else is on
        // top (cookie banner, modal scrim), CDP coordinate-clicking would
        // hit the overlay, not the target. The caller routes occluded
        // clicks to the JS-click fallback (target.click()) which bypasses
        // hit-testing.
        let occluded = false;
        try {
          const topmost = document.elementFromPoint(cx, cy);
          if (topmost && !target.contains(topmost)) occluded = true;
        } catch (_) {}
        const role = target.getAttribute('role') || null;
        const tag = target.tagName;
        // Approximate which tier matched -- only used for logging.
        const STRICT_TAGS = /^(A|BUTTON|SELECT|TEXTAREA|OPTION|OPTGROUP|SUMMARY|DETAILS|AREA|MAP|INPUT|LABEL|SPAN)$/;
        const role_rx = /^(button|link|tab|menuitem|checkbox|radio|switch|option|combobox|menuitemcheckbox|menuitemradio|treeitem|listbox|textbox|slider|spinbutton|search|searchbox|row|cell|gridcell)$/i;
        const hasEventAttr = ['onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup'].some(a => target.hasAttribute(a));
        const isStrictGuess = STRICT_TAGS.test(tag) || hasEventAttr || (role && role_rx.test(role)) || target.isContentEditable;
        return { cx, cy, tag, role, via: isStrictGuess ? 'strict' : 'pointer', occluded };
      })()
    `;
      try {
        const r = await bhCdp(
          tabId,
          "Runtime.evaluate",
          { expression: expr, returnByValue: true, includeCommandLineAPI: true },
          { timeoutMs: 1500 }
        );
        if (r && r.exceptionDetails) return await _bhAxFallback(tabId, x, y) || fallback;
        const v = r && r.result && r.result.value;
        if (v && Number.isFinite(v.cx) && Number.isFinite(v.cy)) {
          return {
            x: v.cx,
            y: v.cy,
            snapped: true,
            tag: v.tag,
            role: v.role,
            via: v.via,
            occluded: !!v.occluded
          };
        }
        const ax = await _bhAxFallback(tabId, x, y);
        return ax || fallback;
      } catch {
        const ax = await _bhAxFallback(tabId, x, y);
        return ax || fallback;
      }
    })();
    return Promise.race([work, deadline]);
  }
  async function _bhAxFallback(tabId, x, y) {
    let leafBackendNodeId;
    try {
      const r = await bhCdp(
        tabId,
        "DOM.getNodeForLocation",
        { x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false },
        { timeoutMs: 1e3 }
      );
      leafBackendNodeId = r && r.backendNodeId;
    } catch {
      return null;
    }
    if (!leafBackendNodeId) return null;
    let axNodes;
    try {
      const r = await bhCdp(
        tabId,
        "Accessibility.getAXNodeAndAncestors",
        { backendNodeId: leafBackendNodeId },
        { timeoutMs: 1500 }
      );
      axNodes = r && r.nodes;
    } catch {
      return null;
    }
    if (!axNodes || !axNodes.length) return null;
    for (const ax of axNodes) {
      if (!ax || ax.ignored) continue;
      const role = ax.role && ax.role.value;
      if (!role || !_BH_AX_INTERACTIVE_ROLES.has(role)) continue;
      const bnid = ax.backendDOMNodeId;
      if (!bnid) continue;
      try {
        const box = await bhCdp(
          tabId,
          "DOM.getBoxModel",
          { backendNodeId: bnid },
          { timeoutMs: 1e3 }
        );
        const m = box && box.model && box.model.content;
        if (m && m.length >= 8) {
          const cx = (m[0] + m[2] + m[4] + m[6]) / 4;
          const cy = (m[1] + m[3] + m[5] + m[7]) / 4;
          return {
            x: cx,
            y: cy,
            snapped: true,
            tag: "AX",
            role,
            via: "ax",
            occluded: false
            // AX path doesn't compute occlusion; click and see
          };
        }
      } catch {
      }
    }
    return null;
  }
  async function _bhJsClickFallback(tabId, x, y) {
    const expr = `
    (() => {
      try {
        const findTarget = ${_BH_INTERACTIVE_SRC};
        const target = findTarget(${Math.round(x)}, ${Math.round(y)});
        if (!target || typeof target.click !== 'function') return false;
        target.click();
        return true;
      } catch (_) { return false; }
    })()
  `;
    try {
      const r = await bhCdp(
        tabId,
        "Runtime.evaluate",
        { expression: expr, returnByValue: true, includeCommandLineAPI: true },
        { timeoutMs: 2e3 }
      );
      return !!(r && r.result && r.result.value === true);
    } catch {
      return false;
    }
  }
  async function _bhEnumerateCrossOriginFrames(tabId) {
    let parentOrigin = null;
    try {
      const t = await chrome.tabs.get(tabId);
      if (t && t.url) parentOrigin = new URL(t.url).origin;
    } catch (_) {
    }
    let targets;
    try {
      const r = await bhCdp(tabId, "Target.getTargets", {}, { timeoutMs: 1500 });
      targets = r && r.targetInfos || [];
    } catch (_) {
      return [];
    }
    const out = [];
    for (const t of targets) {
      if (t.type !== "iframe") continue;
      if (!t.url) continue;
      let frameOrigin = null;
      try {
        frameOrigin = new URL(t.url).origin;
      } catch (_) {
        continue;
      }
      if (parentOrigin && frameOrigin === parentOrigin) continue;
      let frameOffset = null;
      try {
        const ownerInfo = await bhCdp(tabId, "Page.getFrameOwner", { frameId: t.targetId }, { timeoutMs: 1e3 });
        const bnid = ownerInfo && ownerInfo.backendNodeId;
        if (!bnid) continue;
        const box = await bhCdp(tabId, "DOM.getBoxModel", { backendNodeId: bnid }, { timeoutMs: 1e3 });
        const m = box && box.model && box.model.content;
        if (m && m.length >= 8) {
          frameOffset = { x: m[0], y: m[1] };
        }
      } catch (_) {
        continue;
      }
      if (!frameOffset) continue;
      if (!BH_ATTACHED.has(t.targetId)) {
        try {
          await chrome.debugger.attach({ targetId: t.targetId }, BH_DEBUGGER_VERSION);
          BH_ATTACHED.add(t.targetId);
          for (const d of ["Runtime", "DOM", "Page"]) {
            try {
              await _bhSendCmd({ targetId: t.targetId }, `${d}.enable`);
            } catch {
            }
          }
        } catch (_) {
          continue;
        }
      }
      let frameResult = null;
      try {
        const expr = `${page_helpers_default}.enumerate({ onlyViewport: false, maxIndexes: 50 })`;
        const r = await _bhSendCmd(
          { targetId: t.targetId },
          "Runtime.evaluate",
          { expression: expr, returnByValue: true, includeCommandLineAPI: true },
          3e3
        );
        if (r && !r.exceptionDetails) {
          frameResult = r && r.result && r.result.value;
        }
      } catch (_) {
        continue;
      }
      if (!frameResult || !Array.isArray(frameResult.items)) continue;
      for (const it of frameResult.items) {
        const px = it.bbox.x + frameOffset.x;
        const py = it.bbox.y + frameOffset.y;
        out.push({
          ...it,
          bbox: { x: px, y: py, w: it.bbox.w, h: it.bbox.h },
          crossOrigin: true,
          targetId: t.targetId,
          frameLocalIdx: it.idx
        });
      }
    }
    return out;
  }
  async function bhEnumerateInteractive(tabId, opts = {}) {
    await bhAttach(tabId);
    const onlyViewport = opts.onlyViewport !== false;
    const expr = `${page_helpers_default}.enumerate({ onlyViewport: ${onlyViewport ? "true" : "false"} })`;
    let result;
    try {
      const r = await bhCdp(
        tabId,
        "Runtime.evaluate",
        { expression: expr, returnByValue: true, includeCommandLineAPI: true },
        { timeoutMs: 5e3 }
      );
      if (r && r.exceptionDetails) {
        const msg = r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || "enumerate failed";
        console.warn("[BrowserHarness] enumerate exception:", msg);
        return null;
      }
      result = r && r.result && r.result.value;
      if (!result) return null;
    } catch (e) {
      console.warn("[BrowserHarness] enumerate failed:", e.message);
      return null;
    }
    let crossItems = [];
    try {
      crossItems = await _bhEnumerateCrossOriginFrames(tabId);
    } catch (e) {
      console.warn("[BrowserHarness] cross-origin enumerate failed:", e.message);
    }
    if (crossItems.length) {
      const baseIdx = result.items.length;
      const placeholders = [];
      for (let i = 0; i < crossItems.length; i++) {
        const ci = crossItems[i];
        const idx = baseIdx + i;
        ci.idx = idx;
        ci.id = "i" + idx;
        ci.kind = "indexed";
        ci.parent_id = null;
        ci.inIframe = true;
        result.items.push(ci);
        placeholders.push({
          __crossOrigin: true,
          bbox: ci.bbox,
          tag: ci.tag,
          role: ci.attrs && ci.attrs.role || null
        });
      }
      const padExpr = `(() => {
      const a = window.__bhInteractive || [];
      const p = ${JSON.stringify(placeholders)};
      for (let i = 0; i < p.length; i++) a.push(p[i]);
      window.__bhInteractive = a;
      const o = window.__bhInteractiveOffset || [];
      for (let i = 0; i < p.length; i++) o.push({x:0, y:0});
      window.__bhInteractiveOffset = o;
      return a.length;
    })()`;
      try {
        await bhCdp(tabId, "Runtime.evaluate", { expression: padExpr, returnByValue: true }, { timeoutMs: 1500 });
      } catch (e) {
        console.warn("[BrowserHarness] cross-origin pad failed:", e.message);
      }
      result.crossOriginCount = crossItems.length;
    }
    if (Array.isArray(result.items)) _BH_LAST_ITEMS.set(tabId, result.items);
    return result;
  }

  // extension/browser-harness/src/harness/runtime.js
  function _bhDecodeUnserializable(v) {
    if (v === "NaN") return NaN;
    if (v === "Infinity") return Infinity;
    if (v === "-Infinity") return -Infinity;
    if (v === "-0") return -0;
    if (typeof v === "string" && /^-?\d+n$/.test(v)) {
      try {
        return BigInt(v.slice(0, -1));
      } catch {
        return v;
      }
    }
    return v;
  }
  async function bhJs(tabId, expression, { iframeTargetId = null } = {}) {
    let send;
    if (iframeTargetId) {
      if (!BH_ATTACHED.has(iframeTargetId)) {
        await chrome.debugger.attach({ targetId: iframeTargetId }, BH_DEBUGGER_VERSION);
        BH_ATTACHED.add(iframeTargetId);
      }
      const target = { targetId: iframeTargetId };
      send = (method, params) => _bhSendCmd(target, method, params);
    } else {
      await bhAttach(tabId);
      send = (method, params) => bhCdp(tabId, method, params);
    }
    let exp = expression;
    if (/\breturn\b/.test(exp) && !exp.trim().startsWith("(")) {
      exp = `(function(){${exp}})()`;
    }
    const r = await send("Runtime.evaluate", {
      expression: exp,
      returnByValue: true,
      awaitPromise: true
    });
    if (r && r.exceptionDetails) {
      const msg = r.exceptionDetails.exception?.description || r.exceptionDetails.text || "js evaluation failed";
      throw new Error(msg);
    }
    if (r && r.result) {
      if ("value" in r.result) return r.result.value;
      if ("unserializableValue" in r.result) return _bhDecodeUnserializable(r.result.unserializableValue);
    }
    return void 0;
  }
  async function bhIframeTarget(tabId, urlSubstr) {
    await bhAttach(tabId);
    const r = await bhCdp(tabId, "Target.getTargets");
    for (const t of r.targetInfos || []) {
      if (t.type === "iframe" && (t.url || "").includes(urlSubstr)) {
        return t.targetId;
      }
    }
    return null;
  }
  async function bhDispatchKey(tabId, selector, key = "Enter", event = "keypress") {
    const kc = key in BH_KC ? BH_KC[key] : key.length === 1 ? key.charCodeAt(0) : 0;
    const sel = JSON.stringify(selector);
    const k = JSON.stringify(key);
    const ev = JSON.stringify(event);
    await bhJs(
      tabId,
      `(()=>{const e=document.querySelector(${sel});if(e){e.focus();e.dispatchEvent(new KeyboardEvent(${ev},{key:${k},code:${k},keyCode:${kc},which:${kc},bubbles:true}));}})()`
    );
  }
  async function bhUploadFile(tabId, selector, files) {
    await bhAttach(tabId);
    const doc = await bhCdp(tabId, "DOM.getDocument", { depth: -1 });
    const { nodeId } = await bhCdp(tabId, "DOM.querySelector", { nodeId: doc.root.nodeId, selector });
    if (!nodeId) throw new Error(`no element for ${selector}`);
    await bhCdp(tabId, "DOM.setFileInputFiles", {
      files: Array.isArray(files) ? files : [files],
      nodeId
    });
  }
  async function bhHttpGet(url, headers = null) {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers || {} } });
    return await r.text();
  }

  // extension/browser-harness/src/harness/wait.js
  function bhWait(ms = 1e3) {
    return new Promise((r) => setTimeout(r, ms));
  }
  async function bhWaitForLoad(tabId, { timeoutMs = 15e3 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await bhJs(tabId, "document.readyState") === "complete") return true;
      } catch {
      }
      await bhWait(300);
    }
    return false;
  }
  async function bhWaitForElement(tabId, selector, { timeoutMs = 1e4, visible = false } = {}) {
    await bhAttach(tabId);
    const sel = JSON.stringify(selector);
    const check = visible ? `(()=>{const e=document.querySelector(${sel});if(!e)return false;if(typeof e.checkVisibility==='function')return e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'})()` : `!!document.querySelector(${sel})`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await bhJs(tabId, check)) return true;
      } catch {
      }
      await bhWait(300);
    }
    return false;
  }
  async function bhWaitForNetworkIdle(tabId, { timeoutMs = 1e4, idleMs = 500 } = {}) {
    await bhAttach(tabId);
    bhDrainEvents(tabId);
    const deadline = Date.now() + timeoutMs;
    let lastActivity = Date.now();
    const inflight = /* @__PURE__ */ new Set();
    while (Date.now() < deadline) {
      for (const e of bhDrainEvents(tabId)) {
        if (e.method === "Network.requestWillBeSent") {
          inflight.add(e.params && e.params.requestId);
          lastActivity = Date.now();
        } else if (e.method === "Network.loadingFinished" || e.method === "Network.loadingFailed") {
          inflight.delete(e.params && e.params.requestId);
          lastActivity = Date.now();
        } else if (e.method.startsWith("Network.")) {
          lastActivity = Date.now();
        }
      }
      if (inflight.size === 0 && Date.now() - lastActivity >= idleMs) return true;
      await bhWait(100);
    }
    return false;
  }

  // extension/browser-harness/src/harness/input.js
  async function bhClickAt(tabId, x, y, opts = {}) {
    const button = opts.button || "left";
    const clicks = opts.clicks || 1;
    const wantSnap = opts.snap !== false;
    await bhAttach(tabId);
    const snap = wantSnap ? await _bhSnapToInteractive(tabId, x, y) : { x, y, snapped: false };
    const cx = snap.x;
    const cy = snap.y;
    if (snap.snapped && snap.occluded && opts.fallback !== false) {
      snap.fallback = await _bhJsClickFallback(tabId, cx, cy);
      return snap;
    }
    let pressFailed = false;
    let releaseFailed = false;
    try {
      await bhCdp(
        tabId,
        "Input.dispatchMouseEvent",
        { type: "mouseMoved", x: cx, y: cy },
        { timeoutMs: 3e3 }
      );
    } catch (e) {
    }
    await bhWait(50);
    try {
      await bhCdp(
        tabId,
        "Input.dispatchMouseEvent",
        { type: "mousePressed", x: cx, y: cy, button, clickCount: clicks },
        { timeoutMs: 3e3 }
      );
      await bhWait(50);
    } catch (e) {
      pressFailed = true;
    }
    try {
      await bhCdp(
        tabId,
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", x: cx, y: cy, button, clickCount: clicks },
        { timeoutMs: 5e3 }
      );
    } catch (e) {
      releaseFailed = true;
    }
    if (pressFailed && releaseFailed && snap.snapped && opts.fallback !== false) {
      snap.fallback = await _bhJsClickFallback(tabId, cx, cy);
    }
    return snap;
  }
  async function bhTypeText(tabId, text) {
    await bhAttach(tabId);
    await bhCdp(tabId, "Input.insertText", { text });
  }
  async function bhPressKey(tabId, key, modifiers = 0) {
    await bhAttach(tabId);
    const entry = BH_KEYS[key] || [
      key.length === 1 ? key.charCodeAt(0) : 0,
      key,
      key.length === 1 ? key : ""
    ];
    const [vk, code, text] = entry;
    const base = { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await bhCdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...base });
    if (text && text.length === 1) {
      await bhCdp(tabId, "Input.dispatchKeyEvent", { type: "char", text, ...base });
    }
    await bhCdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  async function bhScroll(tabId, x, y, dy = -300, dx = 0) {
    await bhAttach(tabId);
    await bhCdp(tabId, "Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: dx, deltaY: dy });
  }
  async function bhFillInput(tabId, selector, text, { clearFirst = true, timeoutMs = 0 } = {}) {
    if (timeoutMs > 0) {
      if (!await bhWaitForElement(tabId, selector, { timeoutMs })) {
        throw new Error(`fill_input: element not found: ${selector}`);
      }
    }
    await bhAttach(tabId);
    const sel = JSON.stringify(selector);
    const focused = await bhJs(
      tabId,
      `(()=>{const e=document.querySelector(${sel});if(!e)return false;e.focus();return true})()`
    );
    if (!focused) throw new Error(`fill_input: element not found: ${selector}`);
    if (clearFirst) {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator && navigator.userAgent || "");
      const mods = isMac ? 4 : 2;
      const selectAll = {
        key: "a",
        code: "KeyA",
        modifiers: mods,
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65
      };
      await bhCdp(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...selectAll });
      await bhCdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...selectAll });
      await bhPressKey(tabId, "Backspace");
    }
    for (const ch of text) {
      await bhPressKey(tabId, ch);
    }
    await bhJs(
      tabId,
      `(()=>{const e=document.querySelector(${sel});if(!e)return;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`
    );
  }

  // extension/browser-harness/src/harness/ax-render.js
  var SKIP_ROLES = /* @__PURE__ */ new Set([
    "none",
    "presentation",
    "generic",
    "InlineTextBox",
    "LineBreak"
  ]);
  var val = (p) => p && p.value !== void 0 ? p.value : void 0;
  function axProp(node, name) {
    const hit = (node.properties || []).find((p) => p.name === name);
    return hit ? val(hit.value) : void 0;
  }
  function bhRenderAx(nodes, opts = {}) {
    const { url = null, maxDepth = 40 } = opts;
    if (!nodes || !nodes.length) return url ? `URL: ${url}
` : "";
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const root = nodes.find((n) => !n.parentId) || nodes[0];
    const out = [];
    if (url) out.push(`URL: ${url}`, "");
    const walk = (node, depth) => {
      if (!node || depth > maxDepth) return;
      const role = val(node.role);
      const name = val(node.name);
      const skip = node.ignored === true || !role || SKIP_ROLES.has(role);
      if (!skip) {
        const level = axProp(node, "level");
        const suffix = level !== void 0 ? ` [level=${level}]` : "";
        const text = name ? ` "${name}"` : "";
        out.push(`${"  ".repeat(depth)}- ${role}${text}${suffix}`);
      }
      for (const id of node.childIds || []) {
        walk(byId.get(id), skip ? depth : depth + 1);
      }
    };
    walk(root, 0);
    return out.join("\n") + "\n";
  }

  // extension/browser-harness/src/harness/ax.js
  var AX_TIMEOUT_MS = 8e3;
  async function bhAxTree(tabId) {
    try {
      await bhCdp(tabId, "Accessibility.enable", {}, { timeoutMs: 2e3 });
    } catch {
    }
    try {
      const r = await bhCdp(
        tabId,
        "Accessibility.getFullAXTree",
        {},
        { timeoutMs: AX_TIMEOUT_MS }
      );
      return r && r.nodes || [];
    } catch {
      return [];
    }
  }
  async function bhAxSnapshot(tabId, opts = {}) {
    const nodes = await bhAxTree(tabId);
    let url = opts.url || null;
    if (!url) {
      try {
        const info = await bhCdp(
          tabId,
          "Runtime.evaluate",
          { expression: "location.href", returnByValue: true },
          { timeoutMs: 1500 }
        );
        url = info?.result?.value || null;
      } catch {
      }
    }
    return { url, text: bhRenderAx(nodes, { ...opts, url }), nodeCount: nodes.length };
  }

  // extension/browser-harness/src/harness/actions/stale-recovery.js
  async function _bhResolveStaleByIdentity(tabId, idx) {
    const lastItems = _BH_LAST_ITEMS.get(tabId);
    if (!lastItems || !Array.isArray(lastItems) || idx >= lastItems.length) return null;
    const lastTarget = lastItems[idx];
    if (!lastTarget || !lastTarget.tag) return null;
    let fresh;
    try {
      fresh = await bhEnumerateInteractive(tabId);
    } catch {
      return null;
    }
    if (!fresh || !Array.isArray(fresh.items)) return null;
    const role = lastTarget.attrs && lastTarget.attrs.role || "";
    const text = (lastTarget.text || "").trim();
    const candidates = fresh.items.filter((it) => {
      if (it.tag !== lastTarget.tag) return false;
      const cr = it.attrs && it.attrs.role || "";
      if (cr !== role) return false;
      const ct = (it.text || "").trim();
      if (ct !== text) return false;
      return true;
    });
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0].idx;
    if (!lastTarget.bbox) return candidates[0].idx;
    const ox = lastTarget.bbox.x + lastTarget.bbox.w / 2;
    const oy = lastTarget.bbox.y + lastTarget.bbox.h / 2;
    let chosen = candidates[0];
    let bestDist = Infinity;
    for (const c of candidates) {
      if (!c.bbox) continue;
      const cx = c.bbox.x + c.bbox.w / 2;
      const cy = c.bbox.y + c.bbox.h / 2;
      const d = Math.abs(cx - ox) + Math.abs(cy - oy);
      if (d < bestDist) {
        bestDist = d;
        chosen = c;
      }
    }
    return chosen.idx;
  }
  async function _bhWithStaleRecovery(tabId, idx, opts, label, fn) {
    const o = opts || {};
    if (o._recovered) return await fn(idx, o);
    try {
      return await fn(idx, o);
    } catch (e) {
      if (!/stale_index|stale_element/i.test(e.message || "")) throw e;
      const newIdx = await _bhResolveStaleByIdentity(tabId, idx);
      if (newIdx === null || newIdx === idx) throw e;
      console.log(`[BrowserHarness] ${label}: stale idx ${idx} -> recovered to ${newIdx}`);
      const r = await fn(newIdx, { ...o, _recovered: true });
      if (r && typeof r === "object") {
        r.recoveredFromIdx = idx;
        r.recoveredToIdx = newIdx;
      }
      return r;
    }
  }

  // extension/browser-harness/src/harness/actions/click.js
  async function _bhJsClickIndex(tabId, idx) {
    const expr = `
    (() => {
      try {
        const arr = window.__bhInteractive;
        if (!Array.isArray(arr) || ${idx} >= arr.length) return false;
        const el = arr[${idx}];
        if (!el || !el.isConnected || typeof el.click !== 'function') return false;
        el.click();
        return true;
      } catch (_) { return false; }
    })()
  `;
    try {
      const r = await bhCdp(
        tabId,
        "Runtime.evaluate",
        { expression: expr, returnByValue: true },
        { timeoutMs: 2e3 }
      );
      return !!(r && r.result && r.result.value === true);
    } catch {
      return false;
    }
  }
  async function bhClickIndex(tabId, idx, opts = {}) {
    return await _bhWithStaleRecovery(
      tabId,
      idx,
      opts,
      "click_index",
      (i, o) => _bhClickIndexCore(tabId, i, o)
    );
  }
  async function _bhClickIndexCore(tabId, idx, opts = {}) {
    await bhAttach(tabId);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`click_index: invalid index ${idx}`);
    }
    const expr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      // Cross-origin iframe placeholder: parent JS can't access the real
      // element. The bbox is parent-viewport already; CDP click at center
      // routes through the OOPIF at compositor level. Skip all the
      // page-side machinery (occlusion check, toggle pre-state, etc.) --
      // they'd all need per-frame eval which we don't do for click.
      if (el.__crossOrigin && el.bbox) {
        return {
          cx: el.bbox.x + el.bbox.w / 2,
          cy: el.bbox.y + el.bbox.h / 2,
          tag: el.tag || 'CROSS_ORIGIN',
          role: el.role || null,
          occluded: false,
          isToggle: false,
          toggleKind: null,
          preChecked: null,
          crossOrigin: true,
        };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      // Tag-type validation. Mirrors browser_use _click_element_node_impl
      // pre-click checks: clicking a <select> opens its native picker
      // which CDP can't dismiss reliably; clicking <input type=file> opens
      // a file chooser dialog. Route the LLM to purpose-built actions
      // instead and surface the hint in the error message.
      const tag = el.tagName;
      if (tag === 'SELECT') {
        return { error: 'wrong_action', hint: 'use dropdown_options(' + ${idx} + ') to read options or select_dropdown(' + ${idx} + ', "...") to pick one. Clicking a <select> opens the native picker which the agent cannot interact with.' };
      }
      if (tag === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'file') {
        return { error: 'wrong_action', hint: 'use upload_file(' + ${idx} + ', path) to attach a file. Clicking a <input type=file> opens the OS file chooser which the agent cannot interact with.' };
      }
      // Print-button detection. Buttons that call window.print() open a
      // blocking system dialog the agent cannot dismiss. Mirrors
      // browser_use's auto-PDF logic: signal the caller so it can skip
      // the click and generate a PDF via Page.printToPDF instead.
      const onclick = el.getAttribute('onclick') || '';
      if (/(^|[^a-zA-Z_$])print\\s*\\(/.test(onclick) || /window\\.print\\s*\\(/.test(onclick)) {
        return { error: 'print_intercept' };
      }
      // Bring into viewport if needed -- the LLM picked an idx visible at
      // enumerate-time; the page may have shifted since.
      try {
        const r0 = el.getBoundingClientRect();
        const vw0 = window.innerWidth || document.documentElement.clientWidth;
        const vh0 = window.innerHeight || document.documentElement.clientHeight;
        if (r0.bottom < 0 || r0.top > vh0 || r0.right < 0 || r0.left > vw0) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
      } catch (_) {}
      const rects = el.getClientRects();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      let best = null;
      let bestArea = 0;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width <= 0 || r.height <= 0) continue;
        const x0 = Math.max(0, r.left);
        const y0 = Math.max(0, r.top);
        const x1 = Math.min(vw, r.right);
        const y1 = Math.min(vh, r.bottom);
        const visW = Math.max(0, x1 - x0);
        const visH = Math.max(0, y1 - y0);
        const area = visW * visH;
        if (area > bestArea) { bestArea = area; best = r; }
      }
      if (!best) {
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r.width > 0 && r.height > 0) { best = r; break; }
        }
      }
      if (!best) {
        const br = el.getBoundingClientRect();
        if (br && br.width > 0 && br.height > 0) {
          best = br;
        } else {
          return { error: 'no_geometry' };
        }
      }
      // Offset translates iframe-local coords to parent-viewport coords.
      // For elements in the parent doc, offset is (0, 0).
      const offsetArr = window.__bhInteractiveOffset || [];
      const off = offsetArr[${idx}] || { x: 0, y: 0 };
      const cx = best.left + best.width / 2 + off.x;
      const cy = best.top + best.height / 2 + off.y;
      // Occlusion check. document.elementFromPoint is a parent-viewport
      // query, so for iframe-contained elements (off.x|y != 0) it would
      // return the iframe element rather than walking inside. Skip the
      // check rather than false-positive on every iframe click; CDP
      // mouse-event dispatch still routes correctly through the iframe.
      let occluded = false;
      if (off.x === 0 && off.y === 0) {
        try {
          const topmost = document.elementFromPoint(cx, cy);
          if (topmost && !el.contains(topmost)) occluded = true;
        } catch (_) {}
      }
      // Toggle pre-state. For checkbox/radio (native or ARIA) we want to
      // verify the click actually flipped state -- CDP mouse events
      // sometimes don't toggle (framework intercepts e.preventDefault(),
      // or label proxies). isToggleNative reads .checked; isToggleAria
      // reads aria-checked; either path returns a bool snapshot.
      let isToggle = false;
      let toggleKind = null; // 'native' | 'aria'
      let preChecked = null;
      const tagName = el.tagName;
      const inputType = (el.getAttribute('type') || '').toLowerCase();
      const role = el.getAttribute('role');
      const ARIA_TOGGLE_ROLES = ['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'];
      if (tagName === 'INPUT' && (inputType === 'checkbox' || inputType === 'radio')) {
        isToggle = true;
        toggleKind = 'native';
        try { preChecked = !!el.checked; } catch (_) {}
      } else if (role && ARIA_TOGGLE_ROLES.indexOf(role) >= 0) {
        isToggle = true;
        toggleKind = 'aria';
        // aria-checked is "true" / "false" / "mixed". Treat anything
        // truthy-stringy as checked. "mixed" is its own value but flips
        // on click like a tristate; comparing pre vs post still works.
        const ac = el.getAttribute('aria-checked');
        preChecked = ac === null ? null : ac;
      }
      return {
        cx, cy,
        tag: tagName,
        role: role || null,
        occluded,
        isToggle,
        toggleKind,
        preChecked,
      };
    })()
  `;
    let v;
    try {
      const r = await bhCdp(
        tabId,
        "Runtime.evaluate",
        { expression: expr, returnByValue: true },
        { timeoutMs: 2e3 }
      );
      if (r && r.exceptionDetails) {
        throw new Error("click_index: page-side eval threw");
      }
      v = r && r.result && r.result.value;
    } catch (e) {
      throw new Error(`click_index: ${e.message}`);
    }
    if (!v || v.error) {
      if (v && v.error === "wrong_action") {
        throw new Error(`click_index: ${v.hint}`);
      }
      if (v && v.error === "print_intercept") {
        try {
          const pdf = await bhCdp(tabId, "Page.printToPDF", {}, { timeoutMs: 15e3 });
          return {
            x: NaN,
            y: NaN,
            snapped: false,
            indexed: idx,
            tag: "PRINT_BUTTON",
            role: null,
            via: "print_intercept",
            printPdfBase64: pdf && pdf.data || null
          };
        } catch (e) {
          throw new Error(`click_index: print intercept failed (${e.message}); the agent cannot interact with the system print dialog`);
        }
      }
      const reason = v && v.error || "unknown";
      throw new Error(`click_index: ${idx} ${reason} (re-enumerate)`);
    }
    if (v.occluded && opts.fallback !== false) {
      const ok = await _bhJsClickIndex(tabId, idx);
      return {
        x: v.cx,
        y: v.cy,
        snapped: true,
        indexed: idx,
        tag: v.tag,
        role: v.role,
        via: "index",
        occluded: true,
        fallback: ok
      };
    }
    const click = await bhClickAt(tabId, v.cx, v.cy, { ...opts, snap: false });
    let toggleVerified = null;
    if (v.isToggle && v.preChecked !== null && opts.fallback !== false) {
      try {
        const useAria = v.toggleKind === "aria";
        const readExpr = useAria ? "el.getAttribute('aria-checked')" : "!!el.checked";
        const verifyExpr = `
        (() => {
          const arr = window.__bhInteractive;
          if (!Array.isArray(arr) || ${idx} >= arr.length) return null;
          const el = arr[${idx}];
          if (!el || !el.isConnected) return null;
          return { post: ${readExpr} };
        })()
      `;
        const r = await bhCdp(tabId, "Runtime.evaluate", { expression: verifyExpr, returnByValue: true }, { timeoutMs: 1500 });
        const post = r && r.result && r.result.value ? r.result.value.post : void 0;
        const sameState = post === v.preChecked;
        if (sameState) {
          const ok = await _bhJsClickIndex(tabId, idx);
          toggleVerified = ok ? "js_fallback" : "unchanged";
        } else {
          toggleVerified = "flipped";
        }
      } catch (_) {
        toggleVerified = "verify_failed";
      }
    }
    return {
      ...click,
      snapped: true,
      indexed: idx,
      tag: v.tag,
      role: v.role,
      via: "index",
      toggleVerified
    };
  }

  // extension/browser-harness/src/harness/actions/type.js
  async function bhTypeIndex(tabId, idx, text, opts = {}) {
    return await _bhWithStaleRecovery(
      tabId,
      idx,
      opts,
      "type_index",
      (i, o) => _bhTypeIndexCore(tabId, i, text, o)
    );
  }
  async function _bhTypeIndexCore(tabId, idx, text, opts = {}) {
    await bhAttach(tabId);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`type_index: invalid index ${idx}`);
    }
    if (typeof text !== "string") text = String(text == null ? "" : text);
    const clearFirst = opts.clear !== false;
    const focusExpr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      if (el.__crossOrigin) {
        return { error: 'wrong_action', hint: 'type_index does not work in cross-origin iframes (parent JS cannot access them). Only click_index is supported on cross-origin elements. To type, navigate the agent\\'s tab directly to the iframe\\'s URL.' };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      const tag = el.tagName;
      const t = (el.getAttribute('type') || '').toLowerCase();
      // Reject obvious non-text elements with a hint.
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el.isContentEditable && el.getAttribute('role') !== 'textbox' && el.getAttribute('role') !== 'searchbox' && el.getAttribute('role') !== 'combobox') {
        return { error: 'wrong_action', hint: 'type_index target is <' + tag.toLowerCase() + '> -- only INPUT, TEXTAREA, contentEditable, or role=textbox/searchbox/combobox accept text. Use click_index for buttons / links.' };
      }
      if (tag === 'INPUT' && (t === 'checkbox' || t === 'radio' || t === 'button' || t === 'submit' || t === 'file' || t === 'hidden')) {
        return { error: 'wrong_action', hint: 'type_index does not work on <input type=' + t + '>. Use click_index for checkbox/radio/button/submit, or upload_file for type=file.' };
      }
      // Bring into viewport and focus.
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      try { el.focus(); } catch (_) {}
      // Clear via direct property assignment for inputs/textareas; for
      // contentEditable use Selection API. The Cmd/Ctrl+A + Backspace
      // path the LLM might emit through fill_input is nondeterministic
      // across keyboard layouts; doing it page-side is more reliable.
      if (${clearFirst}) {
        try {
          if (tag === 'INPUT' || tag === 'TEXTAREA') {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (el.isContentEditable) {
            el.textContent = '';
          }
        } catch (_) {}
      }
      return { tag, type: t, isContentEditable: !!el.isContentEditable };
    })()
  `;
    let v;
    try {
      const r = await bhCdp(tabId, "Runtime.evaluate", { expression: focusExpr, returnByValue: true }, { timeoutMs: 1500 });
      v = r && r.result && r.result.value;
    } catch (e) {
      throw new Error(`type_index: ${e.message}`);
    }
    if (!v) throw new Error(`type_index: ${idx} (no result)`);
    if (v.error === "wrong_action") throw new Error(`type_index: ${v.hint}`);
    if (v.error) throw new Error(`type_index: ${idx} ${v.error} (re-enumerate)`);
    for (const ch of text) {
      await bhPressKey(tabId, ch);
    }
    const finishExpr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return null;
      const el = arr[${idx}];
      if (!el || !el.isConnected) return null;
      try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
      const value = (el.value !== undefined) ? el.value : (el.textContent || '');
      return { value: typeof value === 'string' ? value.slice(0, 200) : '' };
    })()
  `;
    let finalValue = "";
    try {
      const r = await bhCdp(tabId, "Runtime.evaluate", { expression: finishExpr, returnByValue: true }, { timeoutMs: 1500 });
      if (r && r.result && r.result.value) finalValue = r.result.value.value || "";
    } catch (_) {
    }
    return {
      indexed: idx,
      tag: v.tag,
      type: v.type,
      cleared: clearFirst,
      value: finalValue
    };
  }

  // extension/browser-harness/src/harness/actions/dropdown.js
  async function bhDropdownOptions(tabId, idx, opts = {}) {
    return await _bhWithStaleRecovery(
      tabId,
      idx,
      opts,
      "dropdown_options",
      (i, o) => _bhDropdownOptionsCore(tabId, i, o)
    );
  }
  async function _bhDropdownOptionsCore(tabId, idx, _opts) {
    await bhAttach(tabId);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`dropdown_options: invalid index ${idx}`);
    }
    const expr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      if (el.__crossOrigin) {
        return { error: 'wrong_action', hint: 'dropdown_options does not work in cross-origin iframes (parent JS cannot access them). Only click_index is supported on cross-origin elements.' };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      const tag = el.tagName;
      const role = el.getAttribute('role') || '';
      // Native <select>: iterate .options[].
      if (tag === 'SELECT') {
        const opts = [];
        for (let i = 0; i < el.options.length; i++) {
          const o = el.options[i];
          opts.push({
            idx: i,
            text: (o.textContent || '').trim().slice(0, 120),
            value: o.value,
            selected: !!o.selected,
            disabled: !!o.disabled,
          });
        }
        return { kind: 'native', tag, options: opts, multiple: !!el.multiple };
      }
      // ARIA: role=listbox / combobox / menu / etc. Look for child option
      // descendants. aria-controls is the usual idiom for combobox->listbox.
      let optionRoot = null;
      if (role === 'listbox' || role === 'menu' || role === 'tree' || role === 'grid') {
        optionRoot = el;
      } else if (role === 'combobox' || role === 'searchbox') {
        // combobox: look at aria-controls / aria-owns
        const controls = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
        if (controls) {
          for (const id of controls.split(/\\s+/).filter(Boolean)) {
            const r = document.getElementById(id);
            if (r) { optionRoot = r; break; }
          }
        }
      }
      if (!optionRoot) {
        return { error: 'wrong_action', hint: 'dropdown_options expects a <select> or role=listbox/combobox/menu element. Got <' + tag.toLowerCase() + (role ? ' role=' + role : '') + '>. If this is a custom dropdown, click_index it to open and re-enumerate to see the options.' };
      }
      const opts = [];
      const optionEls = optionRoot.querySelectorAll('[role="option"], [role="menuitem"], [role="treeitem"], [role="row"], li');
      for (let i = 0; i < optionEls.length && i < 200; i++) {
        const o = optionEls[i];
        opts.push({
          idx: i,
          text: (o.textContent || '').trim().slice(0, 120),
          value: o.getAttribute('data-value') || o.getAttribute('value') || '',
          selected: o.getAttribute('aria-selected') === 'true' || o.classList.contains('selected'),
          disabled: o.getAttribute('aria-disabled') === 'true',
        });
      }
      return { kind: 'aria', tag, role, options: opts };
    })()
  `;
    const r = await bhCdp(tabId, "Runtime.evaluate", { expression: expr, returnByValue: true }, { timeoutMs: 2e3 });
    const v = r && r.result && r.result.value;
    if (!v) throw new Error(`dropdown_options: ${idx} (no result)`);
    if (v.error === "wrong_action") throw new Error(`dropdown_options: ${v.hint}`);
    if (v.error) throw new Error(`dropdown_options: ${idx} ${v.error} (re-enumerate)`);
    return v;
  }
  async function bhSelectDropdown(tabId, idx, text, opts = {}) {
    return await _bhWithStaleRecovery(
      tabId,
      idx,
      opts,
      "select_dropdown",
      (i, o) => _bhSelectDropdownCore(tabId, i, text, o)
    );
  }
  async function _bhSelectDropdownCore(tabId, idx, text, _opts) {
    await bhAttach(tabId);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`select_dropdown: invalid index ${idx}`);
    }
    if (typeof text !== "string" || !text) {
      throw new Error("select_dropdown: text required");
    }
    const expr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      if (el.__crossOrigin) {
        return { error: 'wrong_action', hint: 'select_dropdown does not work in cross-origin iframes (parent JS cannot access them). Only click_index is supported on cross-origin elements.' };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      const tag = el.tagName;
      const role = el.getAttribute('role') || '';
      const target = ${JSON.stringify(text)}.toLowerCase().trim();
      if (tag === 'SELECT') {
        let chosen = -1;
        for (let i = 0; i < el.options.length; i++) {
          const o = el.options[i];
          const t = (o.textContent || '').trim().toLowerCase();
          if (t === target || (o.value || '').toLowerCase() === target) { chosen = i; break; }
        }
        if (chosen < 0) {
          // try a partial match
          for (let i = 0; i < el.options.length; i++) {
            const t = (el.options[i].textContent || '').trim().toLowerCase();
            if (t.includes(target)) { chosen = i; break; }
          }
        }
        if (chosen < 0) return { error: 'no_match', hint: 'no option text or value matches "' + ${JSON.stringify(text)} + '". call dropdown_options first to see what is available.' };
        const before = el.value;
        el.selectedIndex = chosen;
        el.value = el.options[chosen].value;
        el.options[chosen].selected = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Verify the value stuck (frameworks sometimes intercept)
        const stuck = el.value === el.options[chosen].value;
        return { kind: 'native', selectedIndex: chosen, selectedText: (el.options[chosen].textContent || '').trim().slice(0, 120), stuck, before, after: el.value };
      }
      // ARIA path
      let optionRoot = null;
      if (role === 'listbox' || role === 'menu' || role === 'tree' || role === 'grid') {
        optionRoot = el;
      } else if (role === 'combobox' || role === 'searchbox') {
        const controls = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
        if (controls) {
          for (const id of controls.split(/\\s+/).filter(Boolean)) {
            const r = document.getElementById(id);
            if (r) { optionRoot = r; break; }
          }
        }
      }
      if (!optionRoot) return { error: 'wrong_action', hint: 'select_dropdown expects <select> or aria role listbox/combobox/menu; got <' + tag.toLowerCase() + (role ? ' role=' + role : '') + '>.' };
      const optionEls = optionRoot.querySelectorAll('[role="option"], [role="menuitem"], [role="treeitem"], li');
      let match = null;
      for (const o of optionEls) {
        const t = (o.textContent || '').trim().toLowerCase();
        if (t === target) { match = o; break; }
      }
      if (!match) {
        for (const o of optionEls) {
          const t = (o.textContent || '').trim().toLowerCase();
          if (t.includes(target)) { match = o; break; }
        }
      }
      if (!match) return { error: 'no_match', hint: 'no aria option text matches "' + ${JSON.stringify(text)} + '".' };
      try { match.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      try { match.click(); } catch (_) {}
      return { kind: 'aria', selectedText: (match.textContent || '').trim().slice(0, 120) };
    })()
  `;
    const r = await bhCdp(tabId, "Runtime.evaluate", { expression: expr, returnByValue: true, includeCommandLineAPI: false }, { timeoutMs: 2500 });
    const v = r && r.result && r.result.value;
    if (!v) throw new Error(`select_dropdown: ${idx} (no result)`);
    if (v.error === "wrong_action") throw new Error(`select_dropdown: ${v.hint}`);
    if (v.error === "no_match") throw new Error(`select_dropdown: ${v.hint}`);
    if (v.error) throw new Error(`select_dropdown: ${idx} ${v.error} (re-enumerate)`);
    return v;
  }

  // extension/browser-harness/src/harness/actions/upload.js
  async function bhUploadFileIndex(tabId, idx, files, opts = {}) {
    return await _bhWithStaleRecovery(
      tabId,
      idx,
      opts,
      "upload_file",
      (i, o) => _bhUploadFileIndexCore(tabId, i, files, o)
    );
  }
  async function _bhUploadFileIndexCore(tabId, idx, files, _opts) {
    await bhAttach(tabId);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`upload_file: invalid index ${idx}`);
    }
    const list = Array.isArray(files) ? files.slice() : [files];
    if (!list.length) throw new Error("upload_file: no files supplied");
    const resolveExpr = `
    (() => {
      const arr = window.__bhInteractive;
      if (!Array.isArray(arr) || ${idx} >= arr.length) return { error: 'stale_index' };
      const el = arr[${idx}];
      if (!el) return { error: 'stale_element' };
      if (el.__crossOrigin) {
        return { error: 'wrong_action', hint: 'upload_file does not work in cross-origin iframes (parent JS cannot access them).' };
      }
      if (!el.isConnected) return { error: 'stale_element' };
      const tag = el.tagName;
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (tag !== 'INPUT' || t !== 'file') {
        return { error: 'wrong_action', hint: 'upload_file requires <input type=file>; got <' + tag.toLowerCase() + (t ? ' type=' + t : '') + '>.' };
      }
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      return { ok: true };
    })()
  `;
    const r0 = await bhCdp(tabId, "Runtime.evaluate", { expression: resolveExpr, returnByValue: false, includeCommandLineAPI: false }, { timeoutMs: 1500 });
    const refExpr = `window.__bhInteractive && window.__bhInteractive[${idx}]`;
    let objectId;
    try {
      const r = await bhCdp(tabId, "Runtime.evaluate", { expression: refExpr, returnByValue: false }, { timeoutMs: 1500 });
      objectId = r && r.result && r.result.objectId;
    } catch (e) {
      throw new Error(`upload_file: ${e.message}`);
    }
    if (!objectId) throw new Error(`upload_file: ${idx} could not resolve element reference`);
    const validate = await bhCdp(tabId, "Runtime.evaluate", { expression: resolveExpr, returnByValue: true }, { timeoutMs: 1500 });
    const vv = validate && validate.result && validate.result.value;
    if (!vv || vv.error) {
      if (vv && vv.error === "wrong_action") throw new Error(`upload_file: ${vv.hint}`);
      throw new Error(`upload_file: ${idx} ${vv && vv.error || "unknown"} (re-enumerate)`);
    }
    let backendNodeId;
    try {
      const r = await bhCdp(tabId, "DOM.requestNode", { objectId }, { timeoutMs: 1500 });
      const r2 = await bhCdp(tabId, "DOM.describeNode", { objectId }, { timeoutMs: 1500 });
      backendNodeId = r2 && r2.node && r2.node.backendNodeId;
    } catch (e) {
      throw new Error(`upload_file: ${e.message}`);
    }
    if (!backendNodeId) throw new Error(`upload_file: ${idx} could not resolve backendNodeId`);
    await bhCdp(tabId, "DOM.setFileInputFiles", { files: list, backendNodeId }, { timeoutMs: 5e3 });
    return { indexed: idx, files: list };
  }

  // extension/browser-harness/src/harness/highlights.js
  async function bhDrawHighlights(base64Png, items, opts = {}) {
    if (!items || !items.length) return base64Png;
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
      return base64Png;
    }
    const scale = opts.scale && Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1;
    let bmp;
    try {
      const blob = await (await fetch(`data:image/png;base64,${base64Png}`)).blob();
      bmp = await createImageBitmap(blob);
    } catch (e) {
      console.warn("[BrowserHarness] highlight decode failed:", e.message);
      return base64Png;
    }
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const visible = items.filter((it) => it.bbox && it.bbox.w > 0 && it.bbox.h > 0);
    visible.sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h);
    ctx.lineWidth = 2;
    ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "top";
    for (let i = 0; i < visible.length; i++) {
      const it = visible[i];
      const color = _BH_HIGHLIGHT_COLORS[it.idx % _BH_HIGHLIGHT_COLORS.length];
      const x = it.bbox.x * scale;
      const y = it.bbox.y * scale;
      const w = it.bbox.w * scale;
      const h = it.bbox.h * scale;
      ctx.strokeStyle = color;
      ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
      const label = String(it.idx);
      const padding = 3;
      const metrics = ctx.measureText(label);
      const badgeW = metrics.width + padding * 2;
      const badgeH = 14;
      let bx = x;
      let by = y;
      if (h < badgeH + 4 || w < badgeW + 4) by = Math.max(0, y - badgeH);
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, badgeW, badgeH);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, bx + padding, by + 1);
    }
    let out;
    try {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
      out = btoa(bin);
    } catch (e) {
      console.warn("[BrowserHarness] highlight encode failed:", e.message);
      return base64Png;
    }
    return out;
  }

  // extension/browser-harness/src/harness/screenshot.js
  async function bhCaptureScreenshot(tabId, { full = false, maxDim = null, cssNormalize = false, timeoutMs = null, attempts = null } = {}) {
    await bhAttach(tabId);
    const tm = timeoutMs != null ? timeoutMs : full ? 12e4 : 5e3;
    const tries = attempts != null ? attempts : full ? 1 : 3;
    let r, lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        r = await bhCdp(tabId, "Page.captureScreenshot", { format: "png", captureBeyondViewport: full }, { timeoutMs: tm });
        break;
      } catch (e) {
        lastErr = e;
        if (i + 1 >= tries) throw e;
        await new Promise((res) => setTimeout(res, 250));
      }
    }
    const original = r.data;
    if (!maxDim && !cssNormalize) return original;
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
      return { data: original, width: 0, height: 0, cssWidth: 0, cssHeight: 0, dpr: 1, scale: 1 };
    }
    let cssWidth = 0, cssHeight = 0, dpr = 1;
    try {
      const info = await bhCdp(tabId, "Runtime.evaluate", {
        expression: "JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio||1})",
        returnByValue: true
      });
      const m = JSON.parse(info && info.result && info.result.value || "{}");
      cssWidth = m.w || 0;
      cssHeight = m.h || 0;
      dpr = m.dpr || 1;
    } catch {
    }
    let bmp;
    try {
      const blob = await (await fetch(`data:image/png;base64,${original}`)).blob();
      bmp = await createImageBitmap(blob);
    } catch (e) {
      console.warn("[BrowserHarness] screenshot decode failed:", e.message);
      return { data: original, width: 0, height: 0, cssWidth, cssHeight, dpr, scale: 1 };
    }
    let targetW = bmp.width;
    let targetH = bmp.height;
    if (cssNormalize && cssWidth && cssHeight) {
      targetW = cssWidth;
      targetH = cssHeight;
    }
    if (maxDim && Math.max(targetW, targetH) > maxDim) {
      const k = maxDim / Math.max(targetW, targetH);
      targetW = Math.max(1, Math.round(targetW * k));
      targetH = Math.max(1, Math.round(targetH * k));
    }
    let data = original;
    if (targetW !== bmp.width || targetH !== bmp.height) {
      try {
        const canvas = new OffscreenCanvas(targetW, targetH);
        canvas.getContext("2d").drawImage(bmp, 0, 0, targetW, targetH);
        const out = await canvas.convertToBlob({ type: "image/png" });
        const buf = new Uint8Array(await out.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
        data = btoa(bin);
      } catch (e) {
        console.warn("[BrowserHarness] screenshot resize failed:", e.message);
      }
    }
    const scale = cssWidth > 0 ? targetW / cssWidth : 1;
    return { data, width: targetW, height: targetH, cssWidth, cssHeight, dpr, scale };
  }

  // extension/browser-harness/src/harness/tabs.js
  async function bhListTabs({ includeChrome = true } = {}) {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((t) => includeChrome || !BH_INTERNAL.some((p) => (t.url || "").startsWith(p))).map((t) => ({ tabId: t.id, title: t.title || "", url: t.url || "" }));
  }
  async function bhCurrentTab() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t ? { tabId: t.id, title: t.title || "", url: t.url || "" } : null;
  }
  async function bhSwitchTab(tabId) {
    const t = await chrome.tabs.get(tabId);
    await chrome.windows.update(t.windowId, { focused: true });
    await chrome.tabs.update(tabId, { active: true });
    return { tabId, url: t.url || "", title: t.title || "" };
  }
  async function bhNewTab(url = "about:blank", { active = true } = {}) {
    const t = await chrome.tabs.create({ url, active });
    return { tabId: t.id, url: t.url || url };
  }
  async function bhEnsureRealTab() {
    const tabs = await bhListTabs({ includeChrome: false });
    if (!tabs.length) return null;
    const cur = await bhCurrentTab();
    if (cur && cur.url && !BH_INTERNAL.some((p) => cur.url.startsWith(p))) return cur;
    return await bhSwitchTab(tabs[0].tabId);
  }

  // extension/browser-harness/src/harness/index.js
  globalThis.BrowserHarness = {
    attach: bhAttach,
    detach: bhDetach,
    cdp: bhCdp,
    drainEvents: bhDrainEvents,
    pendingDialog: bhPendingDialog,
    handleDialog: bhHandleDialog,
    setAutoDialog: bhSetAutoDialog,
    healthSnapshot: bhHealthSnapshot,
    healthClear: bhHealthClear,
    setAgentBusy: bhSetAgentBusy,
    gotoUrl: bhGotoUrl,
    goBack: bhGoBack,
    goForward: bhGoForward,
    refresh: bhRefresh,
    pageInfo: bhPageInfo,
    clickAt: bhClickAt,
    typeText: bhTypeText,
    fillInput: bhFillInput,
    pressKey: bhPressKey,
    scroll: bhScroll,
    captureScreenshot: bhCaptureScreenshot,
    listTabs: bhListTabs,
    currentTab: bhCurrentTab,
    switchTab: bhSwitchTab,
    newTab: bhNewTab,
    ensureRealTab: bhEnsureRealTab,
    iframeTarget: bhIframeTarget,
    enumerateInteractive: bhEnumerateInteractive,
    // Semantic page read. enumerateInteractive answers "what can I click";
    // these answer "what does the page say".
    axTree: bhAxTree,
    axSnapshot: bhAxSnapshot,
    renderAx: bhRenderAx,
    drawHighlights: bhDrawHighlights,
    clickIndex: bhClickIndex,
    typeIndex: bhTypeIndex,
    uploadFileIndex: bhUploadFileIndex,
    dropdownOptions: bhDropdownOptions,
    selectDropdown: bhSelectDropdown,
    js: bhJs,
    dispatchKey: bhDispatchKey,
    uploadFile: bhUploadFile,
    wait: bhWait,
    waitForLoad: bhWaitForLoad,
    waitForElement: bhWaitForElement,
    waitForNetworkIdle: bhWaitForNetworkIdle,
    httpGet: bhHttpGet
  };
})();
