/** Return the currently selected variant key only if the given model actually supports it. */
function getVariantForModel(model) {
  if (!model || !window.App.providers) return undefined;
  const allProviders = window.App.providers.all || [];
  const provider = allProviders.find((p) => p.id === model.provider);
  if (!provider || !provider.models) return undefined;
  const modelData =
    provider.models[model.model] ||
    Object.values(provider.models).find((m) => m.id === model.model);
  if (!modelData || !modelData.variants) return undefined;
  const keys = Object.keys(modelData.variants);
  if (!keys.length) return undefined;
  return keys.includes(window.App.currentVariant)
    ? window.App.currentVariant
    : keys[0];
}

/** Send the prompt input text to the AI. Aborts any in-progress generation first. */
async function sendMessage() {
  const input = document.querySelector(".prompt-input");
  const text = input.value.trim();
  if (!text) return;

  const sendStartTime = performance.now();

  if (window.App.isProcessing && window.App.currentSession) {
    try {
      await window.electronAPI.session.abort(window.App.currentSession);
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      // already idle
    }
  }

  window.App.isProcessing = false;
  Chat.Streaming.resetAccum();
  Chat.Indicators.hideAllStatusIndicators();

  // Remember the prompt text so we can re-append it AFTER ensureSession
  // returns. Appending first (as we used to) was racy: a session switch
  // in the gap between abort and ensureSession would either drop the
  // bubble in the wrong chat or lose it to a renderMessages() call.
  input.value = "";
  setStopMode(true);

  try {
    const sessionId = await window.Sessions.ensureSession();

    // Re-check after await: the user may have switched sessions while
    // ensureSession was in flight. If so, drop the prompt on the floor
    // (they'd see it disappear with the chat; better than putting it in
    // the wrong place).
    if (window.App.currentSession !== sessionId) {
      setStopMode(false);
      return;
    }

    // Safe to append now: currentSession is settled on the session we
    // just resolved and the chatArea has been prepared by ensureSession.
    Chat.Messages.appendMessage("user", text);

    // A new turn: separate the previous chain from this one so the new
    // chain doesn't start flush against the old chain's end.
    if (window.Chain && window.Chain.markTurn) window.Chain.markTurn();

    // Cover the pre-step-start gap in the chain of thoughts: nothing has
    // streamed yet, so show the placeholder until the first part lands.
    if (window.Chain) window.Chain.showPlaceholder("Thinking");

    const model = window.App.currentModel;
    const agent = window.App.currentAgent;
    const modelWithVariant = model
      ? { ...model, variant: getVariantForModel(model) }
      : null;

    // The generation is starting: keep the Stop button up until the
    // session actually reports idle (not on per-step message completions).
    window.App.sessionBusy = true;

    await window.electronAPI.message.sendAsync(
      sessionId,
      text,
      modelWithVariant,
      agent || "build",
    );
  } catch (error) {
    window.App.sessionBusy = false;
    Chat.Indicators.hideAllStatusIndicators();
    Chat.Messages.appendMessage("assistant", "Error: " + error.message);
    if (window.Chain && window.Chain.hidePlaceholder) {
      window.Chain.hidePlaceholder();
    }
    console.error(
      `[Perf] ❌ sendMessage FAILED after ${(performance.now() - sendStartTime).toFixed(0)}ms:`,
      error.message,
    );
    setStopMode(false);
  }
}

/** Abort the current session's running generation. */
async function stopGeneration() {
  if (!window.App.currentSession) return;
  // Mark the in-flight message as user-aborted so the trailing
  // message.updated(completed=true) shows "Generation stopped by user"
  // instead of an invisible stream tail.
  window.App.abortedByUser = true;
  try {
    await window.electronAPI.session.abort(window.App.currentSession);
  } catch (error) {
    // ignore
  }
  setStopMode(false);
  Chat.Indicators.hideAllStatusIndicators();
}

/** Toggle the send button between send/stop modes and disable input while processing. */
function setStopMode(active) {
  window.App.isProcessing = active;
  const btn = document.querySelector(".btn-send");
  const input = document.querySelector(".prompt-input");
  btn.classList.toggle("stop-mode", active);
  input.disabled = active;
  if (!active) setTimeout(() => input.focus(), 50);
}

window.Chat = window.Chat || {};
window.Chat.sendMessage = sendMessage;
window.Chat.stopGeneration = stopGeneration;
window.Chat.setStopMode = setStopMode;

// Aliases for backward compatibility
window.Chat.renderMessages = Chat.Messages.renderMessages;
window.Chat.appendMessage = Chat.Messages.appendMessage;
window.Chat.appendStreamingText = Chat.Streaming.appendStreamingText;
window.Chat.finalizeStreaming = Chat.Streaming.finalizeStreaming;
window.Chat.resetStreamingAccum = Chat.Streaming.resetAccum;
window.Chat.removeStreamingCursor = Chat.Streaming.removeCursor;
window.Chat.showThinking = Chat.Indicators.showThinking;
window.Chat.hideThinking = Chat.Indicators.hideThinking;
window.Chat.showError = Chat.Indicators.showError;
window.Chat.showCompaction = Chat.Indicators.showCompaction;
window.Chat.showCompacted = Chat.Indicators.showCompacted;
window.Chat.showUsageExceed = Chat.Indicators.showUsageExceed;
window.Chat.hideAllStatusIndicators = Chat.Indicators.hideAllStatusIndicators;

/* ── Jump modal: hover the scroll dots to list the session's user
   messages; clicking one smooth-scrolls straight to it. */
(function () {
  "use strict";
  var dots = document.getElementById("scrollDots");
  var modal = document.getElementById("jumpModal");
  var list = document.getElementById("jumpModalList");
  if (!dots || !modal || !list) return;

  var open = false;
  var hideTimer = null;
  var HIDE_DELAY = 200; // ms — lets the cursor cross the gap dots → modal

  function buildList() {
    var area = document.getElementById("chatArea");
    list.textContent = "";
    if (!area) return;
    var msgs = area.querySelectorAll(".user-message");
    if (!msgs.length) {
      var empty = document.createElement("div");
      empty.className = "jump-empty";
      empty.textContent = "No messages yet";
      list.appendChild(empty);
      return;
    }
    msgs.forEach(function (msg) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "jump-item";
      var label = document.createElement("span");
      label.className = "jump-label";
      // The card's visible text only — user bubbles also carry a hidden
      // edit textarea with the same content, so raw textContent doubles it.
      var card = msg.querySelector ? msg.querySelector(".msg-card-text") : null;
      var text = (card ? card.textContent : msg.textContent).trim() || "(empty message)";
      label.textContent = text.length > 90 ? text.slice(0, 87) + "..." : text;
      item.appendChild(label);
      item.addEventListener("click", function () {
        if (msg && msg.isConnected) {
          msg.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        hide();
      });
      list.appendChild(item);
    });
  }

  function cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(function () {
      hideTimer = null;
      if (!dots.matches(":hover") && !modal.matches(":hover")) hide();
    }, HIDE_DELAY);
  }

  function show() {
    cancelHide();
    if (open) return;
    buildList();
    modal.classList.remove("hidden");
    open = true;
  }

  function hide() {
    cancelHide();
    if (!open) return;
    modal.classList.add("hidden");
    open = false;
  }

  dots.addEventListener("mouseenter", show);
  modal.addEventListener("mouseenter", cancelHide);
  dots.addEventListener("mouseleave", scheduleHide);
  modal.addEventListener("mouseleave", scheduleHide);
})();
