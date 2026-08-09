/* Chain of Thoughts — thinking placeholder + reasoning parts.
 * The placeholder fills empty stretches (before the first part, between
 * steps) and BECOMES the reasoning row on the first text delta — same
 * element, same position, no dead gap. */
(function () {
  "use strict";

  var CI = window.ChainInternal;

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
    head.appendChild(CI.makeToggle());
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
    var el = CI.state.placeholderEl;
    CI.state.placeholderEl = null;
    CI.state.pendingReasoning = null;
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
    CI.state.items[part.id] = entry;
    CI.log("placeholder morphed to reasoning:", part.id);
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
      CI.renderRich(entry.textEl, part.text);
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
    CI.breakGroup(); // reasoning between tool calls closes the previous group
    var existing = CI.state.items[part.id];
    if (existing) {
      // Finalize: full part arrives with time.end after the deltas.
      if (part.time && part.time.end) finalizeReasoning(existing, part);
      return;
    }
    if (CI.state.placeholderEl && !part.text) {
      // Part announced but still empty (including an empty finalize): keep
      // the placeholder bouncing — the morph happens on the first delta,
      // so a content-free reasoning part can never leave an empty row.
      CI.state.pendingReasoning = part.id;
      CI.log("reasoning part (empty) -> pending morph:", part.id);
      return;
    }
    var entry;
    if (CI.state.placeholderEl) {
      entry = morphPlaceholderToReasoning(part);
    } else {
      var built = makeReasoningRow(part);
      CI.insertFlow(built.el);
      entry = {
        el: built.el, type: "reasoning", buf: part.text || "",
        textEl: built.textEl,
        cursorEl: built.el.querySelector(".stream-cursor"),
        rendered: part.text ? part.text.length : 0
      };
      CI.state.items[part.id] = entry;
    }
    if (part.text) {
      entry.buf = part.text;
      entry.rendered = part.text.length;
      CI.renderRich(entry.textEl, part.text);
    }
    if (part.time && part.time.end) {
      finalizeReasoning(entry, part);
    }
  }

  function isReasoningPart(partID) {
    if (partID === CI.state.pendingReasoning) return true;
    return !!(CI.state.items[partID] && CI.state.items[partID].type === "reasoning");
  }

  /** Streaming deltas append plain text only — code chips are rendered
   *  once at finalize (time.end). Per-token cost stays O(chunk); the old
   *  backtick-triggered full re-render was O(buffer) on nearly every delta
   *  (reasoning is full of `code` tokens). The FIRST delta of a pending
   *  part triggers the deferred placeholder morph — text exists now, so
   *  the thinking row becomes the reasoning row without any empty gap. */
  function appendReasoningDelta(partID, delta) {
    if (!delta) return;
    var entry = CI.state.items[partID];
    if (!entry && partID === CI.state.pendingReasoning && CI.state.placeholderEl) {
      entry = morphPlaceholderToReasoning({ id: partID });
    }
    if (!entry || entry.type !== "reasoning") return;
    entry.buf += delta;
    if (!entry.textEl) return;
    var chunk = entry.buf.slice(entry.rendered || 0);
    entry.rendered = entry.buf.length;
    entry.textEl.appendChild(document.createTextNode(chunk));
  }

  /** Show the bouncing thinking placeholder (fills empty stretches). */
  function showPlaceholder(text) {
    CI.breakGroup(); // a visible thinking gap ends any open tool group
    if (CI.state.placeholderEl) return;
    CI.state.placeholderEl = document.createElement("div");
    CI.state.placeholderEl.className = "cot-placeholder";
    CI.state.placeholderEl.innerHTML =
      '<span class="cot-dot"></span><span class="cot-placeholder-label">' + CI.esc(text || "Thinking") +
      '</span><span class="cot-placeholder-dots"><i></i><i></i><i></i></span>';
    CI.insertFlow(CI.state.placeholderEl);
    CI.log("placeholder shown:", text || "Thinking");
  }

  function hidePlaceholder() {
    CI.breakGroup(); // whatever replaces the placeholder is a new flow position
    if (CI.state.placeholderEl) {
      CI.state.placeholderEl.remove();
      CI.state.placeholderEl = null;
      CI.log("placeholder hidden");
    }
    CI.state.pendingReasoning = null;
  }

  CI.reasoning = {
    buildReasoningHead: buildReasoningHead,
    makeReasoningRow: makeReasoningRow,
    morphPlaceholderToReasoning: morphPlaceholderToReasoning,
    finalizeReasoning: finalizeReasoning,
    upsertReasoning: upsertReasoning,
    isReasoningPart: isReasoningPart,
    appendReasoningDelta: appendReasoningDelta,
    showPlaceholder: showPlaceholder,
    hidePlaceholder: hidePlaceholder
  };
})();
