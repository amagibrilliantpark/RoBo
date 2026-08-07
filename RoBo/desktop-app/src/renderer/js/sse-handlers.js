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
 *  else appends to the current message. */
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

/** Handle session status changes: busy, compacting, error, or idle. */
function handleSessionStatus(properties) {
  if (!properties) return;

  const eventSession = properties.sessionID || properties.id;
  // Strict filter: an out-of-band session.status (e.g. from another tab
  // or a stale event after a switch) must never mutate our UI.
  if (!eventSession || eventSession !== window.App.currentSession) return;

  const statusObj = properties.status;
  const status =
    typeof statusObj === "string"
      ? statusObj
      : (statusObj && statusObj.type) || "";

  const statusEl = Utils.$("sidebarStatus");
  if (!statusEl) return;

  // Real SessionStatus values are only "idle" | "busy" | "retry" (see opencode's
  // SessionStatus schema). There is no "error" status value â€” actual errors
  // arrive via the dedicated "session.error" event (handleSessionError below).
  // Compaction is signaled separately via the "session.compacted" event,
  // handled in handleSessionCompacted() below.
  if (status === "busy") {
    isCompacting = false;
    window.App.sessionBusy = true;
    if (
      statusEl.textContent === "Ready" ||
      statusEl.textContent.startsWith("Ready")
    ) {
      statusEl.textContent = "Processing...";
    }
  } else if (status === "retry") {
    window.App.sessionBusy = true;
    const attempt = (statusObj && statusObj.attempt) || 0;
    const retryMsg = (statusObj && statusObj.message) || "Retrying...";
    statusEl.textContent = `Retry ${attempt} \u2014 ${retryMsg}`;
    window.Chain.addMarker("retry", `Retry ${attempt} \u2014 ${retryMsg}`);
  } else if (status === "idle") {
    // `session.status` with type "idle" is emitted by OpenCode whenever a
    // generation finishes (including abort/error paths). The dedicated
    // `session.idle` event is *also* emitted in the same tick, so to avoid
    // doing the cleanup twice we delegate to handleSessionIdle() which is
    // idempotent — finalizeStreaming, setStopMode, hideAllStatusIndicators
    // and message re-fetch are all safe to run again.
    handleSessionIdle(properties);
  }
}

/** Handle the real "session.compacted" event fired when compaction finishes.
 *  OpenCode 1.17.18 OpenAPI spec: payload is { sessionID } only. */
function handleSessionCompacted(properties) {
  const eventSession = properties && (properties.sessionID || properties.id);
  if (eventSession && eventSession !== window.App.currentSession) return;

  isCompacting = false;
  window.Chain.finishMarker("compaction", "Context compacted \u2014 continuing");

  const sessionToRefresh = window.App.currentSession;
  if (!sessionToRefresh) return;
  // A full rebuild would wipe the in-flight streaming bubble mid-turn —
  // skip it while the model is still replying; deltas continue the bubble.
  if (document.querySelector(".ai-message-streaming")) return;
  setTimeout(() => {
      if (window.App.currentSession !== sessionToRefresh) return;
      window.electronAPI.session
        .messages(sessionToRefresh)
        .then((messages) => {
          if (window.App.currentSession !== sessionToRefresh) return;
          window.Chat.renderMessages(messages);
        })
        .catch(() => {});
    }, 100);
}

/** OpenCode 1.17+ new compaction API: a compaction round has started. */
function handleNextCompactionStarted(properties) {
  isCompacting = true;
  window.Chain.addMarker("compaction-active", "Compacting context...");
  // Pause streaming so the in-flight assistant bubble doesn't fight
  // with the compaction summary.
  if (window.SSE && typeof window.SSE.setCompacting === "function") {
    window.SSE.setCompacting(true);
  }
}

/** OpenCode 1.17+ new compaction API: streaming summary text. We just
 *  stash the most recent text on window.App for the .ended event. */
function handleNextCompactionDelta(properties) {
  if (!properties) return;
  if (!window.App.lastCompaction) {
    window.App.lastCompaction = { text: "", startedAt: Date.now() };
  }
  if (typeof properties.text === "string") {
    window.App.lastCompaction.text += properties.text;
  }
}

/** OpenCode 1.17+ new compaction API: compaction round finished. */
function handleNextCompactionEnded(properties) {
  isCompacting = false;
  if (window.SSE && typeof window.SSE.setCompacting === "function") {
    window.SSE.setCompacting(false);
  }
  window.Chain.finishMarker("compaction", "Context compacted \u2014 continuing");

  const sessionToRefresh = window.App.currentSession;
  if (!sessionToRefresh) return;
  // Same live-stream guard as handleSessionCompacted.
  if (document.querySelector(".ai-message-streaming")) return;
  setTimeout(() => {
    if (window.App.currentSession !== sessionToRefresh) return;
    window.electronAPI.session
      .messages(sessionToRefresh)
      .then((messages) => {
        if (window.App.currentSession !== sessionToRefresh) return;
        window.Chat.renderMessages(messages);
      })
      .catch(() => {});
  }, 100);
}

/** OpenCode 1.17+ new revert API. The .staged / .cleared / .committed
 *  events let the UI reflect the new ephemeral "revert" state without
 *  having to poll /session/{id}. The renderer simply re-fetches the
 *  session list so the chat shows the correct snapshot. */
function handleNextRevertEvent(data) {
  const t = data && data.type;
  if (!t) return;
  if (t === "session.next.revert.staged") {
    window.App.lastRevert = data.properties && data.properties.revert;
  } else if (t === "session.next.revert.cleared") {
    window.App.lastRevert = null;
  } else if (t === "session.next.revert.committed") {
    window.App.lastRevert = null;
  }
  // staged -> cleared -> committed arrive back-to-back; collapse the three
  // full-history rebuilds into a single trailing refresh.
  if (window.App.revertRefreshTimer) clearTimeout(window.App.revertRefreshTimer);
  window.App.revertRefreshTimer = setTimeout(() => {
    window.App.revertRefreshTimer = null;
    // Trigger a re-fetch of the session so any revert-bound messages
    // appear/disappear from the chat.
    const sessionToRefresh = window.App.currentSession;
    if (!sessionToRefresh) return;
    window.electronAPI.session
      .messages(sessionToRefresh)
      .then((messages) => {
        if (window.App.currentSession !== sessionToRefresh) return;
        window.Chat.renderMessages(messages);
      })
      .catch(() => {});
  }, 150);
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

/** Finalize streaming and reset UI when the session becomes idle. */
function handleSessionIdle(properties) {
  if (isCompacting) return;

  // opencode emits BOTH session.status(idle) and session.idle in the same
  // tick. The second call would re-fetch the whole history and re-run the
  // DOM diff pass again — dedupe anything within a short window.
  if (window.App.lastIdleAt && Date.now() - window.App.lastIdleAt < 250) return;
  window.App.lastIdleAt = Date.now();

  window.App.sessionBusy = false;
  if (properties && window.App.currentSession) {
    const eventSession = properties.sessionID || properties.id;
    if (eventSession && eventSession !== window.App.currentSession) {
      return;
    }
  }

  const statusEl = Utils.$("sidebarStatus");
  if (!statusEl) return;

  const currentText = statusEl.textContent;
  if (!currentText.includes("Ready") && !currentText.startsWith("Error")) {
    statusEl.textContent = "Ready";
  }
  window.Chat.finalizeStreaming();
  window.Chat.setStopMode(false);
  window.Chat.hideAllStatusIndicators();
  if (window.Chain && window.Chain.hidePlaceholder) {
    window.Chain.hidePlaceholder();
  }
  activeTextPartID = null;

  const sessionToRefresh = window.App.currentSession;
  if (sessionToRefresh) {
    window.electronAPI.session
      .messages(sessionToRefresh)
      .then((messages) => {
        if (window.App.currentSession !== sessionToRefresh) return;
        const msgList = messages.value || messages;
        // Skip the in-flight streaming bubble (if any) so the API-vs-UI
        // count below isn't thrown off by an unfinished assistant message.
        const existingMsgs = document.querySelectorAll(
          "#chatArea .message:not(.ai-message-streaming)",
        );

        // Update existing user messages with their IDs (they were sent without IDs)
        const uiUserMsgs = Array.from(existingMsgs).filter((m) =>
          m.classList.contains("user-message"),
        );
        const apiUserMsgs = msgList.filter(
          (m) => m.info && m.info.role === "user",
        );
        for (
          let i = 0;
          i < Math.min(uiUserMsgs.length, apiUserMsgs.length);
          i++
        ) {
          const uiMsg = uiUserMsgs[i];
          const apiMsg = apiUserMsgs[i];
          if (!uiMsg.dataset.messageId && apiMsg.info && apiMsg.info.id) {
            uiMsg.dataset.messageId = apiMsg.info.id;
            if (!uiMsg.querySelector(".msg-revert-btn")) {
              // The card already contains .msg-card-text + .msg-edit-textarea
              // (createMessageElement builds both from the same text). Read the
              // visible text from .msg-card-text ONLY — reading the whole card's
              // textContent would include the textarea's copy and duplicate the
              // message on screen. No need to rebuild the card innerHTML.
              const msgCard = uiMsg.querySelector(".msg-card");
              const textDiv = msgCard
                ? msgCard.querySelector(".msg-card-text")
                : null;
              const cardText = textDiv ? textDiv.textContent : "";

              const revertBtn = document.createElement("button");
              revertBtn.className = "msg-revert-btn";
              revertBtn.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h10a5 5 0 0 1 0 10H9"/><polyline points="7 14 3 10 7 6"/></svg>';
              revertBtn.title = "Revert to this point";
              revertBtn.addEventListener("click", () =>
                window.Revert.startEditMode(apiMsg.info.id, cardText, uiMsg),
              );
              uiMsg.appendChild(revertBtn);

              const sendBtn = document.createElement("button");
              sendBtn.className = "msg-send-btn";
              sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
              sendBtn.title = "Revert and send";
              sendBtn.addEventListener("click", () =>
                window.Revert.executeInlineRevert(apiMsg.info.id, uiMsg),
              );
              uiMsg.appendChild(sendBtn);
            }
          }
        }

        // Only count API messages that have actual text content (create UI divs)
        const textMsgList = msgList.filter(
          (msg) =>
            msg.parts && msg.parts.some((p) => p.type === "text" && p.text),
        );

        // Compare text-message count vs UI div count (includes streaming div)
        if (textMsgList.length > existingMsgs.length) {
          const startIndex = existingMsgs.length;
          const newMsgs = textMsgList.slice(startIndex);
          const chatArea = Utils.$("chatArea");
          const emptyState = Utils.$("emptyState");
          if (emptyState) emptyState.classList.remove("active");
          const frag = document.createDocumentFragment();
          for (const msg of newMsgs) {
            const role = msg.info ? msg.info.role : "assistant";
            const id = msg.info ? msg.info.id : null;
            for (const part of msg.parts) {
              if (part.type === "text" && part.text) {
                frag.appendChild(
                  window.Chat.Messages.createMessageElement(role, part.text, id),
                );
              }
            }
          }
          chatArea.appendChild(frag);
          chatArea.scrollTop = chatArea.scrollHeight;
        }
      })
      .catch((err) => {
        console.error(
          "[RevertDebug] Failed to re-fetch messages after idle:",
          err,
        );
      });
  }

  refreshSessionStats();
}

/** Handle dedicated session.error events from the backend. */
function handleSessionError(properties) {
  if (!properties) return;
  const eventSession = properties.sessionID || properties.id;
  if (eventSession && eventSession !== window.App.currentSession) return;

  // If the user pressed Stop, the trailing message.updated(completed=true)
  // will surface "Generation stopped by user" via the abortedByUser flag
  // (Bug #11 fix). Showing the raw AbortedError here would create a
  // duplicate error bubble, so suppress it.
  const errorObj = properties.error || properties.message || properties;
  const errorName =
    typeof errorObj === "object" && errorObj ? errorObj.name : "";
  if (window.App.abortedByUser && errorName === "MessageAbortedError") {
    window.Chat.setStopMode(false);
    isCompacting = false;
    return;
  }

  const statusEl = Utils.$("sidebarStatus");
  if (statusEl) statusEl.textContent = "Error";
  window.App.sessionBusy = false;
  window.Chat.setStopMode(false);
  isCompacting = false;

  const errorStr =
    typeof errorObj === "string"
      ? errorObj
      : errorObj.message || JSON.stringify(errorObj);
  if (window.Chain && window.Chain.addMarker) {
    window.Chain.addMarker("error", "Error \u2014 " + errorStr);
  }
  if (window.Chain && window.Chain.hidePlaceholder) {
    window.Chain.hidePlaceholder();
  }
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

/** Update session title in the sidebar and right panel when renamed by the backend. */
function handleSessionUpdated(properties) {
  if (!properties) return;
  const sessionId =
    properties.id || properties.sessionID || properties.session_id;
  const title =
    properties.title ||
    (properties.info && properties.info.title) ||
    (properties.session && properties.session.title);

  if (!title || !sessionId) return;
  if (title.startsWith("New Session-")) return;

  if (window.App.currentSession === sessionId) {
    window.RightPanel.updateSessionName(title);
  }
  const session = window.App.sessions.find((s) => s.id === sessionId);
  if (session) {
    session.title = title;
    window.Sessions.renderSessionList();
  }
}

/**
 * A message was removed server-side (e.g. the trailing message after a revert
 * gets dropped, or the CLI trimmed history). Re-render the chat so the local
 * list stays in sync with what the server actually has.
 */
function handleMessageRemoved(properties) {
  if (!properties) return;
  const sid = properties.sessionID || properties.id;
  if (sid && sid !== window.App.currentSession) return;
  const sessionId = window.App.currentSession;
  if (!sessionId) return;
  window.electronAPI.session
    .messages(sessionId)
    .then((messages) => {
      if (window.App.currentSession !== sessionId) return;
      if (window.Chat && window.Chat.renderMessages) {
        window.Chat.renderMessages(messages);
      }
    })
    .catch((err) => {
      console.error("[SSE] message.removed reload failed:", err);
    });
}

/**
 * A new session was created externally (e.g. via the `opencode` CLI or by
 * the SyncRo plugin). Refresh the sidebar so the new card appears without
 * requiring a manual reload.
 */
function handleSessionCreated(properties) {
  if (!properties) return;
  const info = properties.info || properties;
  const id = info.id || properties.sessionID || properties.id;
  const title = info.title || properties.title || "New Session";
  if (!id) return;
  if (window.App.sessions.some((s) => s.id === id)) return;
  window.App.sessions.unshift({
    id,
    title,
    parentID: info.parentID,
    time: info.time,
    attached: false,
  });
  if (window.Sessions && window.Sessions.renderSessionList) {
    window.Sessions.renderSessionList();
  }
}

/**
 * A session was deleted externally. Remove it from the local list and
 * clear the chat if the active session is the one that got removed.
 */
function handleSessionDeleted(properties) {
  if (!properties) return;
  const id = properties.sessionID || properties.id || (properties.info && properties.info.id);
  if (!id) return;
  window.App.sessions = window.App.sessions.filter((s) => s.id !== id);
  if (window.Sessions && window.Sessions.renderSessionList) {
    window.Sessions.renderSessionList();
  }
  if (window.App.currentSession === id) {
    window.App.currentSession = null;
    if (window.Chat && window.Chat.resetStreamingAccum) {
      window.Chat.resetStreamingAccum();
    }
    if (window.Chat && window.Chat.hideAllStatusIndicators) {
      window.Chat.hideAllStatusIndicators();
    }
    const chatArea = document.getElementById("chatArea");
    const emptyState = document.getElementById("emptyState");
    if (chatArea) {
      chatArea
        .querySelectorAll(".message, .streaming-cursor")
        .forEach((m) => m.remove());
    }
    if (emptyState) emptyState.classList.add("active");
    if (window.RightPanel) {
      window.RightPanel.updateSessionName("New Chat");
      window.RightPanel.clearTodoList();
      window.RightPanel.updateContextStats(null);
    }
  }
}

/**
 * Session diff info pushed by the backend. Currently we just log it —
 * diff visualization is left to a future right-panel feature.
 */
function handleSessionDiff(properties) {
  if (!properties) return;
  const sid = properties.sessionID || properties.id;
  if (sid && sid !== window.App.currentSession) return;
  // Expose on App for any panel that wants to show it.
  window.App.lastSessionDiff = properties;
}

/**
 * A file was edited on disk by the SyncRo plugin or another process.
 * We don't render chat content for it, but the right panel may want to
 * refresh the file list. For now we just log and let consumers subscribe.
 */
function handleFileEdited(properties) {
  if (!properties) return;
  // Push a custom DOM event so any panel can listen without coupling here.
  document.dispatchEvent(
    new CustomEvent("robo:file-edited", { detail: properties }),
  );
}