// Tracks the active text part ID for streaming deltas
let activeTextPartID = null;
let isCompacting = false;

// Throttle cache for session stats refresh
let statsRefreshThrottle = null;
const STATS_REFRESH_DELAY = 2000; // 2 seconds

/** Mark the start of a compaction round; streaming parts/deltas become no-ops. */
function setCompacting(value) {
  isCompacting = value;
}

/** Subscribe to SSE events from the main process and route them to handlers. */
function initSSE() {
  window.electronAPI.onEvent((data) => {
    const props = data.properties || {};
    const sid = props.sessionID || props.id || "";
    const isCurrent = sid === window.App.currentSession;
    // Child sessions (task tool subagents) stream their parts on the same
    // global /event bus; route them to the Chain so they render nested
    // under the owning task tool row.
    const isChild = !!(window.Chain && window.Chain.isChildSession(sid));

    switch (data.type) {
      case "message.part.updated":
        if (isCurrent) handlePartUpdate(data.properties);
        else if (isChild && props.part) window.Chain.attachChildPart(sid, props.part);
        break;
      case "message.part.delta":
        if (isCurrent) handlePartDelta(data.properties);
        else if (isChild)
          window.Chain.appendChildPartDelta(sid, props.partID, props.field, props.delta);
        break;
      case "message.updated":
        if (isCurrent) handleMessageUpdated(data.properties);
        break;
      case "message.removed":
        // OpenCode fires this when a message is dropped (e.g. trailing
        // message after a revert). The renderer wasn't previously handling
        // it, so the chat kept showing the deleted message until a reload.
        if (isCurrent) handleMessageRemoved(data.properties);
        break;
      case "message.part.removed":
        // A part was removed (e.g. cancelled streaming tool call). Without
        // this handler the part element stayed orphaned in the chat.
        if (isCurrent) handleMessagePartRemoved(data.properties);
        else if (isChild && props.partID) window.Chain.removeChildPart(sid, props.partID);
        break;
      case "session.status":
        if (isChild) window.Chain.childSessionStatus(sid, props.status);
        else handleSessionStatus(data.properties);
        break;
      case "session.idle":
        handleSessionIdle(data.properties);
        break;
      case "session.error":
        handleSessionError(data.properties);
        break;
      case "session.compacted":
        // OpenCode 1.17.18: payload is just {sessionID} per OpenAPI spec.
        // handleSessionCompacted also clears isCompacting.
        if (isCurrent) handleSessionCompacted(data.properties);
        break;
      case "session.next.compaction.started":
        // New (v1.17+) compaction API. Sets isCompacting so streaming
        // parts/deltas get short-circuited until the .ended event.
        if (isCurrent) handleNextCompactionStarted(data.properties);
        break;
      case "session.next.compaction.delta":
        // Streaming summary text. We just stash it for the ended event.
        if (isCurrent) handleNextCompactionDelta(data.properties);
        break;
      case "session.next.compaction.ended":
        if (isCurrent) handleNextCompactionEnded(data.properties);
        break;
      case "session.next.revert.staged":
      case "session.next.revert.cleared":
      case "session.next.revert.committed":
        if (isCurrent) handleNextRevertEvent(data);
        break;
      case "session.diff":
        // Diff info for the active session, exposed on window.App.lastSessionDiff.
        if (isCurrent) handleSessionDiff(data.properties);
        break;
      case "file.edited":
        // SyncRo / external file change; dispatch a DOM event for panels.
        handleFileEdited(data.properties);
        break;
      case "question.asked":
        if (isCurrent) window.Modals.showQuestionModal(data.properties);
        break;
      case "question.v2.asked":
        // New (v1.17+) question API; routes to the same modal helper.
        if (isCurrent) handleQuestionV2Asked(data.properties);
        break;
      case "permission.asked":
        handlePermissionAsked(data.properties);
        break;
      case "permission.v2.asked":
        // New (v1.17+) permission API; expose a unified helper.
        if (isCurrent) handlePermissionV2Asked(data.properties);
        break;
      case "todo.updated":
        if (isCurrent) handleTodoUpdated(data.properties);
        break;
      case "session.updated":
        if (isCurrent) handleSessionUpdated(data.properties);
        break;
      // Note: OpenCode 1.17.18 does NOT emit "session.created" /
      // "session.deleted" as standalone SSE events (per /doc spec). The
      // REST API /session and /session/{id} handle those flows. RoBo
      // used to wire listeners that fired for every event because of
      // permissive type matching — the case statements are now omitted
      // on purpose.
    }
  });
}
/** Re-fetch messages to update token counts and cost in the right panel. */
async function refreshSessionStats() {
  const sessionToRefresh = window.App.currentSession;
  if (!sessionToRefresh) return;

  // Throttle refresh to avoid excessive API calls
  if (statsRefreshThrottle) {
    clearTimeout(statsRefreshThrottle);
  }

  statsRefreshThrottle = setTimeout(async () => {
    statsRefreshThrottle = null;
    try {
      const messages =
        await window.electronAPI.session.messages(sessionToRefresh);
      if (window.App.currentSession !== sessionToRefresh) return;
      const tokenData = window.RightPanel.aggregateTokensFromMessages(messages);
      window.RightPanel.updateContextStats(tokenData);
    } catch (error) {
      console.error("[RENDERER] Session stats refresh error: " + error.message);
    }
  }, STATS_REFRESH_DELAY);
}
/** Reset SSE-internal state (active text part + compaction flag).
 *  Called when a structural change invalidates the in-flight stream
 *  (revert, fork, session switch) so stale deltas don't get applied
 *  to the new conversation. */
function resetSSEState() {
  activeTextPartID = null;
  isCompacting = false;
  if (window.App) window.App.sessionBusy = false;
}

window.SSE = {
  initSSE,
  refreshSessionStats,
  resetState: resetSSEState,
  setCompacting,
};