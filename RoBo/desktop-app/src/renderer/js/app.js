/** Debounce utility function */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ── Global error reporting ──
// Every uncaught exception / rejected promise is forwarded to the main
// process logger, so `npm run dev` prints them in the terminal.
window.addEventListener('error', (e) => {
  const target = e.message || e.type;
  window.electronAPI.log('error', 'RENDERER-EXCEPTION', `${target} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  window.electronAPI.log('error', 'RENDERER-EXCEPTION', reason && reason.stack ? reason.stack : String(reason));
});

/** Main application entry point — wires up all UI event listeners. */
document.addEventListener('DOMContentLoaded', () => {
  window.SSE.initSSE();
  window.Modals.initQuestionModal();
  window.Revert.initInlineRevert();

  window.electronAPI.onProjectReady(async (data) => {
    const sidebarStatusEl = Utils.$('sidebarStatus');
    if (sidebarStatusEl) {
      sidebarStatusEl.textContent = 'Ready';
      sidebarStatusEl.classList.remove('error');
    }

    await window.Sessions.loadSessions();
    await window.Providers.loadProviders();
    await window.Providers.loadAgents();

    // Restore saved agent
    const savedAgent = localStorage.getItem('robo_agent');
    if (savedAgent) {
      window.App.currentAgent = savedAgent;
      updateModeUI(savedAgent);
    }
  });

  window.electronAPI.onProjectError((data) => {
    console.error(`[Init] ❌ project:error received:`, data.error);
    const sidebarStatusEl = Utils.$('sidebarStatus');
    if (sidebarStatusEl) {
      sidebarStatusEl.textContent = 'Error: ' + data.error;
      sidebarStatusEl.classList.add('error');
    }
  });

  // ── Startup status monitor ──
  // Silenced in dev mode: dev mode reserves the console for the [Chain]
  // logger, and this warning only fires when startup is actually stuck.
  let _statusCheckCount = 0;
  const _statusMonitor = setInterval(() => {
    const statusEl = Utils.$('sidebarStatus');
    if (!statusEl) return;
    const currentText = statusEl.textContent;
    _statusCheckCount++;
    // If stuck at "Starting..." for more than 15 seconds, log warning
    if (!window.App.debug && _statusCheckCount > 30 && currentText.includes('Starting')) {
      console.warn(`[Init] ⚠️ Stuck at "Starting..." for ${(_statusCheckCount * 500 / 1000).toFixed(0)}s`);
      // Check instance status
      window.electronAPI.instance.status().then(status => {
        console.warn(`[Init] Instance status:`, status);
      }).catch(err => {
        console.warn(`[Init] Failed to get instance status:`, err.message);
      });
    }
    // Stop monitoring after app is ready or after 60 seconds
    if (currentText.includes('Ready') || _statusCheckCount > 120) {
      clearInterval(_statusMonitor);
    }
  }, 500);

  // ── Dev mode toggle (Ctrl+Shift+D): enables the [Chain] logger ──
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      window.App.debug = !window.App.debug;
      console.log(`[Dev] Dev mode ${window.App.debug ? 'ON' : 'OFF'} — [Chain] logs ${window.App.debug ? 'enabled' : 'disabled'}`);
    }
  });

  // ── Sidebar toggle ──
  const sidebar = Utils.$('sidebar');
  const sidebarToggle = Utils.$('sidebarToggle');
  
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sb-collapsed', sidebar.classList.contains('collapsed'));
  });

  // ── Init Settings ──
  window.Settings.init();

  // ── Search ──
  const searchToggle = Utils.$('searchToggle');

  searchToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    openCenterSearchModal();
  });

  // ── Center Search Modal ──
  const centerSearchModal = Utils.$('centerSearchModal');
  const centerSearchBackdrop = Utils.$('centerSearchBackdrop');
  const centerSearchClose = Utils.$('centerSearchClose');
  const centerSearchInput = Utils.$('centerSearchInput');
  const centerSearchResults = Utils.$('centerSearchResults');

  function openCenterSearchModal() {
    centerSearchModal.classList.remove('hidden');
    centerSearchInput.value = '';
    centerSearchInput.focus();
    updateCenterSearchResults('');
  }

  function closeCenterSearchModal() {
    centerSearchModal.classList.add('hidden');
    centerSearchInput.value = '';
  }

  centerSearchClose.addEventListener('click', closeCenterSearchModal);
  centerSearchBackdrop.addEventListener('click', closeCenterSearchModal);

  // Debounce search inputs
  const debouncedCenterSearch = debounce((query) => {
    updateCenterSearchResults(query);
  }, 250);

  centerSearchInput.addEventListener('input', function() {
    debouncedCenterSearch(this.value.toLowerCase());
  });

  centerSearchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeCenterSearchModal();
    }
  });

  function updateCenterSearchResults(query) {
    const sessions = window.Sessions.getAllSessions();
    const filtered = sessions.filter(s => 
      s.title && s.title.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      centerSearchResults.innerHTML = '<div class="center-search-empty">No sessions found</div>';
      return;
    }

    centerSearchResults.innerHTML = filtered.map(session => `
      <button class="center-search-result-item" data-session-id="${session.id}">
        <div class="center-search-result-title">${session.title || 'Untitled'}</div>
      </button>
    `).join('');

    // Add click handlers
    centerSearchResults.querySelectorAll('.center-search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const sessionId = item.dataset.sessionId;
        window.Sessions.selectSession(sessionId);
        closeCenterSearchModal();
      });
    });
  }

  // ── Quick action cards — reuse the hidden header buttons' handlers ──
  Utils.$('qaNewChat').addEventListener('click', () => Utils.$('newChatBtn').click());
  Utils.$('qaSettings').addEventListener('click', () => Utils.$('settingsBtn').click());

  // ── Sessions collapse (chevron on the heading) ──
  const sessionsCollapse = Utils.$('sessionsCollapse');
  sessionsCollapse.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = document.body.classList.toggle('sessions-collapsed');
    sessionsCollapse.classList.toggle('rotated', collapsed);
  });

  // ── New chat — save current session, then deselect ──
  const newChatBtn = Utils.$('newChatBtn');
  newChatBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    // Save current session's files
    if (window.App.currentSession) {
      try { await window.electronAPI.session.saveCurrent(); } catch (e) {}
    }

    window.App.currentSession = null;
    window.Chat.resetStreamingAccum();
    window.Chat.hideAllStatusIndicators();
    document.querySelectorAll('.session-card').forEach(c => c.classList.remove('active'));
    const chatArea = Utils.$('chatArea');
    const emptyState = Utils.$('emptyState');
    // Drop the previous session's chain rows too — otherwise the old
    // reasoning/tool cards keep floating in the fresh "New Chat" view.
    if (window.Chain && typeof window.Chain.reset === 'function') {
      window.Chain.reset();
    }
    chatArea.querySelectorAll('.message, .streaming-cursor').forEach(m => m.remove());
    emptyState.classList.add('active');
    window.RightPanel.updateSessionName('New Chat');
    window.RightPanel.clearTodoList();
    window.RightPanel.updateContextStats(null);
  });

  // ── Send message ──
  const btnSend = document.querySelector('.btn-send');
  const promptInput = document.querySelector('.prompt-input');

  btnSend.addEventListener('click', () => {
    if (window.App.isProcessing) {
      window.Chat.stopGeneration();
    } else {
      window.Chat.sendMessage();
    }
  });

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.Chat.sendMessage();
    }
  });

  // Multi-line prompt: while typing, keep the visible lines pinned to the
  // freshest text (the view never lags behind the caret when the message
  // outgrows the box). Only input moves it — manual mouse scroll is free.
  promptInput.addEventListener('input', () => {
    promptInput.scrollTop = promptInput.scrollHeight;
  });

  // ── Mode selector (Edit/Plan) ──
  const MODE_META = {
    build: 'Code',
    plan: 'Plan',
  };

  const modeSelector = Utils.$('modeSelector');
  const modePopup = Utils.$('modePopup');
  const modeWrap = modeSelector.parentElement;

  /** Sync trigger label and option states to the given agent. */
  function updateModeUI(agent) {
    const label = modeSelector.querySelector('.mode-label');
    if (label) label.textContent = MODE_META[agent] || agent;
    modePopup.querySelectorAll('.mode-option').forEach((item) => {
      const on = item.dataset.value === agent;
      item.classList.toggle('selected', on);
      item.setAttribute('aria-selected', String(on));
    });
  }

  modeSelector.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = modePopup.classList.contains('active');
    closeAllPopups();
    if (!wasOpen) {
      modePopup.classList.add('active');
      positionModePopup(modePopup, modeSelector);
      modeWrap.classList.add('is-open');
      modeSelector.setAttribute('aria-expanded', 'true');
    }
  });

  modePopup.querySelectorAll('.mode-option').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const value = item.dataset.value;
      window.App.currentAgent = value;
      localStorage.setItem('robo_agent', value);
      updateModeUI(value);
      modePopup.classList.remove('active');
      modeWrap.classList.remove('is-open');
      modeSelector.setAttribute('aria-expanded', 'false');
    });
  });

  // ── Model selector ──
  const modelSelector = Utils.$('modelSelector');
  const modelPopup = Utils.$('modelPopup');

  modelSelector.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = modelPopup.classList.contains('active');
    closeAllPopups();
    if (!wasOpen) {
      modelPopup.classList.add('active');
      const searchInput = modelPopup.querySelector('#modelSearch');
      if (searchInput) {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        setTimeout(() => searchInput.focus(), 0);
      }
    }
  });

  // ── Close popups on outside click ──
  document.addEventListener('click', () => closeAllPopups());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllPopups();
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.session-menu').forEach(m => m.classList.remove('active'));
  });

  // ── Todo toggle ──
  const todoHeader = Utils.$('todoHeader');
  const todoList = Utils.$('todoList');

  todoHeader.addEventListener('click', () => {
    const isOpen = todoList.classList.contains('active');
    const arrow = todoHeader.querySelector('.todo-arrow');
    if (isOpen) {
      todoList.classList.remove('active');
      arrow.textContent = '\u25B6';
    } else {
      todoList.classList.add('active');
      arrow.textContent = '\u25BC';
    }
  });
});

/** Close all popup menus (mode, model, variant). */
function closeAllPopups() {
  Utils.$('modePopup').classList.remove('active');
  Utils.$('modelPopup').classList.remove('active');
  Utils.$('variantPopup').classList.remove('active');
  const modeBtn = Utils.$('modeSelector');
  modeBtn.parentElement.classList.remove('is-open');
  modeBtn.setAttribute('aria-expanded', 'false');
}

/**
 * Position the mode popover relative to its trigger with viewport
 * collision: opens above by default, flips below when there is no room,
 * and never lets the popover escape the screen edges. The arrow stays
 * pointed at the trigger's horizontal center.
 */
function positionModePopup(popup, trigger) {
  // Very narrow windows: the bottom-sheet CSS takes over.
  if (window.matchMedia('(max-width: 560px)').matches) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 8;
  const t = trigger.getBoundingClientRect();
  const pW = popup.offsetWidth || 200;
  const pH = popup.offsetHeight || 120;

  const spaceAbove = t.top - gap;
  const spaceBelow = vh - t.bottom - gap;
  const openBelow = spaceAbove < pH && spaceBelow >= spaceAbove;

  const top = openBelow ? t.bottom + gap : Math.max(8, t.top - pH - gap);
  const left = Math.min(Math.max(8, t.left), Math.max(8, vw - pW - 8));

  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup.style.bottom = 'auto';
  popup.style.right = 'auto';
  popup.classList.toggle('open-below', openBelow);

  const arrowX = Math.max(16, Math.min(t.left + t.width / 2 - left, pW - 16));
  popup.style.setProperty('--arrow-x', `${arrowX}px`);
}
