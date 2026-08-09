/* Chain of Thoughts — shared core for the chain modules.
 *
 * Creates the internal namespace (window.ChainInternal) that the sibling
 * modules (reasoning.js, tools.js, children.js, api.js) build on: the
 * per-session part registries, the flow-positioning logic, and the small
 * DOM/text helpers. Load order matters — this file MUST come before the
 * other chain modules (see index.html).
 *
 * Design (verified against opencode v1.17.18):
 *   - reasoning rows / the thinking placeholder / markers continue the
 *     chain right below the latest chain item (or below the last answer
 *     bubble if it is further down) — the chain never jumps back to the top;
 *   - tool cards land right below the live answer bubble, because the
 *     model writes its reply first and calls tools afterwards;
 *   - answer bubbles keep appending at the end of the thread
 *     (chat/streaming.js), which is exactly the next position in flow.
 */
(function () {
  "use strict";

  var CI = (window.ChainInternal = {});

  CI.ICONS = {
    grep: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>',
    read: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>',
    write: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>',
    bash: '<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>',
    glob: '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>',
    websearch: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>',
    webfetch: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>',
    todowrite: '<svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>',
    task: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M12 8V4" /><circle cx="9" cy="13" r="1" /><circle cx="15" cy="13" r="1" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>',
    question: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>',
    skill: '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z" /></svg>',
    apply_patch: '<svg viewBox="0 0 24 24"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>',
    lsp: '<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>',
    execute: '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>',
    plan: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>',
    invalid: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>',
    mcp: '<svg viewBox="0 0 24 24"><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a6 6 0 0 1-12 0V8z" /></svg>'
  };
  CI.ICON_DEFAULT = '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>';
  CI.CHEVRON = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15" /></svg>';

  // Consecutive same-type exploration calls (read/glob/grep/...) and
  // consecutive edits collapse into ONE card ("read · 3 files") so the
  // flow stays airy — edits especially, since the AI typically makes a
  // couple in a row, thinks, then edits again. The group only stays open
  // while NOTHING else happened in between — any reasoning, text, marker
  // or different tool closes it (the flow must mirror the AI's position,
  // so a later read after a reasoning never joins the old block).
  CI.GROUPABLE_TOOLS = { read: 1, glob: 1, grep: 1, websearch: 1, webfetch: 1, edit: 1, write: 1 };

  // Per-session state shared by all chain modules. Replaced wholesale on
  // markTurn / reset / beginRebuild — never reassign `state` itself.
  CI.state = {
    items: {},          // partID -> { el, type, buf, textEl, ... }
    childSessions: {},  // childSessionID -> task partID
    childParts: {},     // childSessionID -> { partID -> { el } }
    placeholderEl: null,
    // A reasoning part is announced (empty) while the thinking placeholder
    // is up. We do NOT morph yet — the placeholder keeps bouncing until
    // the FIRST text delta arrives, so the thinking row can never sit
    // empty.
    pendingReasoning: null,
    turnAnchor: null,   // last chain element of the current turn (or its user msg)
    turnUserMsg: null,  // current turn's user message element
    currentGroup: null  // { tool, entry, listEl, count, rows, ringEl }
  };

  CI.isGroupable = function (tool) { return !!CI.GROUPABLE_TOOLS[tool]; };

  /** Closing a group is a flow-position decision: any reasoning, text,
   *  marker, placeholder, different tool, turn or reset calls this. */
  CI.breakGroup = function () { CI.state.currentGroup = null; };

  CI.log = function () {
    if (!window.App || !window.App.debug) return;
    var args = ["[Chain]"];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  };

  CI.chatArea = function () {
    return document.getElementById("chatArea");
  };

  CI.esc = function (text) {
    return window.Utils ? window.Utils.escapeHtml(String(text)) : String(text);
  };

  CI.iconFor = function (tool) {
    if (CI.ICONS[tool]) return CI.ICONS[tool];
    if (typeof tool === "string" && tool.indexOf("mcp__") === 0) return CI.ICONS.mcp;
    return CI.ICON_DEFAULT;
  };

  /* ── Flow positioning ──
   * The chain is continuous: every new row lands below the newest thing
   * (chain row or answer bubble), never back at the top of the turn. */

  CI.lastMessage = function () {
    var area = CI.chatArea();
    if (!area) return null;
    var msgs = area.querySelectorAll(".message");
    return msgs.length ? msgs[msgs.length - 1] : null;
  };

  CI.latestOf = function (a, b) {
    if (!a || !a.isConnected) return b;
    if (!b || !b.isConnected) return a;
    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? b : a;
  };

  /** Reasoning rows, the thinking placeholder and markers continue the
   *  chain right below the latest chain item — or below the last answer
   *  bubble if that sits further down the thread. */
  CI.flowAnchor = function () {
    var anchor = CI.latestOf(CI.state.turnAnchor, CI.lastMessage());
    if (anchor) return anchor;
    if (CI.state.turnUserMsg && CI.state.turnUserMsg.isConnected) return CI.state.turnUserMsg;
    return null;
  };

  CI.insertFlow = function (el) {
    var anchor = CI.flowAnchor();
    if (anchor && anchor.isConnected) {
      anchor.insertAdjacentElement("afterend", el);
    } else {
      var area = CI.chatArea();
      if (area) area.appendChild(el);
    }
    CI.state.turnAnchor = el;
  };

  /** Tool cards: the model writes its answer first, then calls tools — so
   *  the card lands right below the live answer bubble. */
  CI.insertTool = function (el) {
    var area = CI.chatArea();
    // The card lands below the newest thing in the thread: the LAST
    // streaming bubble (the answer the model is writing) or the chain end,
    // whichever sits further down. The bubble alone could drop the card
    // mid-chain when reasoning rows already extend past it; a stale
    // .ai-message-streaming on an earlier bubble must never be the anchor.
    var streaming = null;
    if (area) {
      var all = area.querySelectorAll(".ai-message-streaming");
      if (all.length > 0) streaming = all[all.length - 1];
    }
    var anchor = CI.latestOf(streaming, CI.flowAnchor());
    if (anchor && anchor.isConnected) {
      anchor.insertAdjacentElement("afterend", el);
    } else {
      var a = CI.chatArea();
      if (a) a.appendChild(el);
    }
    CI.state.turnAnchor = el;
  };

  // Scroll the chat to the newest chain content at most once per animation
  // frame. Every delta used to force a synchronous layout; with heavy
  // streaming that stalls the UI thread (which would slow down the whole
  // streamed reply, not just the chain). Also respects the user: once they
  // scroll up to read, streaming no longer yanks the view back down.
  var chatAreaRef = null;
  var userScrolledUp = false;
  var scrollRaf = null;

  function trackScrollState() {
    if (!chatAreaRef || chatAreaRef.dataset.cotScrollBound) return;
    chatAreaRef.dataset.cotScrollBound = "1";
    chatAreaRef.addEventListener(
      "scroll",
      function () {
        userScrolledUp =
          chatAreaRef.scrollHeight - chatAreaRef.scrollTop - chatAreaRef.clientHeight > 60;
      },
      { passive: true },
    );
  }

  CI.scrollToBottom = function () {
    if (!chatAreaRef) chatAreaRef = document.getElementById("chatArea");
    if (!chatAreaRef) return;
    trackScrollState();
    if (userScrolledUp) return;
    if (!window.requestAnimationFrame) {
      chatAreaRef.scrollTop = chatAreaRef.scrollHeight;
      return;
    }
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(function () {
      scrollRaf = null;
      if (userScrolledUp) return;
      chatAreaRef.scrollTop = chatAreaRef.scrollHeight;
    });
  };

  CI.toggleItem = function (btn) {
    var item = btn.closest(".cot-item");
    if (item) item.classList.toggle("collapsed");
  };

  CI.makeToggle = function () {
    var btn = document.createElement("button");
    btn.className = "cot-toggle";
    btn.type = "button";
    btn.innerHTML = CI.CHEVRON;
    btn.addEventListener("click", function () { CI.toggleItem(btn); });
    return btn;
  };

  /** Long inputs are noise in a compact flow: a webfetch shows its HOSTNAME
   *  ("github.com"), not the full URL — the full URL rides in the hover
   *  tooltip instead. */
  CI.shortUrl = function (url) {
    try {
      var host = new URL(url).hostname;
      if (host.indexOf("www.") === 0) host = host.slice(4);
      return host || url;
    } catch (e) { return url; }
  };

  /** Derive a one-line title fallback from a tool part's input. */
  CI.inputSubtitle = function (tool, input) {
    if (!input || typeof input !== "object") return "";
    if (typeof input.command === "string") return input.command;
    if (typeof input.filePath === "string") return input.filePath;
    if (typeof input.path === "string") return input.path;
    if (typeof input.pattern === "string") return input.pattern;
    if (typeof input.url === "string") return CI.shortUrl(input.url);
    if (typeof input.query === "string") return input.query;
    if (typeof input.description === "string") return input.description;
    if (tool === "question" && Array.isArray(input.questions) && input.questions.length) {
      var q = input.questions[0];
      var text = (q && (q.question || q.header)) || "";
      return text.length > 70 ? text.slice(0, 67) + "..." : text;
    }
    return "";
  };

  /** The hover tooltip carries what the compact title omits: the FULL url
   *  behind a hostname-only webfetch title. */
  CI.setToolHover = function (entry, part) {
    var input = (part.state && part.state.input) || {};
    if (typeof input.url === "string") entry.el.title = input.url;
    else entry.el.removeAttribute("title");
  };

  /** Render text with `code` chips (JetBrains Mono tokens). */
  CI.renderRich = function (container, text) {
    container.textContent = "";
    var re = /`([^`]*)`/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
      var code = document.createElement("code");
      code.className = "cot-code";
      code.textContent = m[1];
      container.appendChild(code);
      last = re.lastIndex;
    }
    if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
  };
})();
