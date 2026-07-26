/** Fetch all sessions from the backend. */
async function loadSessions() {
  const t0 = performance.now();
  try {
    const response = await window.electronAPI.session.list();
    const rawSessions = response.value || response || [];
    // "attached" (pinned) is an EasyRo-only concept; the backend has no such field,
    // so we persist it inside the session's free-form `metadata` object instead.
    const allSessions = rawSessions.map((s) => ({
      ...s,
      attached: !!(s.metadata && s.metadata.attached),
    }));
    window.App.sessions = allSessions;
    window.App.sessionsCacheTime = Date.now();
    renderSessionList();
  } catch (error) {
    console.error(
      `[Session] loadSessions FAILED in ${(performance.now() - t0).toFixed(0)}ms:`,
      error.message,
    );
    if (window.App.debug) console.error("Failed to load sessions:", error);
  }
}
/** Get sessions from cache if recent, otherwise fetch from backend. */
async function getSessions(useCache = true) {
  const CACHE_TTL = 5000; // 5 seconds

  if (
    useCache &&
    window.App.sessionsCacheTime &&
    Date.now() - window.App.sessionsCacheTime < CACHE_TTL
  ) {
    return window.App.sessions || [];
  }

  await loadSessions();
  return window.App.sessions || [];
}
/** Switch to a session: save current files, load target files, load messages/todo. */
async function selectSession(sessionId) {
  if (_switchingSession) return;
  _switchingSession = true;

  try {
    // 0. Abort in-progress generation
    if (window.App.isProcessing && window.App.currentSession) {
      try {
        await window.electronAPI.session.abort(window.App.currentSession);
        await new Promise((r) => setTimeout(r, 300));
      } catch (e) {}
      if (window.Chat && window.Chat.setStopMode) {
        window.Chat.setStopMode(false);
      } else {
        window.App.isProcessing = false;
      }
    }

    // 1. Save current session's files
    if (window.App.currentSession && window.App.currentSession !== sessionId) {
      const saveResult = await window.electronAPI.session.saveCurrent();
      if (!saveResult.success) {
        console.error("[Session] Failed to save session:", saveResult.error);
        return;
      }
    }

    // 2. Restore new session's files
    const restoreResult = await window.electronAPI.session.restore(sessionId);
    if (!restoreResult.success) {
      console.error(
        "[Session] Failed to restore session:",
        restoreResult.error,
      );
      return;
    }

    // 3. Update UI + reset all streaming/SSE state so a stale stream
    //    from the previous session can't bleed into the new one.
    window.Chat.resetStreamingAccum();
    window.Chat.hideAllStatusIndicators();
    window.Chat.removeStreamingCursor();
    if (window.SSE && typeof window.SSE.resetState === "function") {
      window.SSE.resetState();
    }
    // The abortedByUser flag is per-message; clear it on session switch.
    window.App.abortedByUser = false;
    // Clear the chat area immediately so the user doesn't see the
    // previous session's messages while we wait for the new messages
    // to load (Bug #26: initial render flicker).
    const chatArea = Utils.$("chatArea");
    if (chatArea) {
      chatArea
        .querySelectorAll(".message, .thinking-indicator, .error-indicator, .compaction-indicator, .usage-indicator, .streaming-cursor")
        .forEach((m) => m.remove());
    }
    const emptyStateEl = Utils.$("emptyState");
    if (emptyStateEl) emptyStateEl.classList.add("active");
    window.App.currentSession = sessionId;

    document.querySelectorAll(".session-card").forEach((c) => {
      c.classList.toggle("active", c.dataset.id === sessionId);
    });

    const session = window.App.sessions.find((s) => s.id === sessionId);
    if (session) {
      window.RightPanel.updateSessionName(session.title || "Untitled");
      window.RightPanel.updateContextStats(null);
    }

    // 4. Load todo and messages
    try {
      const todoResponse = await window.electronAPI.session.todo(sessionId);
      if (window.App.currentSession !== sessionId) return;
      const todos = todoResponse.value || todoResponse || [];
      window.RightPanel.updateTodoList(todos);
    } catch (error) {
      console.warn(`[Session] Todo load failed:`, error.message);
      if (window.App.currentSession === sessionId) {
        window.RightPanel.clearTodoList();
      }
    }

    try {
      const messages = await window.electronAPI.session.messages(sessionId);
      if (window.App.currentSession !== sessionId) return;
      window.Chat.renderMessages(messages);

      // Aggregate tokens from assistant messages
      const tokenData = window.RightPanel.aggregateTokensFromMessages(messages);
      if (window.App.currentSession === sessionId) {
        window.RightPanel.updateContextStats(tokenData);
      }
    } catch (error) {
      console.warn(`[Session] Messages load failed:`, error.message);
    }

    // 5. Sync the model dropdown with the session's stored model so a
    //    session created via the CLI (or on another machine) shows the
    //    right provider/model instead of the user's last global pick.
    try {
      const sessionInfo = await window.electronAPI.session.get(sessionId);
      if (window.App.currentSession !== sessionId) return;
      const m = sessionInfo && sessionInfo.model;
      if (m && m.providerID && m.modelID) {
        window.Providers.selectModelFromBackend(m.providerID, m.modelID);
      }
    } catch (error) {
      console.warn(`[Session] Session info load failed:`, error.message);
    }
  } finally {
    _switchingSession = false;
  }
}
/** Delete a session and clean up UI if it was the active one. */
async function deleteSession(sessionId) {
  const t0 = performance.now();
  try {
    if (window.App.isProcessing && window.App.currentSession === sessionId) {
      try {
        await window.electronAPI.session.abort(sessionId);
      } catch (e) {}
    }

    await window.electronAPI.session.delete(sessionId);
    try {
      await window.electronAPI.session.deleteSnapshot(sessionId);
    } catch (e) {}

    window.App.sessions = window.App.sessions.filter((s) => s.id !== sessionId);
    renderSessionList();

    if (window.App.currentSession === sessionId) {
      window.App.currentSession = null;
      window.Chat.resetStreamingAccum();
      window.Chat.hideAllStatusIndicators();
      Utils.$("emptyState").classList.add("active");
      const chatArea = Utils.$("chatArea");
      chatArea.querySelectorAll(".message, .streaming-cursor").forEach((m) => m.remove());
      window.RightPanel.updateSessionName("New Chat");
      window.RightPanel.clearTodoList();
      window.RightPanel.updateContextStats(null);
    }
  } catch (error) {
    console.error(
      `[Session] deleteSession FAILED in ${(performance.now() - t0).toFixed(0)}ms:`,
      error.message,
    );
    if (window.App.debug) console.error("Failed to delete session:", error);
  }
}
/** Update a session's title on the backend and refresh the sidebar. */
async function renameSession(sessionId, title) {
  try {
    await window.electronAPI.session.update(sessionId, { title });
    const session = window.App.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.title = title;
      if (sessionId === window.App.currentSession) {
        window.RightPanel.updateSessionName(title);
      }
    }
    renderSessionList();
  } catch (error) {
    console.error(`[Session] renameSession FAILED:`, error.message);
    if (window.App.debug) console.error("Failed to rename session:", error);
  }
}
// Guard against concurrent session creation
let _sessionCreatePromise = null;

// Guard against concurrent session switching
let _switchingSession = false;
/** Get the current session ID, or create a new one if none exists. */
async function ensureSession() {
  if (window.App.currentSession) {
    return window.App.currentSession;
  }
  if (_sessionCreatePromise) return _sessionCreatePromise;

  const t0 = performance.now();

  _sessionCreatePromise = (async () => {
    try {
      // Save old session if it exists in the session list. If the backend
      // is unreachable or the call times out, we don't want to fail the
      // whole "new session" flow — just create a fresh one and move on.
      try {
        const lastActive = await window.electronAPI.session.getActive();
        if (lastActive) {
          const exists = window.App.sessions.some((s) => s.id === lastActive);
          if (exists) {
            try {
              await window.electronAPI.session.saveCurrent();
            } catch (e) {}
          }
        }
      } catch (e) {
        // getActive failed (timeout / 5xx) — fall through to create.
        console.warn(`[Session] getActive failed, creating fresh session:`, e.message);
      }

      const session = await window.electronAPI.session.create();
      const newSession =
        typeof session === "string" ? { id: session, title: "" } : session;

      // Restore snapshot or create empty dirs for new session
      try {
        await window.electronAPI.session.restore(newSession.id);
      } catch (e) {}

      // Bug fix: race between POST /session (returns the ID immediately)
      // and OpenCode's internal session registration. Without this wait,
      // the very first prompt_async hit a session that OpenCode hadn't
      // fully wired up yet and the server answered with a `session.error`
      // SSE event (visible to the user as "Error" in the bottom-left
      // sidebar). The second message always worked because the session
      // had settled by then. We poll GET /session/{id} until it
      // resolves, which proves the session is queryable end-to-end.
      for (let i = 0; i < 10; i++) {
        try {
          const verified = await window.electronAPI.session.get(newSession.id);
          if (verified && verified.id) break;
        } catch (e) {
          // 404 or transient — keep polling.
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      if (!newSession.title) newSession.title = "";
      window.App.currentSession = newSession.id;
      newSession.title = newSession.title || "";
      window.App.sessions.unshift(newSession);
      renderSessionList();

      window.RightPanel.updateSessionName("New Chat");

      document.querySelectorAll(".session-card").forEach((c) => {
        c.classList.toggle("active", c.dataset.id === newSession.id);
      });

      return newSession.id;
    } catch (error) {
      console.error(
        `[Session] ensureSession FAILED in ${(performance.now() - t0).toFixed(0)}ms:`,
        error.message,
      );
      if (window.App.debug) console.error("Failed to create session:", error);
      throw error;
    }
  })();

  try {
    return await _sessionCreatePromise;
  } finally {
    _sessionCreatePromise = null;
  }
}