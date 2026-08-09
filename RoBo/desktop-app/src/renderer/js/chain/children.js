/* Chain of Thoughts — nested content from task-tool child sessions.
 * Subagents (task tool) stream their own parts on the same global /event
 * bus; they render as compact lines inside the owning task card. */
(function () {
  "use strict";

  var CI = window.ChainInternal;

  function childrenElFor(sessionID) {
    var partID = CI.state.childSessions[sessionID];
    var entry = partID && CI.state.items[partID];
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
    if (!CI.state.childParts[sessionID]) CI.state.childParts[sessionID] = {};
    var registry = CI.state.childParts[sessionID];

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
      CI.scrollToBottom();
    } else if (part.type === "tool") {
      var state = part.state || {};
      var toolLine = registry[part.id];
      if (!toolLine) {
        toolLine = document.createElement("div");
        toolLine.className = "cot-subtask-tool active";
        toolLine.dataset.partId = part.id;
        toolLine.innerHTML =
          '<span class="cot-ring"></span>' +
          '<span class="cot-subtask-icon">' + CI.iconFor(part.tool) + '</span>' +
          '<span class="cot-subtask-agent">' + CI.esc(part.tool) + '</span>';
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
        state.title || state.error || CI.inputSubtitle(part.tool, state.input) || "";
      CI.scrollToBottom();
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
      CI.scrollToBottom();
    }
  }

  function appendChildPartDelta(sessionID, partID, field, delta) {
    if (field !== "text" || !delta) return;
    var registry = CI.state.childParts[sessionID];
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
    CI.scrollToBottom();
  }

  function removeChildPart(sessionID, partID) {
    var registry = CI.state.childParts[sessionID];
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
        CI.esc("Retry " + (status.attempt || 0) + " \u2014 " + (status.message || "retrying")) + '</span>';
      container.appendChild(line);
      CI.scrollToBottom();
    } else if (status.type === "idle" && CI.state.childSessions[sessionID]) {
      // Child finished; mark any still-active nested lines done and drop
      // its registries so long sessions don't accumulate every subagent's
      // part buffers in memory.
      container.querySelectorAll(".cot-subtask.active, .cot-subtask-tool.active").forEach(function (el) {
        el.classList.remove("active");
        el.classList.add("done");
        var ring = el.querySelector(".cot-ring");
        if (ring) ring.remove();
      });
      delete CI.state.childSessions[sessionID];
      delete CI.state.childParts[sessionID];
    }
  }

  CI.children = {
    childrenElFor: childrenElFor,
    attachChildPart: attachChildPart,
    appendChildPartDelta: appendChildPartDelta,
    removeChildPart: removeChildPart,
    childSessionStatus: childSessionStatus
  };
})();
