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
