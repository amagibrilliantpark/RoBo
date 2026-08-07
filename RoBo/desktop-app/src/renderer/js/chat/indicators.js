/* Legacy chat indicators are replaced by the chain of thoughts, which
 * renders the same states inline (placeholder, reasoning, markers). These
 * adapters keep the window.Chat.Indicators API working for existing callers
 * while routing the feedback to the chain. */

function showThinking(label) {
  // The chain's own placeholder / reasoning row covers "thinking".
}

function hideThinking() {
  // Nothing to hide; the chain manages its own states.
}

function hideAllStatusIndicators() {
  // No standalone indicator elements exist anymore.
}

function showError(message) {
  if (window.Chain && window.Chain.addMarker) {
    window.Chain.addMarker("error", message || "An error occurred");
  }
}

function showCompaction(message) {
  if (window.Chain && window.Chain.addMarker) {
    window.Chain.addMarker("compaction-active", message || "Compacting context...");
  }
}

function showCompacted() {
  if (window.Chain && window.Chain.finishMarker) {
    window.Chain.finishMarker("compaction", "Context compacted \u2014 continuing");
  }
}

function showUsageExceed(message) {
  if (window.Chain && window.Chain.addMarker) {
    window.Chain.addMarker("stop", message || "Usage limit exceeded");
  }
}

window.Chat = window.Chat || {};
window.Chat.Indicators = { showThinking, hideThinking, hideAllStatusIndicators, showError, showCompaction, showCompacted, showUsageExceed };
