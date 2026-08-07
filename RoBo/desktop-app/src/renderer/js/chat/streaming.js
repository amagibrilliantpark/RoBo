// Accumulated text for the current streaming response
let streamingTextAccum = '';
let streamingRenderPending = false;
let streamingTargetMsg = null;
let streamingDeltaCount = 0;
let lastStreamingChunk = '';
let streamingRenderThreshold = 0; // Minimum chars before we force a full re-render (for code blocks)

/** Append a chunk of streamed text and schedule a render pass. */
function appendStreamingText(text) {
  // Guard against duplicate chunks
  if (text === lastStreamingChunk && text.length > 10) {
    console.warn(`[Perf] Streaming: duplicate chunk detected, skipping (${text.length} chars)`);
    return;
  }
  lastStreamingChunk = text;

  const container = Utils.$('chatArea');
  const emptyState = Utils.$('emptyState');
  if (emptyState) emptyState.classList.remove('active');

  if (!streamingTargetMsg || !streamingTargetMsg.parentNode || streamingTargetMsg.querySelector('.msg-card')) {
    streamingTargetMsg = document.createElement('div');
    streamingTargetMsg.className = 'message ai-message ai-message-streaming';
    container.appendChild(streamingTargetMsg);
    streamingDeltaCount = 0;
    streamingRenderThreshold = 0;
  }

  Chat.Indicators.hideThinking();
  removeStreamingCursor();

  streamingTextAccum += text;
  streamingDeltaCount++;

  if (!streamingRenderPending) {
    streamingRenderPending = true;
    requestAnimationFrame(flushStreamingRender);
  }
}

/** Optimized render: only full re-render when code blocks might be involved */
function flushStreamingRender() {
  streamingRenderPending = false;
  if (!streamingTargetMsg || !streamingTargetMsg.parentNode) return;

  // Check if we have any code block markers - if yes, do a full re-render
  const recentText = streamingTextAccum.slice(streamingRenderThreshold);
  const hasCodeMarkers = recentText.includes('```');
  // Markdown tokens split across rAF batches (a chunk starting or ending
  // with * / backtick) can't be appended incrementally — a full re-render
  // heals the boundary.
  const boundaryRisk = /^[*`]/.test(recentText) || /[*`]$/.test(recentText);

  if (hasCodeMarkers || boundaryRisk) {
    // Full re-render (for code blocks or boundary-split markdown)
    streamingTargetMsg.querySelectorAll('.msg-text, .streaming-cursor, pre').forEach(el => el.remove());
    Chat.Messages.renderTextContent(streamingTargetMsg, streamingTextAccum);
    streamingRenderThreshold = streamingTextAccum.length;
  } else {
    // Incremental: append one small span instead of re-parsing the whole
    // accumulated HTML (lastSpan.innerHTML += was O(total) per frame).
    const spans = streamingTargetMsg.querySelectorAll('.msg-text');
    if (spans.length > 0) {
      const tail = document.createElement('span');
      tail.className = 'msg-text';
      tail.innerHTML = Chat.Messages.renderInlineMarkdown(recentText);
      spans[spans.length - 1].insertAdjacentElement('afterend', tail);
      streamingRenderThreshold = streamingTextAccum.length;
    } else {
      // Fallback to full render if no spans exist yet
      streamingTargetMsg.querySelectorAll('.msg-text, .streaming-cursor, pre').forEach(el => el.remove());
      Chat.Messages.renderTextContent(streamingTargetMsg, streamingTextAccum);
      streamingRenderThreshold = streamingTextAccum.length;
    }
  }
  
  addStreamingCursor(streamingTargetMsg);

  // One shared rAF scroll (respects the user having scrolled up to read).
  if (window.Chain && window.Chain.scheduleScroll) {
    window.Chain.scheduleScroll();
  }
}

/** Clean up streaming state when the response is complete. */
function finalizeStreaming() {
  if (!streamingTargetMsg || !streamingTargetMsg.parentNode) return;
  if (!streamingTextAccum) return;

  // Promote the streaming bubble to a permanent ai-message so subsequent
  // existingMsgs counts (Bug #35) include it.
  streamingTargetMsg.classList.remove("ai-message-streaming");
  removeStreamingCursor();
  resetStreamingAccum();
}

/** Reset all streaming state (called on new message or session switch). */
function resetStreamingAccum() {
  // Flush any scheduled-but-unflushed delta first: if a part boundary
  // (step-start/step-finish or a new text part) arrives in the same tick
  // as a delta, the pending rAF render would otherwise be cancelled and
  // the final chunk of the previous part would never reach the DOM.
  if (streamingRenderPending && streamingTargetMsg && streamingTargetMsg.parentNode) {
    flushStreamingRender();
  }
  if (streamingTargetMsg) {
    streamingTargetMsg.querySelectorAll('.streaming-cursor').forEach(c => c.remove());
  }
  streamingTextAccum = '';
  streamingTargetMsg = null;
  streamingRenderPending = false;
  lastStreamingChunk = '';
  streamingRenderThreshold = 0;
}

/** Add a blinking cursor element at the end of the streaming message. */
function addStreamingCursor(parentMsg) {
  let cursor = parentMsg.querySelector('.streaming-cursor');
  if (!cursor) {
    cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    parentMsg.appendChild(cursor);
  }
}

/** Remove all streaming cursor elements from the DOM. Scoped to the active
 *  bubble when one exists — the old document-wide query ran on every
 *  delta and scanned the whole chat (plus the chain's reasoning rows). */
function removeStreamingCursor() {
  const scope = streamingTargetMsg || document;
  scope.querySelectorAll('.streaming-cursor').forEach(c => c.remove());
}

window.Chat = window.Chat || {};
window.Chat.Streaming = { appendStreamingText, finalizeStreaming, resetAccum: resetStreamingAccum, removeCursor: removeStreamingCursor };
