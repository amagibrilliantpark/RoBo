// Inline revert state
let editingMessageElement = null;
let pendingRevertMessageId = null;

/** Auto-resize textarea to fit content (with max-height limit) */
function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  const newHeight = Math.min(textarea.scrollHeight, 104); // max-height: 104px (120px card - padding)
  textarea.style.height = newHeight + 'px';
}

/** Start inline edit mode for a message card. */
function startEditMode(messageId, messageText, messageElement) {
  // If another card is already in edit mode, close it first
  if (editingMessageElement) {
    closeEditMode();
  }

  editingMessageElement = messageElement;
  pendingRevertMessageId = messageId;

  // Add edit mode class to the message element
  messageElement.classList.add('edit-mode');

  // Disable prompt input
  const promptInput = document.querySelector('.prompt-input');
  if (promptInput) {
    promptInput.disabled = true;
  }

  // Disable all other revert buttons
  document.querySelectorAll('.user-message:not(.edit-mode)').forEach(msg => {
    msg.classList.add('edit-mode-active');
  });

  // Focus on the textarea
  const textarea = messageElement.querySelector('.msg-edit-textarea');
  if (textarea) {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  // Add click outside listener to close edit mode
  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 0);
}

/** Close inline edit mode and reset state. */
function closeEditMode() {
  if (!editingMessageElement) return;

  // Reset textarea
  const textarea = editingMessageElement.querySelector('.msg-edit-textarea');
  if (textarea) {
    textarea.style.height = 'auto';
  }

  // Remove edit mode class
  editingMessageElement.classList.remove('edit-mode');

  // Reset textarea value to original text
  const textDiv = editingMessageElement.querySelector('.msg-card-text');
  if (textarea && textDiv) {
    textarea.value = textDiv.textContent;
    textarea.style.height = 'auto';
  }

  // Re-enable prompt input
  const promptInput = document.querySelector('.prompt-input');
  if (promptInput) {
    promptInput.disabled = false;
  }

  // Re-enable all revert buttons
  document.querySelectorAll('.user-message').forEach(msg => {
    msg.classList.remove('edit-mode-active');
  });

  // Remove click outside listener
  document.removeEventListener('click', handleOutsideClick);

  editingMessageElement = null;
  pendingRevertMessageId = null;
}

/** Handle clicks outside the editing card to close edit mode. */
function handleOutsideClick(event) {
  if (!editingMessageElement) return;

  // Check if click is outside the editing message element
  if (!editingMessageElement.contains(event.target)) {
    closeEditMode();
  }
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

/** Execute the revert operation from inline edit mode. */
async function executeInlineRevert(messageId, messageElement) {
  if (!messageId || !window.App.currentSession) return;

  // Get the edited text from textarea
  const textarea = messageElement.querySelector('.msg-edit-textarea');
  const editedText = textarea ? textarea.value : null;

  if (!editedText || editedText.trim() === '') {
    closeEditMode();
    return;
  }

  const sendBtn = messageElement.querySelector('.msg-send-btn');
  if (sendBtn) sendBtn.disabled = true;

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
    await window.electronAPI.session.revert(window.App.currentSession, messageId);

    // 3. Reset every piece of UI/SSE state that could otherwise stay
    //    stuck from the pre-revert generation (stop button, cursor,
    //    accumulators, isCompacting/activeTextPartID, status indicators).
    resetChatStateAfterRevert();

    // 4. Re-render the full message list from the backend instead of
    //    splicing DOM nodes by messageId (which is fragile and misses
    //    parts like reasoning/tool bubbles that the API returns).
    await reloadMessagesAfterRevert();

    // 5. Send the edited message immediately (don't put in input box)
    const promptInput = document.querySelector('.prompt-input');
    if (promptInput) {
      promptInput.value = editedText;
      // Automatically send the message
      window.Chat.sendMessage();
    }

    // Close edit mode for the specific element
    editingMessageElement = messageElement;
    closeEditMode();
  } catch (error) {
    console.error(`[UI] Revert FAILED:`, error);
    // Surface the error to the user instead of swallowing it.
    if (window.Chat && window.Chat.showError) {
      window.Chat.showError('Revert failed: ' + (error.message || error));
    }
    editingMessageElement = messageElement;
    closeEditMode();
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

/** Initialize inline revert event listeners. */
function initInlineRevert() {
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editingMessageElement) {
      closeEditMode();
    }
  });
}

window.Revert = {
  startEditMode,
  closeEditMode,
  executeInlineRevert,
  initInlineRevert
};

// Keep backward compatibility for Modals namespace if needed
window.Modals = { ...(window.Modals || {}), initRevertModal: initInlineRevert };
