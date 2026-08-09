/* SSE handlers — message parts & per-turn interactive flow.
 * This file (with sse-sessions.js) replaces the old single sse-handlers.js.
 * All functions stay in the global scope, exactly like before, so the
 * cross-file calls from sse-core.js keep working: it only routes event
 * types to these handlers at runtime.
 *
 * Part-level responsibilities:
 *   - message.part.updated / message.part.delta  (streaming + chain rows)
 *   - message.updated / message.part.removed     (message lifecycle)
 *   - todo.updated                               (right-panel todos)
 *   - question.v2.asked / permission.v2.asked     (interactive turn requests) */

/** Handle message part updates: show thinking indicators, track text parts, update todos. */
function handlePartUpdate(properties) {
  if (!properties || isCompacting) return;
  const { part, sessionID } = properties;
  if (!part || sessionID !== window.App.currentSession) return;

  if (
    (part.type === "reasoning" ||
      part.type === "step-start" ||
      part.type === "text") &&
    !window.App.isProcessing
  ) {
    window.Chat.setStopMode(true);
  }

  if (part.type === "reasoning") {
    window.Chain.upsertReasoning(part);
  } else if (part.type === "step-start") {
    window.Chain.showPlaceholder("Thinking");
    window.Chat.resetStreamingAccum();
  } else if (part.type === "text") {
    if (part.id !== activeTextPartID) {
      window.Chat.resetStreamingAccum();
    }
    activeTextPartID = part.id;
    // Only drop the placeholder when real content has arrived. The text
    // part is created empty BEFORE the model streams anything — hiding
    // the placeholder here leaves a dead gap until reasoning/text start.
    if (part.text && window.Chain && window.Chain.hidePlaceholder) {
      window.Chain.hidePlaceholder();
    }
  } else if (part.type === "step-finish") {
    activeTextPartID = null;
    window.Chat.removeStreamingCursor();
  } else if (part.type === "tool") {
    window.Chain.upsertTool(part);
    if (part.tool === "todowrite" && part.state && part.state.input) {
      const todos = part.state.input.todos;
      if (Array.isArray(todos)) {
        window.RightPanel.updateTodoList(todos);
      }
    }
  } else if (part.type === "retry") {
    const attempt = part.attempt || 0;
    const errMsg =
      (part.error && (part.error.message || part.error.detail)) || "retrying";
    window.Chain.addMarker("retry", `Retry ${attempt} \u2014 ${errMsg}`);
  } else if (part.type === "compaction") {
    window.Chain.addMarker("compaction", "Context compacted \u2014 continuing");
  }
}

/** Handle streaming text deltas - route by part ID: reasoning deltas go to
 *  the Chain (text and reasoning share the field name "text"), everything
 *  else appends to the current message. Tool output ("output" field) goes
 *  to the bash card. */
function handlePartDelta(properties) {
  if (!properties || isCompacting) return;
  const { field, delta, sessionID, partID } = properties;
  if (sessionID !== window.App.currentSession) return;

  if (field === "text" && delta) {
    if (partID && window.Chain && window.Chain.isReasoningPart(partID)) {
      window.Chain.appendReasoningDelta(partID, delta);
    } else if (partID === activeTextPartID) {
      // Real text is flowing now — the placeholder's job is done.
      if (window.Chain && window.Chain.hidePlaceholder) {
        window.Chain.hidePlaceholder();
      }
      window.Chat.appendStreamingText(delta);
    }
  } else if (field === "output" && delta) {
    if (partID && window.Chain && window.Chain.appendToolOutputDelta) {
      window.Chain.appendToolOutputDelta(partID, delta);
    }
  }
}

/** Reset streaming when a completed message update arrives. */
function handleMessageUpdated(properties) {
  if (!properties) return;
  // Defensive sessionID filter: even though sse-core.js already routes via
  // isCurrent, an out-of-band message.updated for another session would
  // otherwise drop our stop-button + cursor into the wrong chat.
  const eventSession = properties.sessionID || properties.id;
  if (eventSession && eventSession !== window.App.currentSession) return;
  const info = properties.info || properties;
  if (info.time && info.time.completed) {
    // If the user pressed Stop while this message was streaming, surface that
    // in the chat so the empty tail doesn't look like a successful response.
    if (window.App.abortedByUser) {
      window.App.abortedByUser = false;
      window.App.sessionBusy = false;
      if (window.Chain && window.Chain.addMarker) {
        window.Chain.addMarker("stop", "Generation stopped by user");
      }
    }
    window.Chat.finalizeStreaming();
    // One message completing is NOT the end of the generation: opencode
    // completes the assistant message at every step boundary (e.g. after
    // each tool round). Dropping stop-mode here would flip the button to
    // "send" between steps, then back to "stop" when the next step's
    // first part lands. Only when the session is no longer busy (idle /
    // error / abort) may the send button return.
    // Exception: a question tool can end the model's turn while the
    // session stays busy waiting for the answer — that completion must
    // NOT drop the stop button (the generation continues after respond).
    if (window.App.questionPending) return;
    const role = (info && info.role) || (properties.role);
    if ((!role || role === "assistant") && !window.App.sessionBusy) {
      // The message is done: no more deltas should attach to it. Null the
      // active part id so a straggler delta can't append into the
      // finalized bubble.
      activeTextPartID = null;
      if (window.Chat && window.Chat.setStopMode) {
        window.Chat.setStopMode(false);
      }
      window.Chat.hideAllStatusIndicators();
    }
  }
}

/** A specific part was removed (e.g. cancelled tool, retracted text). */
function handleMessagePartRemoved(properties) {
  if (!properties) return;
  const partID = properties.partID || properties.id;
  if (!partID) return;
  if (window.Chain && window.Chain.removePart) {
    window.Chain.removePart(partID);
  }
  const container = Utils.$("chatArea");
  if (!container) return;
  // Any element tagged with data-part-id matching the removed part is
  // orphaned and should be cleaned up.
  const orphan = container.querySelector(`[data-part-id="${partID}"]`);
  if (orphan) orphan.remove();
  // If the active streaming part was removed, reset the accumulators
  // so the next text delta starts a fresh bubble.
  if (partID === activeTextPartID) {
    activeTextPartID = null;
    if (window.Chat && window.Chat.resetStreamingAccum) {
      window.Chat.resetStreamingAccum();
    }
  }
}

/** Update the todo list in the right panel when the backend pushes changes. */
function handleTodoUpdated(properties) {
  if (!properties) return;
  const eventSession = properties.sessionID || properties.id;
  if (eventSession && eventSession !== window.App.currentSession) return;
  const todos = properties.todos || properties.items || properties;
  if (Array.isArray(todos)) {
    window.RightPanel.updateTodoList(todos);
    // Auto-open todo list when AI creates/updates todos
    const todoList = Utils.$("todoList");
    const todoHeader = Utils.$("todoHeader");
    if (
      todoList &&
      !todoList.classList.contains("active") &&
      todos.length > 0
    ) {
      todoList.classList.add("active");
      const arrow = todoHeader?.querySelector(".todo-arrow");
      if (arrow) arrow.textContent = "\u25BC";
    }
  }
}

/** OpenCode 1.17+ new question API. Re-shape v2 payload and re-use the
 *  existing v1 modal helper. */
function handleQuestionV2Asked(properties) {
  if (!properties) return;
  // v2 payload: { id, sessionID, questions: QuestionV2Info[] }
  // v1 modal expects: { id, sessionID, questions: QuestionInfo[] }
  const shaped = {
    id: properties.id,
    sessionID: properties.sessionID,
    questions: (properties.questions || []).map((q) => ({
      question: q.question || q.header || "",
      header: q.header,
      options: (q.options || []).map((o) =>
        typeof o === "string" ? o : o.label || o.value || "",
      ),
    })),
    tool: properties.tool,
  };
  if (window.Modals && window.Modals.showQuestionModal) {
    window.Modals.showQuestionModal(shaped);
  }
}

/** OpenCode 1.17+ new permission API. Re-shape v2 payload into the v1
 *  shape the RoBo UI already understands. */
function handlePermissionV2Asked(properties) {
  if (!properties) return;
  const shaped = {
    id: properties.id,
    sessionID: properties.sessionID,
    permission: properties.action,
    patterns: properties.resources || [],
    metadata: properties.metadata || {},
    always: properties.save || [],
    tool: {
      messageID: properties.metadata && properties.metadata.messageID,
      callID: properties.metadata && properties.metadata.callID,
    },
  };
  // Reuse the existing v1 handler.
  handlePermissionAsked(shaped);
}

/** Handle permission requests (currently a no-op placeholder). */
function handlePermissionAsked(properties) {
  if (!properties) return;
  const sessionID = properties.sessionID || properties.id;
  if (sessionID && sessionID !== window.App.currentSession) return;
  // OpenCode sometimes sends a bare "permission.asked" with no detail (e.g.
  // when the request was already auto-allowed). Anything more meaningful
  // gets stored on window.App so a future permission modal can pick it up.
  window.App.lastPermissionRequest = properties;
  document.dispatchEvent(
    new CustomEvent("robo:permission-asked", { detail: properties }),
  );
}
