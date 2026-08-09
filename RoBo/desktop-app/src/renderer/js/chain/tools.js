/* Chain of Thoughts — tool cards + same-type grouping.
 * Compact cards: icon + tool name + one-line title. Bash is the one
 * exception — its terminal output streams right below the card.
 * Consecutive same-type calls (read/glob/grep/webfetch/edit/write) morph
 * into ONE grouped card whose clickable count reveals the per-call names. */
(function () {
  "use strict";

  var CI = window.ChainInternal;

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
    icon.innerHTML = CI.iconFor(part.tool);
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
      entry.titleEl.textContent = state.title || CI.inputSubtitle(part.tool, state.input) || "";
      CI.setToolHover(entry, part);
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
    handleToolPart(part, function (el) { CI.insertTool(el); });
  }

  /* ── Tool grouping (consecutive same-type exploration calls) ── */

  function groupNoun(tool) {
    if (tool === "grep") return "matches";
    if (tool === "websearch" || tool === "webfetch") return "urls";
    return "files";
  }

  function updateGroupRowState(member, part) {
    member.status = (part.state && part.state.status) || "pending";
    // Tool parts often arrive as pending WITHOUT input; the richer update
    // (running/completed with filePath etc.) must refresh the detail label
    // — but never downgrade a good label back to the tool name.
    var lbl = groupLabel(part);
    if (lbl !== part.tool) member.label = lbl;
  }

  function updateGroupHead(group) {
    // The tool name lives in the name chip ("read") — the title only shows
    // the growing count, so the head reads "read · 2 files" once, not twice.
    group.entry.titleEl.textContent = group.count + " " + groupNoun(group.tool);
    var anyPending = false;
    var anyFailed = false;
    for (var i = 0; i < group.rows.length; i++) {
      var st = group.rows[i].status;
      if (st !== "completed" && st !== "error") anyPending = true;
      if (st === "error") anyFailed = true;
    }
    if (anyPending) {
      // Re-opened group (new member after a settle): drop settled classes so
      // the detail rows become visible again.
      group.entry.el.classList.remove("ok", "fail");
      group.entry.el.classList.remove("pending");
      group.entry.el.classList.add("running");
      if (!group.ringEl) {
        var ring = document.createElement("span");
        ring.className = "cot-ring";
        var head = group.entry.el.querySelector(".cot-head");
        head.insertBefore(ring, head.firstChild);
        group.ringEl = ring;
      }
    } else if (group.ringEl && group.ringEl.isConnected) {
      group.ringEl.remove();
      group.ringEl = null;
      group.entry.el.classList.remove("running");
      group.entry.el.classList.add(anyFailed ? "fail" : "ok");
    }
  }

  /** The short label shown in the click-to-open group detail: file NAME
   *  for reads/edits/writes (not the full path), the raw pattern/query for
   *  the others. Handles both / and \ path separators (Windows). */
  function groupLabel(part) {
    var input = (part.state && part.state.input) || {};
    var raw = input.filePath || input.path || input.pattern || input.url || input.query || "";
    if (!raw) return part.tool;
    if (typeof input.filePath === "string" || typeof input.path === "string") {
      var norm = raw.replace(/\\/g, "/");
      var idx = norm.lastIndexOf("/");
      return idx === -1 ? raw : norm.slice(idx + 1);
    }
    if (typeof input.url === "string") return CI.shortUrl(raw);
    return raw;
  }

  function renderGroupDetail(group, list) {
    list.textContent = "";
    for (var i = 0; i < group.rows.length; i++) {
      var m = group.rows[i];
      var line = document.createElement("div");
      line.className = "cot-group-detail-item" + (m.status === "error" ? " failed" : "");
      line.textContent = m.label;
      list.appendChild(line);
    }
  }

  /** The count text is clickable: one click opens a LIGHT detail below the
   *  card (just the file names), another click folds it away. */
  function toggleGroupDetail(group) {
    var item = group.entry.el;
    var list = item.querySelector(".cot-group-detail");
    if (!list) {
      list = document.createElement("div");
      list.className = "cot-group-detail";
      item.appendChild(list);
    }
    if (item.classList.contains("open")) {
      item.classList.remove("open");
      return;
    }
    renderGroupDetail(group, list);
    item.classList.add("open");
  }

  function refreshGroupDetail(group) {
    if (!group.entry.el.classList.contains("open")) return;
    var list = group.entry.el.querySelector(".cot-group-detail");
    if (list) renderGroupDetail(group, list);
  }

  /** The second consecutive same-type call turns the normal card into a
   *  group card in place: header becomes "2 files" and the count keeps
   *  climbing live. The group is always the compact single line — the
   *  per-call names only appear on demand, under the count (click to
   *  toggle). Position never moves. */
  function morphToGroup(entry, part) {
    var item = entry.el;
    item.classList.add("group");
    var group = {
      tool: entry.groupData.tool,
      entry: entry,
      count: 2,
      rows: [],
      ringEl: item.querySelector(".cot-ring") || null
    };
    entry.groupData.group = group;
    CI.state.currentGroup = group;

    var m1 = { isGroupRow: true, group: group, status: "pending", label: groupLabel(entry.groupData.firstPart) };
    CI.state.items[entry.groupData.firstPart.id] = m1;
    group.rows.push(m1);
    var m2 = { isGroupRow: true, group: group, status: "pending", label: groupLabel(part) };
    CI.state.items[part.id] = m2;
    group.rows.push(m2);
    updateGroupRowState(m1, entry.groupData.firstPart);
    updateGroupRowState(m2, part);
    entry.titleEl.classList.add("group-toggle");
    entry.titleEl.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleGroupDetail(group);
    });
    updateGroupHead(group);
    CI.log("tool group:", group.tool, "x2");
  }

  function appendGroupMember(part) {
    var group = CI.state.currentGroup;
    var m = { isGroupRow: true, group: group, status: "pending", label: groupLabel(part) };
    CI.state.items[part.id] = m;
    group.rows.push(m);
    group.count++;
    updateGroupRowState(m, part);
    updateGroupHead(group);
    refreshGroupDetail(group);
    CI.log("tool group:", group.tool, "x" + group.count);
  }

  /** Shared by the live stream (upsertTool) and the rebuild path (api.js):
   *  creates cards, morphs/extends groups, routes updates to rows or cards. */
  function handleToolPart(part, insertFn) {
    if (!part || !part.id) return;
    var existing = CI.state.items[part.id];
    if (existing) {
      if (existing.isGroupRow) {
        updateGroupRowState(existing, part);
        updateGroupHead(existing.group);
        refreshGroupDetail(existing.group);
      } else {
        // Solo card: keep the freshest part for a possible later morph.
        if (existing.groupData) existing.groupData.firstPart = part;
        applyToolState(existing, part);
      }
      return;
    }
    if (CI.isGroupable(part.tool) && CI.state.currentGroup && CI.state.currentGroup.tool === part.tool) {
      if (CI.state.currentGroup.count === 1) {
        morphToGroup(CI.state.currentGroup.entry, part);
      } else {
        appendGroupMember(part);
      }
      return;
    }
    CI.breakGroup();
    var built = makeToolRow(part);
    insertFn(built.el);
    existing = {
      el: built.el, type: "tool", state: part.state || {},
      titleEl: built.titleEl, outputEl: built.outputEl, childrenEl: null
    };
    CI.state.items[part.id] = existing;
    if (CI.isGroupable(part.tool)) {
      existing.groupData = { tool: part.tool, firstPart: part, group: null, row: null };
      CI.state.currentGroup = { tool: part.tool, entry: existing, listEl: null, count: 1, rows: [], ringEl: null };
    }
    applyToolState(existing, part);
    CI.log("tool row:", part.tool, part.state && part.state.status);
  }

  /** Map a task tool's child session to its row (for nested streaming). */
  function registerChild(entry, part) {
    var meta = (part.state && part.state.metadata) || {};
    if (part.tool !== "task" || !meta.sessionId) return;
    CI.state.childSessions[meta.sessionId] = part.id;
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
    // the tool is pending/running, then it disappears. Grouped cards keep
    // their ring until the WHOLE group settles (updateGroupHead removes it).
    var ring = item.querySelector(".cot-ring");
    var solo = !(entry.groupData && entry.groupData.group);
    if (ring && solo) ring.remove();

    var state = part.state || {};
    var fallback = CI.inputSubtitle(part.tool, state.input) || "";
    entry.titleEl.textContent = ok
      ? (state.title || fallback)
      : (state.error || state.title || fallback);
    CI.setToolHover(entry, part);

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
    var entry = CI.state.items[partID];
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

  CI.tools = {
    makeToolRow: makeToolRow,
    applyToolState: applyToolState,
    renderToolOutput: renderToolOutput,
    upsertTool: upsertTool,
    handleToolPart: handleToolPart,
    registerChild: registerChild,
    finalizeTool: finalizeTool,
    appendToolOutputDelta: appendToolOutputDelta,
    groupNoun: groupNoun,
    updateGroupRowState: updateGroupRowState,
    updateGroupHead: updateGroupHead,
    groupLabel: groupLabel,
    renderGroupDetail: renderGroupDetail,
    toggleGroupDetail: toggleGroupDetail,
    refreshGroupDetail: refreshGroupDetail,
    morphToGroup: morphToGroup,
    appendGroupMember: appendGroupMember
  };
})();
