/** Settings page and theme switching UI. */
window.Settings = {
  currentConfirmCallback: null,
  _confirmCleanup: null,

  showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const confirmBtn = document.getElementById('confirmConfirm');
    const cancelBtn = document.getElementById('confirmCancel');
    const backdrop = document.getElementById('confirmBackdrop');

    titleEl.textContent = title;
    messageEl.textContent = message;
    this.currentConfirmCallback = onConfirm;

    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.classList.add('hidden');
      this.currentConfirmCallback = null;
      this._confirmCleanup = null;
      confirmBtn.removeEventListener('click', onConfirmClick);
      cancelBtn.removeEventListener('click', onCancelClick);
      backdrop.removeEventListener('click', onCancelClick);
      document.removeEventListener('keydown', onEsc);
    };
    this._confirmCleanup = cleanup;

    const onConfirmClick = () => {
      const cb = this.currentConfirmCallback;
      cleanup();
      if (cb) cb();
    };
    const onCancelClick = () => cleanup();
    const onEsc = (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        e.stopPropagation();
        cleanup();
      }
    };

    confirmBtn.addEventListener('click', onConfirmClick);
    cancelBtn.addEventListener('click', onCancelClick);
    backdrop.addEventListener('click', onCancelClick);
    document.addEventListener('keydown', onEsc);
  },

  init() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPage = document.getElementById('settingsPage');
    const settingsClose = document.getElementById('settingsClose');

    settingsBtn.addEventListener('click', () => {
      settingsPage.classList.remove('hidden');
      fitSettingsModalToSendButton();
      document.querySelector('.settings-section-title[data-target="generalCard"]').click();
    });

    function fitSettingsModalToSendButton() {
      const modal = document.querySelector('.settings-modal');
      if (!modal) return;
      const send = document.querySelector('.btn-send');
      if (!send) {
        modal.style.height = 'min(640px, calc(100vh - 60px))';
        return;
      }
      const top = 54;
      const sendTop = send.getBoundingClientRect().top;
      const desired = sendTop - top - 24;
      modal.style.height = Math.max(380, Math.min(desired, 640)) + 'px';
    }

    settingsClose.addEventListener('click', () => {
      settingsPage.classList.add('hidden');
    });

    document.querySelectorAll('.settings-section-title').forEach(title => {
      title.addEventListener('click', () => {
        const targetId = title.dataset.target;
        const contentMap = {
          'generalCard': 'generalContent',
          'providersCard': 'providersContent',
          'aboutCard': 'aboutContent'
        };
        const targetContentId = contentMap[targetId];
        const targetContent = document.getElementById(targetContentId);
        if (targetContent) {
          document.querySelectorAll('.settings-section-title').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.settings-right-content').forEach(c => c.classList.add('hidden'));
          targetContent.classList.remove('hidden');
          title.classList.add('active');
          if (targetId === 'providersCard') this.renderProvidersSettings();
        }
      });
    });

    document.body.setAttribute('data-theme', 'light');
    localStorage.setItem('robo_theme', 'light');
    if (window.electronAPI?.window?.setTheme) {
      window.electronAPI.window.setTheme('light');
    }

    document.getElementById('feedbackBtn').addEventListener('click', () => {
      window.electronAPI.openExternal('https://docs.google.com/forms/d/e/1FAIpQLSfbJnE-m8jSKKqtSXtSyqwJMCpyQPjrsmFSjh86aKSNf1rlTw/viewform?usp=header');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !settingsPage.classList.contains('hidden')) {
        // Don't close settings if confirm modal is open — let confirm handle it
        const confirmModal = document.getElementById('confirmModal');
        if (confirmModal && !confirmModal.classList.contains('hidden')) return;
        // Don't close if providerAdd is open
        const paModal = document.getElementById('providerAddModal');
        if (paModal && !paModal.classList.contains('hidden')) return;
        settingsPage.classList.add('hidden');
      }
    });
  },

  renderProvidersSettings() {
    const content = document.getElementById('providersContent');
    if (!content) return;
    // L1: App.providers may be [] initially — normalize to object
    const provObj = window.App.providers;
    const all = (provObj && Array.isArray(provObj) ? [] : (provObj && provObj.all) || []);
    const connectedIds = window.App.getConnectedProviderIds ? window.App.getConnectedProviderIds() : [];
    const isDefault = (id) => id === 'opencode';
    const shown = all.filter((p) => isDefault(p.id) || connectedIds.includes(p.id));

    const metaOf = (id) =>
      window.ProviderModal ? window.ProviderModal.getProviderMeta(id) : { name: id, color: 'var(--accent-color)' };

    function escapeHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    const removeSvg =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';

    const rowFor = (p) => {
      const meta = metaOf(p.id);
      const rawName = meta.name || p.id;
      const safeName = escapeHtml(rawName);
      const initial = safeName.charAt(0).toUpperCase();
      const color = meta.color || 'var(--accent-color)';
      const def = isDefault(p.id);
      const isHidden = window.App.isProviderHidden ? window.App.isProviderHidden(p.id) : false;
      const isVisible = !isHidden;
      const encodedId = escapeHtml(p.id);
      const actions = def
        ? '<span class="prov-toggle prov-toggle-locked" data-provider="' + encodedId + '" data-enabled="true" title="Always enabled (built-in)"></span>'
        : '<span class="prov-icon-btn prov-btn-remove" data-provider="' + encodedId + '" title="Remove">' + removeSvg + '</span>' +
          '<span class="prov-toggle" data-provider="' + encodedId + '" data-enabled="' + isVisible + '" title="' + (isVisible ? 'Hide from model selector' : 'Show in model selector') + '"></span>';
      return (
        '<tr class="' + (def ? 'prov-row-default' : 'prov-row-custom') + '">' +
          '<td>' +
            '<div class="prov-model-cell">' +
              '<span class="prov-icon" style="background:' + escapeHtml(color) + '">' + escapeHtml(initial) + '</span>' +
              '<span>' + safeName + '</span>' +
            '</div>' +
          '</td>' +
          '<td><div class="prov-actions-cell">' + actions + '</div></td>' +
        '</tr>'
      );
    };

    const tableFor = (rows) =>
      '<table class="prov-table">' +
        '<thead><tr>' +
          '<th style="width:80%">Provider</th>' +
          '<th style="width:20%"></th>' +
        '</tr></thead>' +
        '<tbody>' + rows.map(rowFor).join('') + '</tbody>' +
      '</table>';

    const defaults = shown.filter((p) => isDefault(p.id));
    const customs = shown.filter((p) => !isDefault(p.id));

    const defaultGroup = defaults.length
      ? '<div class="prov-group-label">Default</div>' + tableFor(defaults)
      : '';
    const customGroup = customs.length
      ? '<div class="prov-group-label">Custom</div>' + tableFor(customs)
      : '<p class="prov-empty-note">No custom providers added yet.</p>';

    content.innerHTML =
      '<h1 class="prov-page-title">Providers</h1>' +
      '<h2 class="prov-section-title">Manage your AI models</h2>' +
      '<p class="prov-section-desc">Configure and manage your AI model providers. The default provider offers reliable performance out of the box. Connect additional providers via API keys to expand your model options.</p>' +
      '<button class="prov-btn-add" type="button" id="provAddBtn">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
        'Add Provider' +
      '</button>' +
      defaultGroup +
      customGroup;

    const addBtn = content.querySelector('#provAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.ProviderAdd && window.ProviderAdd.open) window.ProviderAdd.open();
      });
    }

    content.querySelectorAll('.prov-btn-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const providerId = btn.dataset.provider;
        if (!providerId) return;
        const meta = metaOf(providerId);
        const providerName = meta.name || providerId;

        this.showConfirmModal(
          'Remove Provider',
          `Are you sure you want to remove "${providerName}"? This will delete its config and API key and cannot be undone.`,
          async () => {
            const id = providerId;
            let authOk = false;
            let configOk = false;
            let authErr = null, configErr = null;

            try {
              await window.electronAPI.provider.delete(id);
              authOk = true;
            } catch (err) {
              authErr = err;
              console.warn('[Providers] delete auth failed for', id, err);
            }

            try {
              const patch = { provider: {} };
              patch.provider[id] = null;
              await window.electronAPI.config.set(patch);
              configOk = true;
            } catch (err) {
              configErr = err;
              console.warn('[Providers] delete config failed for', id, err);
            }

            // Only clean local if both succeeded or auth already absent (authOk or 404) and config succeeded
            // If config failed, keep UI and show error
            if (!configOk) {
              alert('Failed to remove provider config: ' + (configErr && configErr.message ? configErr.message : configErr));
              // Still refresh to show current truth
              try { if (window.Providers && window.Providers.loadProviders) await window.Providers.loadProviders(); } catch {}
              this.renderProvidersSettings();
              return;
            }

            // Clean local state atomically
            try { if (window.ProviderModal && window.ProviderModal.removeExtraProvider) window.ProviderModal.removeExtraProvider(id); } catch {}
            try { if (window.App.removeConnectedProvider) window.App.removeConnectedProvider(id); } catch {}
            try { if (window.App.setProviderHidden) window.App.setProviderHidden(id, false); } catch {}
            if (window.App.forceShowProviders) {
              window.App.forceShowProviders = window.App.forceShowProviders.filter(function (x) { return x !== id; });
            }

            try {
              const cur = window.App.currentModel;
              if (cur && cur.provider === id) {
                window.App.currentModel = null;
                localStorage.removeItem('robo_model');
                localStorage.removeItem('robo_variant');
                // Update trigger to fallback
                if (window.Providers && window.App.providers) {
                  const fallback = window.App.providers.all ? window.App.providers.all.find(function(p){ return p.id==='opencode'; }) : null;
                  if (fallback && window.ProviderModal) {
                    const m = window.ProviderModal.getProviderMeta('opencode');
                    const sel = document.getElementById('modelSelector');
                    if (sel) sel.innerHTML = '<span class="selector-logo" style="background:'+(m.color||'#666')+'">O</span><span class="selector-label">No models</span>';
                  }
                }
              }
            } catch {}

            try {
              if (window.Providers && window.Providers.loadProviders) await window.Providers.loadProviders();
            } catch (err) { console.warn('[Providers] loadProviders after delete failed', err); }
            this.renderProvidersSettings();
            if (!authOk && authErr) {
              console.warn('Auth delete warning for', id, authErr.message);
            }
          }
        );
      });
    });

    // T3: only non-locked toggles
    content.querySelectorAll('.prov-toggle:not(.prov-toggle-locked)').forEach(toggle => {
      toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const providerId = toggle.dataset.provider;
        if (!providerId) return;
        const isVisible = toggle.dataset.enabled === 'true';
        const nextHidden = isVisible;
        try {
          if (window.App.setProviderHidden) window.App.setProviderHidden(providerId, nextHidden);
          else {
            const raw = localStorage.getItem('robo_hidden_providers');
            let list = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(list)) list = [];
            if (nextHidden) { if (!list.includes(providerId)) list.push(providerId); }
            else { list = list.filter(function (x) { return x !== providerId; }); }
            localStorage.setItem('robo_hidden_providers', JSON.stringify(list));
          }
        } catch (err) {
          console.error('Failed to toggle visibility for', providerId, err);
        }
        this.renderProvidersSettings();
        try {
          if (window.Providers && window.Providers.loadProviders) await window.Providers.loadProviders();
        } catch (err) { console.warn('[Providers] loadProviders after toggle failed', err); }
      });
    });
  }
};
