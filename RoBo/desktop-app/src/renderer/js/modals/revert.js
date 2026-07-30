// Revert modal state
let pendingRevertMessageId = null;
let pendingRevertMessageText = '';

/** Show the revert confirmation modal with message preview. */
function showRevertModal(messageId, messageText) {
  pendingRevertMessageId = messageId;
  pendingRevertMessageText = messageText;

  const overlay = document.getElementById('revertModalOverlay');
  const messagePreview = document.getElementById('rmMessagePreview');

  if (messagePreview) {
    const truncatedText = messageText.length > 100 ? messageText.substring(0, 100) + '...' : messageText;
    messagePreview.textContent = truncatedText;
  }

  if (overlay) overlay.classList.remove('hidden');
}

/** Close the revert modal and reset state. */
function closeRevertModal() {
  const overlay = document.getElementById('revertModalOverlay');
  if (overlay) overlay.classList.add('hidden');
  pendingRevertMessageId = null;
  pendingRevertMessageText = '';
}

/**
 * Wait until the active session is idle (or the timeout elapses).
 * OpenCode returns 409 SessionBusyError if we call revert while the session
 * is still processing, so we must abort + wait for the idle signal first.
 */
async function waitForSessionIdle(timeoutMs = 5000) {
  if (!window.App.isProcessing) return;

  const deadline = Date.now() + timeoutMs;
  while (window.App.isProcessing && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Reset all streaming/UI state that can leak into a reverted session. */
function resetChatStateAfterRevert() {
  // Stop-mode toggle (button + input enabled/disabled)
  if (window.Chat && window.Chat.setStopMode) {
    window.Chat.setStopMode(false);
  }
  // Streaming accumulators + DOM cursor
  if (window.Chat && window.Chat.Streaming) {
    window.Chat.Streaming.resetAccum();
    window.Chat.Streaming.removeCursor();
  }
  // Status indicators (thinking, error, compaction, usage)
  if (window.Chat && window.Chat.hideAllStatusIndicators) {
    window.Chat.hideAllStatusIndicators();
  }
  // SSE-internal let bindings (activeTextPartID, isCompacting) live in sse-core.js
  // and are exported on window.SSE so we can reset them from here.
  if (window.SSE && typeof window.SSE.resetState === "function") {
    window.SSE.resetState();
  }
}

/** Re-render chat messages from the backend after a structural change (revert/fork). */
async function reloadMessagesAfterRevert() {
  const sessionId = window.App.currentSession;
  if (!sessionId) return;
  try {
    const messages = await window.electronAPI.session.messages(sessionId);
    if (window.App.currentSession !== sessionId) return;
    if (window.Chat && window.Chat.renderMessages) {
      window.Chat.renderMessages(messages);
    }
  } catch (error) {
    console.error("[Revert] Failed to reload messages:", error);
  }
}

/** Execute the revert operation. */
async function executeRevert() {
  if (!pendingRevertMessageId || !window.App.currentSession) return;

  const t0 = performance.now();
  const revertBtn = document.getElementById('rmRevert');
  if (revertBtn) revertBtn.disabled = true;

  try {
    // 1. If a generation is in-flight, abort it and wait for the session
    //    to become idle. OpenCode's /revert returns 409 otherwise.
    if (window.App.isProcessing) {
      try {
        await window.electronAPI.session.abort(window.App.currentSession);
      } catch (e) {
        // already idle or abort failed — proceed and rely on waitForSessionIdle
      }
      await waitForSessionIdle(5000);
    }

    // 2. Call the revert API.
    await window.electronAPI.session.revert(window.App.currentSession, pendingRevertMessageId);

    // 3. Reset every piece of UI/SSE state that could otherwise stay
    //    stuck from the pre-revert generation (stop button, cursor,
    //    accumulators, isCompacting/activeTextPartID, status indicators).
    resetChatStateAfterRevert();

    // 4. Re-render the full message list from the backend instead of
    //    splicing DOM nodes by messageId (which is fragile and misses
    //    parts like reasoning/tool bubbles that the API returns).
    await reloadMessagesAfterRevert();

    // 5. Put the reverted user message text back in the input box.
    const promptInput = document.querySelector('.prompt-input');
    if (promptInput) {
      promptInput.value = pendingRevertMessageText;
      promptInput.focus();
    }

    closeRevertModal();
  } catch (error) {
    console.error(`[UI] Revert FAILED in ${(performance.now() - t0).toFixed(0)}ms:`, error);
    // Surface the error to the user instead of swallowing it.
    if (window.Chat && window.Chat.showError) {
      window.Chat.showError('Revert failed: ' + (error.message || error));
    }
    closeRevertModal();
  } finally {
    if (revertBtn) revertBtn.disabled = false;
  }
}

/** Initialize revert modal event listeners. */
function initRevertModal() {
  const cancelBtn = document.getElementById('rmCancel');
  const revertBtn = document.getElementById('rmRevert');

  if (cancelBtn) cancelBtn.addEventListener('click', closeRevertModal);
  if (revertBtn) revertBtn.addEventListener('click', executeRevert);

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('revertModal');
      if (modal && !modal.classList.contains('hidden')) {
        closeRevertModal();
      }
    }
  });
}

window.Modals = { ...(window.Modals || {}), showRevertModal, closeRevertModal, initRevertModal };
