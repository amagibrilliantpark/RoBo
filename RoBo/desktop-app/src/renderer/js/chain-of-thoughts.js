/* Chain of Thoughts — live reasoning + tool activity for the current session.
 * Renders INSIDE the chat thread, flowing continuously with the
 * conversation. Rows are direct children of #chatArea, inserted where the
 * model actually produced them:
 *   - reasoning rows / the thinking placeholder / markers continue the
 *     chain right below the latest chain item (or below the last answer
 *     bubble if it is further down) — the chain never jumps back to the top;
 *   - tool cards land right below the live answer bubble, because the
 *     model writes its reply first and calls tools afterwards;
 *   - answer bubbles keep appending at the end of the thread
 *     (chat/streaming.js), which is exactly the next position in flow.
 * Event sources (all verified against opencode v1.17.18):
 *   - message.part.updated  (full part: reasoning start/finalize, tool states)
 *   - message.part.delta    (field "text" deltas; shared by text & reasoning)
 *   - message.part.removed  (part dropped)
 *   - session.status        (retry)
 *   - session.next.compaction.* / session.compacted
 *   - child sessions (task tool) stream parts on the same global /event bus
 */
(function () {
  "use strict";

  var ICONS = {
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
  var ICON_DEFAULT = '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>';
  var CHEVRON = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15" /></svg>';

  var items = {};          // partID -> { el, type, buf, textEl, ... }
  var childSessions = {};  // childSessionID -> task partID
  var childParts = {};     // childSessionID -> { partID -> { el } }
  var placeholderEl = null;
  // A reasoning part is announced (empty) while the thinking placeholder is
  // up. We do NOT morph yet — the placeholder keeps bouncing until the
  // FIRST text delta arrives, so the thinking row can never sit empty.
  var pendingReasoning = null;
  var turnAnchor = null;   // last chain element of the current turn (or its user msg)
  var turnUserMsg = null;  // current turn's user message element

  function log() {
    if (!window.App || !window.App.debug) return;
    var args = ["[Chain]"];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  function chatArea() {
    return document.getElementById("chatArea");
  }

  function esc(text) {
    return window.Utils ? window.Utils.escapeHtml(String(text)) : String(text);
  }

  function iconFor(tool) {
    if (ICONS[tool]) return ICONS[tool];
    if (typeof tool === "string" && tool.indexOf("mcp__") === 0) return ICONS.mcp;
    return ICON_DEFAULT;
  }

  /* ── Flow positioning ──
   * The chain is continuous: every new row lands below the newest thing
   * (chain row or answer bubble), never back at the top of the turn. */

  function lastMessage() {
    var area = chatArea();
    if (!area) return null;
    var msgs = area.querySelectorAll(".message");
    return msgs.length ? msgs[msgs.length - 1] : null;
  }

  function latestOf(a, b) {
    if (!a || !a.isConnected) return b;
    if (!b || !b.isConnected) return a;
    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? b : a;
  }

  /** Reasoning rows, the thinking placeholder and markers continue the
   *  chain right below the latest chain item — or below the last answer
   *  bubble if that sits further down the thread. */
  function flowAnchor() {
    var anchor = latestOf(turnAnchor, lastMessage());
    if (anchor) return anchor;
    if (turnUserMsg && turnUserMsg.isConnected) return turnUserMsg;
    return null;
  }

  function insertFlow(el) {
    var anchor = flowAnchor();
    if (anchor && anchor.isConnected) {
      anchor.insertAdjacentElement("afterend", el);
    } else {
      var area = chatArea();
      if (area) area.appendChild(el);
    }
    turnAnchor = el;
  }

  /** Tool cards: the model writes its answer first, then calls tools — so
   *  the card lands right below the live answer bubble. */
  function insertTool(el) {
    var area = chatArea();
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
    var anchor = latestOf(streaming, flowAnchor());
    if (anchor && anchor.isConnected) {
      anchor.insertAdjacentElement("afterend", el);
    } else {
      var a = chatArea();
      if (a) a.appendChild(el);
    }
    turnAnchor = el;
  }

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

  function scrollToBottom() {
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
  }

  function toggleItem(btn) {
    var item = btn.closest(".cot-item");
    if (item) item.classList.toggle("collapsed");
  }

  function makeToggle() {
    var btn = document.createElement("button");
    btn.className = "cot-toggle";
    btn.type = "button";
    btn.innerHTML = CHEVRON;
    btn.addEventListener("click", function () { toggleItem(btn); });
    return btn;
  }

  /** Derive a title fallback from a tool part's input. */
  function inputSubtitle(tool, input) {
    if (!input || typeof input !== "object") return "";
    if (typeof input.command === "string") return input.command;
    if (typeof input.filePath === "string") return input.filePath;
    if (typeof input.path === "string") return input.path;
    if (typeof input.pattern === "string") return input.pattern;
    if (typeof input.url === "string") return input.url;
    if (typeof input.query === "string") return input.query;
    if (typeof input.description === "string") return input.description;
    if (tool === "question" && Array.isArray(input.questions) && input.questions.length) {
      var q = input.questions[0];
      var text = (q && (q.question || q.header)) || "";
      return text.length > 70 ? text.slice(0, 67) + "..." : text;
    }
    return "";
  }

  /* ── Turn lifecycle ── */

  /** A new user turn: remember the user's message as the chain anchor and
   *  reset the part registries (the previous turn's rows are done — they
   *  stay rendered where they are). */
  function markTurn() {
    var area = chatArea();
    if (!area) return null;
    var users = area.querySelectorAll(".user-message");
    turnUserMsg = users.length ? users[users.length - 1] : null;
    turnAnchor = turnUserMsg || null;
    items = {};
    childSessions = {};
    childParts = {};
    placeholderEl = null;
    pendingReasoning = null;
    return turnUserMsg;
  }

  /* ── Placeholder (fills empty stretches: before first part, between steps) ── */

  function showPlaceholder(text) {
    if (placeholderEl) return;
    placeholderEl = document.createElement("div");
    placeholderEl.className = "cot-placeholder";
    placeholderEl.innerHTML =
      '<span class="cot-dot"></span><span class="cot-placeholder-label">' + esc(text || "Thinking") +
      '</span><span class="cot-placeholder-dots"><i></i><i></i><i></i></span>';
    insertFlow(placeholderEl);
    log("placeholder shown:", text || "Thinking");
  }

  function hidePlaceholder() {
    if (placeholderEl) {
      placeholderEl.remove();
      placeholderEl = null;
      log("placeholder hidden");
    }
    pendingReasoning = null;
  }

  /* ── Reasoning parts ── */

  function buildReasoningHead() {
    var head = document.createElement("div");
    head.className = "cot-head";
    var dot = document.createElement("span");
    dot.className = "cot-dot";
    var title = document.createElement("span");
    title.className = "cot-title";
    title.textContent = "Thinking";
    var cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    head.appendChild(dot);
    head.appendChild(title);
    head.appendChild(cursor);
    head.appendChild(makeToggle());
    return head;
  }

  function makeReasoningRow(part) {
    var item = document.createElement("div");
    item.className = "cot-item reasoning active";
    item.dataset.partId = part.id;
    item.appendChild(buildReasoningHead());
    var body = document.createElement("div");
    body.className = "cot-body";
    var textEl = document.createElement("div");
    textEl.className = "cot-text";
    body.appendChild(textEl);
    item.appendChild(body);
    return { el: item, textEl: textEl };
  }

  /** The "Thinking..." placeholder BECOMES the reasoning row: same element,
   *  same position — the reasoning just streams in below the thinking
   *  label. No row swap, no animation restart, no dead gap. The morph is
   *  DEFERRED: it fires on the first text delta, not when the (still
   *  empty) reasoning part is announced, so the placeholder keeps bouncing
   *  until real text exists. */
  function morphPlaceholderToReasoning(part) {
    var el = placeholderEl;
    placeholderEl = null;
    pendingReasoning = null;
    el.classList.remove("cot-placeholder");
    el.classList.add("cot-item", "reasoning", "active", "no-anim");
    el.dataset.partId = part.id;
    el.textContent = "";
    el.appendChild(buildReasoningHead());
    var body = document.createElement("div");
    body.className = "cot-body";
    var textEl = document.createElement("div");
    textEl.className = "cot-text";
    body.appendChild(textEl);
    el.appendChild(body);
    var entry = {
      el: el, type: "reasoning", buf: part.text || "",
      textEl: textEl,
      cursorEl: el.querySelector(".stream-cursor"),
      rendered: part.text ? part.text.length : 0
    };
    items[part.id] = entry;
    log("placeholder morphed to reasoning:", part.id);
    return entry;
  }

  function finalizeReasoning(entry, part) {
    if (entry.el.classList.contains("done")) return;
    entry.el.classList.remove("active");
    entry.el.classList.add("done");
    // The blinking cursor belongs to the live stream; kill it here so
    // finished rows don't keep blinking forever.
    if (entry.cursorEl) {
      entry.cursorEl.remove();
      entry.cursorEl = null;
    }
    if (entry.textEl) entry.textEl.innerHTML = "";
    if (part.text) {
      renderRich(entry.textEl, part.text);
      entry.buf = part.text;
      entry.rendered = part.text.length;
    }
    // Long finished reasoning (often repeats the final answer) is folded
    // by default — the chevron expands it. Keeps the thread from showing
    // the same text twice.
    if (part.text && part.text.length > 250) {
      entry.el.classList.add("collapsed");
    }
  }

  function upsertReasoning(part) {
    if (!part || !part.id) return;
    var existing = items[part.id];
    if (existing) {
      // Finalize: full part arrives with time.end after the deltas.
      if (part.time && part.time.end) finalizeReasoning(existing, part);
      return;
    }
    if (placeholderEl && !part.text) {
      // Part announced but still empty (including an empty finalize): keep
      // the placeholder bouncing — the morph happens on the first delta,
      // so a content-free reasoning part can never leave an empty row.
      pendingReasoning = part.id;
      log("reasoning part (empty) -> pending morph:", part.id);
      return;
    }
    var entry;
    if (placeholderEl) {
      entry = morphPlaceholderToReasoning(part);
    } else {
      var built = makeReasoningRow(part);
      insertFlow(built.el);
      entry = {
        el: built.el, type: "reasoning", buf: part.text || "",
        textEl: built.textEl,
        cursorEl: built.el.querySelector(".stream-cursor"),
        rendered: part.text ? part.text.length : 0
      };
      items[part.id] = entry;
    }
    if (part.text) {
      entry.buf = part.text;
      entry.rendered = part.text.length;
      renderRich(entry.textEl, part.text);
    }
    if (part.time && part.time.end) {
      finalizeReasoning(entry, part);
    }
  }

  function isReasoningPart(partID) {
    if (partID === pendingReasoning) return true;
    return !!(items[partID] && items[partID].type === "reasoning");
  }

  /** Streaming deltas append plain text only — code chips are rendered
   *  once at finalize (time.end). Per-token cost stays O(chunk); the old
   *  backtick-triggered full re-render was O(buffer) on nearly every delta
   *  (reasoning is full of `code` tokens). The FIRST delta of a pending
   *  part triggers the deferred placeholder morph — text exists now, so
   *  the thinking row becomes the reasoning row without any empty gap. */
  function appendReasoningDelta(partID, delta) {
    if (!delta) return;
    var entry = items[partID];
    if (!entry && partID === pendingReasoning && placeholderEl) {
      entry = morphPlaceholderToReasoning({ id: partID });
    }
    if (!entry || entry.type !== "reasoning") return;
    entry.buf += delta;
    if (!entry.textEl) return;
    var chunk = entry.buf.slice(entry.rendered || 0);
    entry.rendered = entry.buf.length;
    entry.textEl.appendChild(document.createTextNode(chunk));
  }

  /** Render text with `code` chips (JetBrains Mono tokens). */
  function renderRich(container, text) {
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
  }

  /* ── Tool parts ──
   * Compact cards: icon + tool name + one-line title. Bash is the one
   * exception — its terminal output streams right below the card. */

  var BASH_OUTPUT_CAP = 4000;

  function makeToolRow(part) {
    var item = document.createElement("div");
    item.className = "cot-item tool pending";
    item.dataset.partId = part.id;
    var head = document.createElement("div");
    head.className = "cot-head";
    var ring = document.createElement("span");
    ring.className = "cot-ring";
    var icon = document.createElement("span");
    icon.className = "cot-icon";
    icon.innerHTML = iconFor(part.tool);
    var name = document.createElement("span");
    name.className = "cot-tool-name";
    name.textContent = part.tool || "tool";
    var title = document.createElement("span");
    title.className = "cot-title";
    head.appendChild(ring);
    head.appendChild(icon);
    head.appendChild(name);
    head.appendChild(title);
    item.appendChild(head);
    var outputEl = null;
    if (part.tool === "bash") {
      outputEl = document.createElement("div");
      outputEl.className = "cot-tool-output";
      item.appendChild(outputEl);
    }
    return { el: item, titleEl: title, outputEl: outputEl };
  }

  function applyToolState(entry, part) {
    var state = part.state || {};
    var status = state.status;
    if (status === "running") {
      entry.el.classList.remove("pending");
      entry.el.classList.add("running");
      entry.titleEl.textContent = state.title || inputSubtitle(part.tool, state.input) || "";
      // task tool: the child session ID arrives in the running state's
      // metadata — register it so the child's parts stream nested below.
      registerChild(entry, part);
    } else if (status === "completed") {
      finalizeTool(entry, part, true);
    } else if (status === "error") {
      finalizeTool(entry, part, false);
    }
  }

  /** Bash output arrives in the completed/error state (and can also be
   *  streamed via deltas — see appendToolOutputDelta). */
  function renderToolOutput(entry, part) {
    if (!entry.outputEl) return;
    var out = (part.state && part.state.output) || part.output || "";
    if (!out) return;
    if (out.length > BASH_OUTPUT_CAP) {
      out = out.slice(0, BASH_OUTPUT_CAP) + "\n\u2026 (output truncated)";
    }
    entry.outputEl.textContent = out;
    entry.outputEl.classList.add("has-output");
  }

  function upsertTool(part) {
    if (!part || !part.id) return;
    var existing = items[part.id];
    if (!existing) {
      var built = makeToolRow(part);
      insertTool(built.el);
      existing = {
        el: built.el, type: "tool", state: part.state || {},
        titleEl: built.titleEl, outputEl: built.outputEl, childrenEl: null
      };
      items[part.id] = existing;
      log("tool row:", part.tool, part.state && part.state.status);
    }
    applyToolState(existing, part);
  }

  /** Map a task tool's child session to its row (for nested streaming). */
  function registerChild(entry, part) {
    var meta = (part.state && part.state.metadata) || {};
    if (part.tool !== "task" || !meta.sessionId) return;
    childSessions[meta.sessionId] = part.id;
    if (!entry.childrenEl) {
      entry.childrenEl = document.createElement("div");
      entry.childrenEl.className = "cot-children";
      entry.el.appendChild(entry.childrenEl);
    }
  }

  function finalizeTool(entry, part, ok) {
    var item = entry.el;
    item.classList.remove("pending", "running");
    item.classList.add(ok ? "ok" : "fail");
    // No status dot on finished tools: the spinning ring only exists while
    // the tool is pending/running, then it disappears.
    var ring = item.querySelector(".cot-ring");
    if (ring) ring.remove();

    var state = part.state || {};
    var fallback = inputSubtitle(part.tool, state.input) || "";
    entry.titleEl.textContent = ok
      ? (state.title || fallback)
      : (state.error || state.title || fallback);

    registerChild(entry, part);
    renderToolOutput(entry, part);
    var meta = state.metadata || {};
    if (part.tool === "task" && meta.sessionId && !ok) {
      var doneLine = document.createElement("div");
      doneLine.className = "cot-subtask done";
      doneLine.innerHTML = '<span class="cot-dot"></span><span class="cot-subtask-desc">Subagent failed</span>';
      entry.childrenEl.appendChild(doneLine);
    }
  }

  /** Stream bash output deltas into the card (opencode emits tool output
   *  as message.part.delta with field "output" while the command runs).
   *  Appends incrementally like reasoning — no full-buffer rewrite per
   *  chunk. */
  function appendToolOutputDelta(partID, delta) {
    if (!delta) return;
    var entry = items[partID];
    if (!entry || entry.type !== "tool" || !entry.outputEl) return;
    if (entry.outputEl.classList.contains("has-output")) return;
    var rendered = entry.outRendered || 0;
    var cap = BASH_OUTPUT_CAP;
    var out = (entry.outputBuf = (entry.outputBuf || "") + delta);
    if (out.length > cap) {
      entry.outputEl.appendChild(document.createTextNode(out.slice(rendered, cap)));
      entry.outputEl.appendChild(document.createTextNode("\n\u2026 (output truncated)"));
      entry.outputEl.classList.add("has-output");
      entry.outRendered = cap;
      return;
    }
    entry.outputEl.appendChild(document.createTextNode(out.slice(rendered)));
    entry.outRendered = out.length;
  }

  /* ── Child session (task tool subagent) content ── */

  function childrenElFor(sessionID) {
    var partID = childSessions[sessionID];
    var entry = partID && items[partID];
    if (!entry) return null;
    if (!entry.childrenEl) {
      entry.childrenEl = document.createElement("div");
      entry.childrenEl.className = "cot-children";
      entry.el.appendChild(entry.childrenEl);
    }
    return entry.childrenEl;
  }

  function attachChildPart(sessionID, part) {
    var container = childrenElFor(sessionID);
    if (!container || !part) return;
    if (!childParts[sessionID]) childParts[sessionID] = {};
    var registry = childParts[sessionID];

    if (part.type === "reasoning") {
      var entry = registry[part.id];
      if (!entry) {
        var line = document.createElement("div");
        line.className = "cot-subtask active";
        line.dataset.partId = part.id;
        line.innerHTML = '<span class="cot-dot"></span><span class="cot-subtask-agent">Reasoning</span>';
        var textEl = document.createElement("span");
        textEl.className = "cot-subtask-desc";
        line.appendChild(textEl);
        container.appendChild(line);
        entry = registry[part.id] = { el: line, buf: part.text || "", textEl: textEl };
      }
      if (part.time && part.time.end) {
        entry.el.classList.remove("active");
        entry.el.classList.add("done");
      }
      if (part.text) {
        entry.buf = part.text;
        entry.textEl.textContent = part.text;
      }
      scrollToBottom();
    } else if (part.type === "tool") {
      var state = part.state || {};
      var toolLine = registry[part.id];
      if (!toolLine) {
        toolLine = document.createElement("div");
        toolLine.className = "cot-subtask-tool active";
        toolLine.dataset.partId = part.id;
        toolLine.innerHTML =
          '<span class="cot-ring"></span>' +
          '<span class="cot-subtask-icon">' + iconFor(part.tool) + '</span>' +
          '<span class="cot-subtask-agent">' + esc(part.tool) + '</span>';
        var subEl = document.createElement("span");
        subEl.className = "cot-subtask-desc";
        toolLine.appendChild(subEl);
        container.appendChild(toolLine);
        toolLine = registry[part.id] = { el: toolLine, subEl: subEl };
      }
      toolLine.el.className = "cot-subtask-tool " + (state.status === "completed" ? "done" : state.status === "error" ? "fail" : "active");
      var dotEl = toolLine.el.querySelector(".cot-ring");
      if (state.status === "completed" || state.status === "error") {
        if (dotEl) dotEl.remove();
      }
      toolLine.subEl.textContent =
        state.title || state.error || inputSubtitle(part.tool, state.input) || "";
      scrollToBottom();
    } else if (part.type === "text") {
      var txt = registry[part.id];
      if (!txt) {
        txt = document.createElement("div");
        txt.className = "cot-subtask-text";
        txt.dataset.partId = part.id;
        container.appendChild(txt);
        registry[part.id] = txt;
      }
      if (part.text) {
        txt.textContent = part.text.length > 200 ? part.text.slice(0, 197) + "..." : part.text;
      }
      scrollToBottom();
    }
  }

  function appendChildPartDelta(sessionID, partID, field, delta) {
    if (field !== "text" || !delta) return;
    var registry = childParts[sessionID];
    if (!registry) return;
    var entry = registry[partID];
    if (!entry) return;
    if (entry.buf !== undefined) {
      entry.buf += delta;
      if (entry.buf.length > 4000) {
        // Past the display cap: single cheap rewrite, then keep appending.
        entry.textEl.textContent = entry.buf.slice(-4000);
      } else {
        entry.textEl.appendChild(document.createTextNode(delta));
      }
    } else if (entry.textContent !== undefined && entry.nodeType) {
      var full = entry.textContent + delta;
      entry.textContent = full.length > 200 ? full.slice(0, 197) + "..." : full;
    }
    scrollToBottom();
  }

  function removeChildPart(sessionID, partID) {
    var registry = childParts[sessionID];
    if (!registry) return;
    var entry = registry[partID];
    if (!entry) return;
    var el = entry.el || entry;
    if (el && el.remove) el.remove();
    delete registry[partID];
  }

  function childSessionStatus(sessionID, status) {
    var container = childrenElFor(sessionID);
    if (!container || !status) return;
    if (status.type === "retry") {
      var line = document.createElement("div");
      line.className = "cot-marker retry";
      line.innerHTML =
        '<span class="cot-marker-dot"></span><span class="cot-marker-text">' +
        esc("Retry " + (status.attempt || 0) + " \u2014 " + (status.message || "retrying")) + '</span>';
      container.appendChild(line);
      scrollToBottom();
    } else if (status.type === "idle" && childSessions[sessionID]) {
      // Child finished; mark any still-active nested lines done and drop
      // its registries so long sessions don't accumulate every subagent's
      // part buffers in memory.
      container.querySelectorAll(".cot-subtask.active, .cot-subtask-tool.active").forEach(function (el) {
        el.classList.remove("active");
        el.classList.add("done");
        var ring = el.querySelector(".cot-ring");
        if (ring) ring.remove();
      });
      delete childSessions[sessionID];
      delete childParts[sessionID];
    }
  }

  /* ── Markers (retry / compaction) ── */

  function addMarker(type, text) {
    var cls = typeof type === "string" ? type.replace(/[^a-z0-9-]/gi, "") : "note";
    if (!cls) cls = "note";
    var item = document.createElement("div");
    item.className = "cot-marker " + cls;
    item.innerHTML =
      '<span class="cot-marker-dot"></span><span class="cot-marker-text">' + esc(text) + '</span>';
    insertFlow(item);
    return item;
  }

  function finishMarker(type, text) {
    var area = chatArea();
    if (!area) return;
    var markers = area.querySelectorAll(".cot-marker.compaction-active");
    var last = markers[markers.length - 1];
    if (last) {
      last.classList.remove("compaction-active");
      last.classList.add("compaction");
      var span = last.querySelector(".cot-marker-text");
      if (span && text) span.textContent = text;
    }
  }

  /* ── Removal & reset ── */

  function removePart(partID) {
    var entry = items[partID];
    if (entry) {
      entry.el.remove();
      delete items[partID];
    }
    if (pendingReasoning === partID) pendingReasoning = null;
    for (var sid in childSessions) {
      if (childSessions[sid] === partID) {
        delete childSessions[sid];
        delete childParts[sid];
      }
    }
  }

  function clearChainDom() {
    var area = chatArea();
    if (area) {
      area.querySelectorAll(".cot-item, .cot-placeholder, .cot-marker, .cot-children, .chain-list").forEach(function (el) {
        el.remove();
      });
    }
  }

  function resetRegistries() {
    items = {};
    childSessions = {};
    childParts = {};
    placeholderEl = null;
    pendingReasoning = null;
    turnAnchor = null;
    turnUserMsg = null;
  }

  /** Drop every chain row and registry (session switch). */
  function reset() {
    clearChainDom();
    resetRegistries();
  }

  /* ── Rebuild (initial load / compaction / revert) ──
   * Reconstructs the whole chain from the message parts API so the rows
   * survive an app restart. renderMessages() calls beginRebuild(), then
   * rebuildPart() for every reasoning/tool part while building the answer
   * bubbles into the same fragment — part order keeps the rows interleaved
   * with the bubbles exactly like the live stream does. */

  function beginRebuild() {
    clearChainDom();
    resetRegistries();
    log("rebuild started");
  }

  function rebuildPart(part, parent) {
    if (!part || !part.id) return;
    var target = parent || chatArea();
    if (!target) return;
    if (part.type === "reasoning") {
      var built = makeReasoningRow(part);
      var entry = {
        el: built.el, type: "reasoning", buf: part.text || "",
        textEl: built.textEl,
        cursorEl: built.el.querySelector(".stream-cursor"),
        rendered: part.text ? part.text.length : 0
      };
      items[part.id] = entry;
      if (part.time && part.time.end) finalizeReasoning(entry, part);
      else if (part.text) renderRich(entry.textEl, part.text);
      target.appendChild(built.el);
    } else if (part.type === "tool") {
      var t = makeToolRow(part);
      var toolEntry = {
        el: t.el, type: "tool", state: part.state || {},
        titleEl: t.titleEl, outputEl: t.outputEl, childrenEl: null
      };
      items[part.id] = toolEntry;
      applyToolState(toolEntry, part);
      target.appendChild(t.el);
    }
  }

  function endRebuild() {
    var area = chatArea();
    var users = area ? area.querySelectorAll(".user-message") : [];
    turnUserMsg = users.length ? users[users.length - 1] : null;
    turnAnchor = turnUserMsg || null;
    placeholderEl = null;
    pendingReasoning = null;
    log("rebuild done; rows:", Object.keys(items).length);
  }

  function isChildSession(sessionID) {
    return !!childSessions[sessionID];
  }

  window.Chain = {
    upsertReasoning: upsertReasoning,
    isReasoningPart: isReasoningPart,
    appendReasoningDelta: appendReasoningDelta,
    upsertTool: upsertTool,
    appendToolOutputDelta: appendToolOutputDelta,
    attachChildPart: attachChildPart,
    appendChildPartDelta: appendChildPartDelta,
    removeChildPart: removeChildPart,
    childSessionStatus: childSessionStatus,
    isChildSession: isChildSession,
    showPlaceholder: showPlaceholder,
    hidePlaceholder: hidePlaceholder,
    addMarker: addMarker,
    finishMarker: finishMarker,
    removePart: removePart,
    reset: reset,
    markTurn: markTurn,
    beginRebuild: beginRebuild,
    rebuildPart: rebuildPart,
    endRebuild: endRebuild,
    scheduleScroll: scrollToBottom
  };
})();
