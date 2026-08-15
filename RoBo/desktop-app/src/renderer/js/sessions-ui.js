function renderSessionList() {
  const attachedContainer = Utils.$("attachedSessions");
  const normalContainer = Utils.$("normalSessions");

  // Single pass + fragments: one reflow per list instead of one per card.
  const attachedFrag = document.createDocumentFragment();
  const normalFrag = document.createDocumentFragment();

  for (const s of window.App.sessions) {
    const card = createSessionCard(s);
    if (s.attached) attachedFrag.appendChild(card);
    else normalFrag.appendChild(card);
  }

  attachedContainer.innerHTML = "";
  normalContainer.innerHTML = "";
  attachedContainer.appendChild(attachedFrag);
  normalContainer.appendChild(normalFrag);
}

/** Build a session card element with title, context menu, and click handler. */
function createSessionCard(session) {
  const card = document.createElement("div");
  card.className =
    "session-card" +
    (session.id === window.App.currentSession ? " active" : "");
  card.dataset.id = session.id;
  card.dataset.name = session.title || "New Chat";

  if (session.attached) {
    const pin = document.createElement("span");
    pin.className = "sc-pin";
    pin.innerHTML =
      '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10.2v3"/><path d="M5.1 6.2a1.2 1.2 0 0 1-.7 1.1l-1.2.7a1.2 1.2 0 0 0-.6 1v.5a.5.5 0 0 0 .5.5h8.6a.5.5 0 0 0 .5-.5v-.5a1.2 1.2 0 0 0-.6-1l-1.2-.7a1.2 1.2 0 0 1-.7-1.1V3.6h1a1.1 1.1 0 0 0 0-2.2H4.1a1.1 1.1 0 0 0 0 2.2h1z"/></svg>';
    card.appendChild(pin);
  }

  const title = document.createElement("div");
  title.className = "sc-title";
  title.textContent = session.title || "New Chat";

  const moreBtn = document.createElement("button");
  moreBtn.className = "session-more";
  moreBtn.innerHTML =
    '<svg viewBox="0 0 14 14"><circle cx="7" cy="3" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="7" cy="11" r="1.2"/></svg>';

  const menu = document.createElement("div");
  menu.className = "session-menu";
  const attachLabel = session.attached ? "Detach" : "Attach";
  menu.innerHTML = `
    <button class="session-menu-item" data-action="rename"><svg viewBox="0 0 14 14"><path d="M10 2l2 2-7 7H3v-2l7-7z"/></svg>Rename</button>
    <button class="session-menu-item" data-action="attach"><svg viewBox="0 0 14 14"><path d="M7 10.2v3"/><path d="M5.1 6.2a1.2 1.2 0 0 1-.7 1.1l-1.2.7a1.2 1.2 0 0 0-.6 1v.5a.5.5 0 0 0 .5.5h8.6a.5.5 0 0 0 .5-.5v-.5a1.2 1.2 0 0 0-.6-1l-1.2-.7a1.2 1.2 0 0 1-.7-1.1V3.6h1a1.1 1.1 0 0 0 0-2.2H4.1a1.1 1.1 0 0 0 0 2.2h1z"/></svg>${attachLabel}</button>
    <button class="session-menu-item danger" data-action="delete"><svg viewBox="0 0 14 14"><path d="M2 4h10M5 4V2h4v2M3 4v8a1 1 0 001 1h6a1 1 0 001-1V4"/></svg>Delete</button>
  `;

  card.appendChild(title);
  card.appendChild(moreBtn);
  card.appendChild(menu);

  card.addEventListener("click", function (e) {
    if (
      e.target.closest(".session-more") ||
      e.target.closest(".session-menu") ||
      e.target.closest(".sc-title-input")
    )
      return;
    selectSession(session.id);
  });

  moreBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    const wasOpen = menu.classList.contains("active");
    document
      .querySelectorAll(".session-menu")
      .forEach((m) => m.classList.remove("active"));
    if (!wasOpen) menu.classList.add("active");
  });

  menu.querySelectorAll(".session-menu-item").forEach((item) => {
    item.addEventListener("click", function (e) {
      e.stopPropagation();
      const action = this.dataset.action;
      if (action === "delete") {
        deleteSession(session.id);
      } else if (action === "rename") {
        document
          .querySelectorAll(".session-menu")
          .forEach((m) => m.classList.remove("active"));
        startRename(card, card.querySelector(".sc-title"), session);
      } else if (action === "attach") {
        toggleAttach(session.id);
      }
      if (action !== "rename") {
        document
          .querySelectorAll(".session-menu")
          .forEach((m) => m.classList.remove("active"));
      }
    });
  });

  return card;
}
function startRename(card, titleEl, session) {
  const currentName = titleEl.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className = "sc-title-input";
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  function finishRename() {
    const newName = input.value.trim() || currentName;
    const newTitle = document.createElement("div");
    newTitle.className = "sc-title";
    newTitle.textContent = newName;
    card.dataset.name = newName;
    input.replaceWith(newTitle);
    if (newName !== currentName) {
      renameSession(session.id, newName);
    }
  }

  input.addEventListener("blur", finishRename);
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      input.blur();
    }
    if (ev.key === "Escape") {
      input.value = currentName;
      input.blur();
    }
  });
}

/** Toggle the "attached" flag on a session (pins it to the top). Persisted via session metadata. */
function toggleAttach(sessionId) {
  const session = window.App.sessions.find((s) => s.id === sessionId);
  if (session) {
    session.attached = !session.attached;
    session.metadata = {
      ...(session.metadata || {}),
      attached: session.attached,
    };
    renderSessionList();
    window.electronAPI.session
      .update(sessionId, { metadata: session.metadata })
      .catch(() => {});
  }
}

/** Filter session cards by name substring match. */
function searchSessions(query) {
  const cards = document.querySelectorAll(
    "#normalSessions .session-card, #attachedSessions .session-card",
  );
  cards.forEach((card) => {
    const name = (card.dataset.name || "").toLowerCase();
    card.style.display = !query || name.indexOf(query) !== -1 ? "" : "none";
  });
}
window.Sessions = {
  loadSessions,
  selectSession,
  deleteSession,
  renameSession,
  searchSessions,
  renderSessionList,
  ensureSession,
  getAllSessions: () => window.App.sessions || [],
  getSessions,
};