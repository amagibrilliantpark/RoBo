/* Chain of Thoughts — turn lifecycle, markers, removal, rebuild + the
 * public window.Chain API. This file must load LAST among the chain
 * modules (see index.html): it assembles the exports of core.js /
 * reasoning.js / tools.js / children.js into the window.Chain surface the
 * rest of the renderer calls.
 *
 * Event sources (all verified against opencode v1.17.18):
 *   - message.part.updated  (full part: reasoning start/finalize, tool states)
 *   - message.part.delta    (field "text" deltas; shared by text & reasoning)
 *   - message.part.removed  (part dropped)
 *   - session.status        (retry)
 *   - session.next.compaction.* / session.compacted
 *   - child sessions (task tool) stream parts on the same global /event bus */
(function () {
  "use strict";

  var CI = window.ChainInternal;

  /* ── Turn lifecycle ── */

  /** A new user turn: remember the user's message as the chain anchor and
   *  reset the part registries (the previous turn's rows are done — they
   *  stay rendered where they are). */
  function markTurn() {
    var area = CI.chatArea();
    if (!area) return null;
    var users = area.querySelectorAll(".user-message");
    CI.state.turnUserMsg = users.length ? users[users.length - 1] : null;
    CI.state.turnAnchor = CI.state.turnUserMsg || null;
    CI.state.items = {};
    CI.state.childSessions = {};
    CI.state.childParts = {};
    CI.state.placeholderEl = null;
    CI.state.pendingReasoning = null;
    CI.state.currentGroup = null; // a new turn never continues a previous group
    return CI.state.turnUserMsg;
  }

  /* ── Markers (retry / compaction / stop) ── */

  function addMarker(type, text) {
    CI.breakGroup(); // a marker (retry/compaction) is a flow change: groups close
    var cls = typeof type === "string" ? type.replace(/[^a-z0-9-]/gi, "") : "note";
    if (!cls) cls = "note";
    var item = document.createElement("div");
    item.className = "cot-marker " + cls;
    item.innerHTML =
      '<span class="cot-marker-dot"></span><span class="cot-marker-text">' + CI.esc(text) + '</span>';
    CI.insertFlow(item);
    return item;
  }

  function finishMarker(type, text) {
    var area = CI.chatArea();
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
    var entry = CI.state.items[partID];
    if (entry && entry.isGroupRow) {
      var group = entry.group;
      group.rows = group.rows.filter(function (m) { return m !== entry; });
      group.count--;
      delete CI.state.items[partID];
      if (group.rows.length === 0) {
        group.entry.el.remove();
        delete CI.state.items[group.entry.el.dataset.partId];
        CI.state.currentGroup = null;
      } else {
        CI.tools.updateGroupHead(group);
        CI.tools.refreshGroupDetail(group);
      }
    } else if (entry) {
      entry.el.remove();
      delete CI.state.items[partID];
    }
    if (CI.state.pendingReasoning === partID) CI.state.pendingReasoning = null;
    for (var sid in CI.state.childSessions) {
      if (CI.state.childSessions[sid] === partID) {
        delete CI.state.childSessions[sid];
        delete CI.state.childParts[sid];
      }
    }
  }

  function clearChainDom() {
    var area = CI.chatArea();
    if (area) {
      area.querySelectorAll(".cot-item, .cot-placeholder, .cot-marker, .cot-children, .chain-list").forEach(function (el) {
        el.remove();
      });
    }
  }

  function resetRegistries() {
    CI.state.items = {};
    CI.state.childSessions = {};
    CI.state.childParts = {};
    CI.state.placeholderEl = null;
    CI.state.pendingReasoning = null;
    CI.state.turnAnchor = null;
    CI.state.turnUserMsg = null;
    CI.state.currentGroup = null;
  }

  /** Drop every chain row and registry (session switch / new chat). */
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
    CI.log("rebuild started");
  }

  function rebuildPart(part, parent) {
    if (!part || !part.id) return;
    var target = parent || CI.chatArea();
    if (!target) return;
    if (part.type === "reasoning") {
      CI.breakGroup(); // reasoning between tools closes any open group (live parity)
      var built = CI.reasoning.makeReasoningRow(part);
      var entry = {
        el: built.el, type: "reasoning", buf: part.text || "",
        textEl: built.textEl,
        cursorEl: built.el.querySelector(".stream-cursor"),
        rendered: part.text ? part.text.length : 0
      };
      CI.state.items[part.id] = entry;
      if (part.time && part.time.end) CI.reasoning.finalizeReasoning(entry, part);
      else if (part.text) CI.renderRich(entry.textEl, part.text);
      target.appendChild(built.el);
    } else if (part.type === "tool") {
      // Shared with the live stream: consecutive same-type exploration
      // calls get rebuilt as one grouped card, in flow position.
      CI.tools.handleToolPart(part, function (el) { target.appendChild(el); });
    }
  }

  function endRebuild() {
    var area = CI.chatArea();
    var users = area ? area.querySelectorAll(".user-message") : [];
    CI.state.turnUserMsg = users.length ? users[users.length - 1] : null;
    CI.state.turnAnchor = CI.state.turnUserMsg || null;
    CI.state.placeholderEl = null;
    CI.state.pendingReasoning = null;
    CI.state.currentGroup = null;
    CI.log("rebuild done; rows:", Object.keys(CI.state.items).length);
  }

  function isChildSession(sessionID) {
    return !!CI.state.childSessions[sessionID];
  }

  window.Chain = {
    upsertReasoning: CI.reasoning.upsertReasoning,
    isReasoningPart: CI.reasoning.isReasoningPart,
    appendReasoningDelta: CI.reasoning.appendReasoningDelta,
    upsertTool: CI.tools.upsertTool,
    appendToolOutputDelta: CI.tools.appendToolOutputDelta,
    attachChildPart: CI.children.attachChildPart,
    appendChildPartDelta: CI.children.appendChildPartDelta,
    removeChildPart: CI.children.removeChildPart,
    childSessionStatus: CI.children.childSessionStatus,
    isChildSession: isChildSession,
    showPlaceholder: CI.reasoning.showPlaceholder,
    hidePlaceholder: CI.reasoning.hidePlaceholder,
    addMarker: addMarker,
    finishMarker: finishMarker,
    removePart: removePart,
    reset: reset,
    markTurn: markTurn,
    beginRebuild: beginRebuild,
    rebuildPart: rebuildPart,
    endRebuild: endRebuild,
    scheduleScroll: CI.scrollToBottom
  };
})();
