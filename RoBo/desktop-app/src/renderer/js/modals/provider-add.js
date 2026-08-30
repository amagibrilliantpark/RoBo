/** Custom Provider Add Modal — V1 Single Form (Name full-width, no ID/Models)
 *  Fixes: A1 Anthropic empty URL, A2 double-submit, A3 orphan rollback, A4 blocklist,
 *         A6 credential hammer, A7 modal close guard, A8 baseURL key, A10 normalize side-effect,
 *         A11 ::1/IPv6, A13 setError, U8 clear key on close
 */
(function () {
  const M = (window.ProviderAdd = window.ProviderAdd || {});

  const TYPE_META = {
    "openai-compatible": { npm: "@ai-sdk/openai-compatible", placeholder: "https://api.example.com/v1" },
    "anthropic":         { npm: "@ai-sdk/anthropic",         placeholder: "https://api.anthropic.com" },
  };

  // Block built-in IDs to prevent overwrite (A4)
  const BLOCKED_IDS = new Set([
    "opencode","openai","anthropic","google","groq","deepseek","ollama","github","gitlab",
    "fireworks","together","cerebras","mistral","cohere","bedrock","vertex","azure",
    "perplexity","xai","huggingface","deepinfra","moonshot","minimax","nebius","digitalocean",
    "openrouter","openai-compatible"
  ]);

  let isSubmitting = false;

  function els() {
    return {
      modal: document.getElementById('providerAddModal'),
      backdrop: document.getElementById('providerAddBackdrop'),
      close: document.getElementById('paClose'),
      cancel: document.getElementById('paCancel'),
      submit: document.getElementById('paSubmit'),
      type: document.getElementById('paType'),
      typeButton: document.getElementById('paTypeButton'),
      typeDropdown: document.getElementById('paTypeDropdown'),
      typeValue: document.getElementById('paTypeValue'),
      typeWrap: document.getElementById('paTypeWrap'),
      name: document.getElementById('paName'),
      baseUrl: document.getElementById('paBaseUrl'),
      apiKey: document.getElementById('paApiKey'),
      eye: document.getElementById('paEye'),
      baseUrlErr: document.getElementById('paBaseUrlError'),
      apiKeyErr: document.getElementById('paApiKeyError'),
      generalErr: document.getElementById('paGeneralError'),
      status: document.getElementById('paStatus'),
    };
  }

  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  function setError(inputEl, errEl, msg) {
    if (!inputEl || !errEl) return;
    if (msg) {
      inputEl.classList.add('pa-error');
      errEl.textContent = msg;
      errEl.classList.add('visible');
    } else {
      inputEl.classList.remove('pa-error');
      errEl.textContent = '';
      errEl.classList.remove('visible');
    }
  }

  function slugify(str) {
    // Basic ascii slug; non-ascii becomes hyphen and then fallback to custom (A9)
    return str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
  }

  function deriveNameFromUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      let host = u.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'Local';
      // Handle IPv6 bracketed or plain IP — treat as Local
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return 'Local';
      host = host.replace(/^api\./i, '').replace(/^www\./i, '');
      const first = host.split('.')[0] || host;
      return first.charAt(0).toUpperCase() + first.slice(1);
    } catch {
      return 'Custom';
    }
  }

  function generateProviderId(displayName, baseUrl) {
    let base = '';
    if (displayName && displayName.trim()) {
      base = slugify(displayName);
    } else {
      try {
        const u = new URL(baseUrl);
        let host = u.hostname.replace(/^api\./i, '').replace(/^www\./i, '');
        host = host.split('.')[0] || 'custom';
        base = slugify(host);
      } catch {
        base = 'custom';
      }
    }
    if (!base) base = 'custom';
    // Block built-ins: force suffix
    if (BLOCKED_IDS.has(base)) base = base + '-custom';

    const existing = (window.App.providers && window.App.providers.all || []).map(function (p) { return p.id; });
    const extraIds = window.ProviderModal && window.ProviderModal.getExtraProviderIds ? window.ProviderModal.getExtraProviderIds() : [];
    const connected = window.App.getConnectedProviderIds ? window.App.getConnectedProviderIds() : [];
    const hidden = window.App.readHiddenProviderIds ? window.App.readHiddenProviderIds() : [];
    const allIds = new Set([].concat(existing, extraIds, connected, hidden, Array.from(BLOCKED_IDS)));
    // If our derived base is still blocked (e.g. openai -> openai-custom already exists) keep suffixing
    if (!allIds.has(base)) return base;
    let i = 2;
    while (allIds.has(base + '-' + i)) i++;
    return base + '-' + i;
  }

  function normalizeBaseUrl(raw) {
    let v = raw.trim();
    if (v && !/^https?:\/\//i.test(v)) {
      v = 'https://' + v;
    }
    v = v.replace(/\/+$/, '');
    return v;
  }

  function isValidHost(hostname) {
    if (!hostname) return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return true; // IPv4
    if (hostname.includes(':')) return true; // IPv6
    return hostname.includes('.');
  }

  function validate() {
    const { baseUrl, apiKey, baseUrlErr, apiKeyErr, type } = els();
    let ok = true;
    const typeVal = type ? type.value : 'openai-compatible';
    const urlVal = baseUrl.value.trim();
    const keyVal = apiKey.value.trim();

    // A1: Anthropic allows empty URL (will fallback to placeholder)
    if (!urlVal) {
      if (typeVal === 'anthropic') {
        setError(baseUrl, baseUrlErr, '');
      } else {
        setError(baseUrl, baseUrlErr, 'Base URL is required.');
        ok = false;
      }
    } else {
      // Do not mutate input during validation (A10)
      const normalized = normalizeBaseUrl(urlVal);
      try {
        const u = new URL(normalized);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
        if (!isValidHost(u.hostname)) throw new Error('host');
        setError(baseUrl, baseUrlErr, '');
      } catch (e) {
        setError(baseUrl, baseUrlErr, 'Enter a valid URL, e.g. https://api.example.com/v1');
        ok = false;
      }
    }

    if (!keyVal) {
      setError(apiKey, apiKeyErr, 'API key is required.');
      ok = false;
    } else if (keyVal.length < 8) {
      setError(apiKey, apiKeyErr, 'API key looks too short.');
      ok = false;
    } else {
      setError(apiKey, apiKeyErr, '');
    }

    return ok;
  }

  function setStatus(msg, type) {
    const { status, generalErr } = els();
    if (!msg) {
      hide(status);
      hide(generalErr);
      if (generalErr) generalErr.textContent = '';
      return;
    }
    if (type === 'error') {
      hide(status);
      if (generalErr) {
        generalErr.textContent = msg;
        show(generalErr);
      }
    } else {
      hide(generalErr);
      if (status) {
        status.className = 'pa-status ' + (type || '');
        const txt = status.querySelector('.pa-status-text');
        if (txt) txt.textContent = msg;
        show(status);
      }
    }
  }

  function setLoading(loading) {
    isSubmitting = loading;
    const { submit, close, cancel, backdrop } = els();
    if (submit) {
      submit.disabled = loading;
      submit.classList.toggle('loading', loading);
      const label = submit.querySelector('.pa-btn-label');
      if (label) label.textContent = loading ? 'Adding…' : 'Add provider';
    }
    // A7: disable close paths during loading
    if (close) close.disabled = loading;
    if (cancel) cancel.disabled = loading;
    if (backdrop) backdrop.style.pointerEvents = loading ? 'none' : '';
  }

  function currentTypeMeta() {
    const { type } = els();
    const v = type ? type.value : 'openai-compatible';
    return TYPE_META[v] || TYPE_META['openai-compatible'];
  }

  function handleTypeChange() {
    const { baseUrl, type } = els();
    if (!baseUrl || !type) return;
    const meta = TYPE_META[type.value] || TYPE_META['openai-compatible'];
    baseUrl.placeholder = meta.placeholder;
  }

  async function handleSubmit() {
    if (isSubmitting) return; // A2 guard
    const { name, baseUrl, apiKey, type } = els();
    setStatus('', null);
    setError(baseUrl, document.getElementById('paBaseUrlError'), '');
    setError(apiKey, document.getElementById('paApiKeyError'), '');
    const generalErr = document.getElementById('paGeneralError');
    hide(generalErr);

    if (!validate()) return;

    const rawName = name.value.trim();
    let rawUrl = baseUrl.value.trim();
    const rawKey = apiKey.value.trim();
    const typeVal = type ? type.value : 'openai-compatible';
    const meta = TYPE_META[typeVal] || TYPE_META['openai-compatible'];

    if (!rawUrl && typeVal === 'anthropic') {
      rawUrl = meta.placeholder;
      baseUrl.value = rawUrl;
    }
    rawUrl = normalizeBaseUrl(rawUrl);

    const displayName = rawName || deriveNameFromUrl(rawUrl);
    const id = generateProviderId(displayName, rawUrl);

    setLoading(true);
    setStatus('Saving provider…', '');

    let configWritten = false;
    try {
      const patch = { provider: {} };
      patch.provider[id] = {
        npm: meta.npm,
        name: displayName,
        options: { baseURL: rawUrl }
      };
      if (!window.electronAPI || !window.electronAPI.config || !window.electronAPI.config.set) {
        throw new Error('Electron API not available');
      }
      await window.electronAPI.config.set(patch);
      configWritten = true;

      setStatus('Connecting with API key…', '');

      // A6: only retry on shape hint, otherwise fail fast. Limit to 2 variants.
      // A8: use baseURL (capital) not baseUrl
      let authDone = false;
      let lastErr = null;
      const variants = [
        { apiKey: rawKey },
        { apiKey: rawKey, baseURL: rawUrl }
      ];
      for (const creds of variants) {
        try {
          await window.electronAPI.provider.connect(id, creds);
          authDone = true;
          break;
        } catch (e) {
          lastErr = e;
          const msg = (e && e.message || '').toLowerCase();
          const isShape = msg.includes('invalid') && (msg.includes('credential') || msg.includes('shape') || msg.includes('api key'));
          if (!isShape) break; // network/429/timeout -> don't hammer
        }
      }
      if (!authDone) throw lastErr || new Error('Failed to save API key');

      // A5: atomic local persist
      try {
        if (window.ProviderModal && window.ProviderModal.addExtraProvider) window.ProviderModal.addExtraProvider(id);
        if (window.App.addConnectedProvider) window.App.addConnectedProvider(id);
        if (window.App.setProviderHidden) window.App.setProviderHidden(id, false);
        if (window.App.forceShowProviders) {
          if (!window.App.forceShowProviders.includes(id)) window.App.forceShowProviders.push(id);
        }
      } catch (e) {
        console.warn('[ProviderAdd] local persist failed', e);
      }

      setStatus('Provider added — loading models…', 'ok');
      try {
        if (window.Providers && window.Providers.loadProviders) await window.Providers.loadProviders();
      } catch (e) { console.warn('[ProviderAdd] loadProviders after add failed', e); }
      try {
        if (window.Settings && window.Settings.renderProvidersSettings) window.Settings.renderProvidersSettings();
      } catch (e) { console.warn('[ProviderAdd] renderProvidersSettings failed', e); }

      setStatus('✓ Added ' + displayName + ' (' + id + ')', 'ok');
      setTimeout(function () { close(); }, 700);

    } catch (err) {
      console.error('[ProviderAdd] failed', err);
      // A3: rollback orphan config if we wrote it but auth failed
      if (configWritten) {
        try {
          const rollback = { provider: {} };
          rollback.provider[id] = null;
          await window.electronAPI.config.set(rollback);
        } catch (rbErr) {
          console.warn('[ProviderAdd] rollback failed for', id, rbErr);
        }
      }
      const msg = err && err.message ? err.message : String(err);
      let friendly = msg;
      if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')) {
        friendly = 'Could not reach OpenCode server. Is RoBo still starting? ' + msg;
      } else if (msg.includes('already exists') || msg.includes('duplicate')) {
        friendly = 'A provider with this URL/name already exists. Try a different name or remove the old one.';
      }
      setStatus('', null);
      const g = document.getElementById('paGeneralError');
      if (g) { g.textContent = friendly; show(g); }
    } finally {
      setLoading(false);
    }
  }

  function setTypeValue(val) {
    const { type, typeValue, typeDropdown } = els();
    if (!type) return;
    type.value = val;
    if (typeValue) typeValue.textContent = val === 'anthropic' ? 'Anthropic' : 'OpenAI Compatible';
    if (typeDropdown) {
      const opts = typeDropdown.querySelectorAll('.pa-select-option');
      opts.forEach(function (o) {
        const isSel = o.dataset.value === val;
        o.classList.toggle('selected', isSel);
        o.setAttribute('aria-selected', isSel ? 'true' : 'false');
      });
    }
    handleTypeChange();
  }

  function closeTypeDropdown() {
    const { typeButton, typeDropdown } = els();
    if (typeDropdown) typeDropdown.classList.add('hidden');
    if (typeButton) typeButton.setAttribute('aria-expanded', 'false');
  }

  function toggleTypeDropdown() {
    const { typeButton, typeDropdown } = els();
    if (!typeDropdown || !typeButton) return;
    const isHidden = typeDropdown.classList.contains('hidden');
    if (isHidden) {
      typeDropdown.classList.remove('hidden');
      typeButton.setAttribute('aria-expanded', 'true');
    } else {
      closeTypeDropdown();
    }
  }

  function open() {
    const { modal, type, name, baseUrl, apiKey } = els();
    if (!modal) return;
    if (isSubmitting) return;
    setTypeValue('openai-compatible');
    closeTypeDropdown();
    name.value = '';
    baseUrl.value = '';
    apiKey.value = '';
    apiKey.type = 'password';
    const eyeOpen = document.querySelector('#paEye .pa-eye-open');
    const eyeClosed = document.querySelector('#paEye .pa-eye-closed');
    if (eyeOpen) eyeOpen.style.display = '';
    if (eyeClosed) eyeClosed.style.display = 'none';
    setError(baseUrl, document.getElementById('paBaseUrlError'), '');
    setError(apiKey, document.getElementById('paApiKeyError'), '');
    setStatus('', null);
    hide(document.getElementById('paGeneralError'));
    setLoading(false);
    modal.classList.remove('hidden');
    setTimeout(function () { name.focus(); }, 30);
  }

  function close() {
    if (isSubmitting) return; // A7 guard
    const { modal, apiKey } = els();
    if (!modal) return;
    closeTypeDropdown();
    // U8: clear key from DOM
    if (apiKey) {
      apiKey.value = '';
      apiKey.type = 'password';
    }
    modal.classList.add('hidden');
    setLoading(false);
  }

  function toggleEye() {
    const { apiKey } = els();
    const openIcon = document.querySelector('#paEye .pa-eye-open');
    const closedIcon = document.querySelector('#paEye .pa-eye-closed');
    if (!apiKey) return;
    const isPw = apiKey.type === 'password';
    apiKey.type = isPw ? 'text' : 'password';
    if (openIcon) openIcon.style.display = isPw ? 'none' : '';
    if (closedIcon) closedIcon.style.display = isPw ? '' : 'none';
  }

  function init() {
    const { modal, backdrop, close: closeBtn, cancel, submit, eye, name, baseUrl, apiKey, type, typeButton, typeDropdown } = els();
    if (!modal) return;

    backdrop && backdrop.addEventListener('click', function () { if (isSubmitting) return; closeTypeDropdown(); close(); });
    closeBtn && closeBtn.addEventListener('click', close);
    cancel && cancel.addEventListener('click', close);
    eye && eye.addEventListener('click', toggleEye);
    submit && submit.addEventListener('click', handleSubmit);

    if (typeButton && typeDropdown) {
      typeButton.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isSubmitting) return;
        toggleTypeDropdown();
      });
      typeDropdown.querySelectorAll('.pa-select-option').forEach(function (opt) {
        opt.addEventListener('click', function (e) {
          e.stopPropagation();
          setTypeValue(opt.dataset.value);
          closeTypeDropdown();
          setError(baseUrl, document.getElementById('paBaseUrlError'), '');
          hide(document.getElementById('paGeneralError'));
          setStatus('', null);
        });
      });
      document.addEventListener('click', function (e) {
        if (!modal.classList.contains('hidden') && typeDropdown && !typeDropdown.classList.contains('hidden')) {
          const wrap = document.getElementById('paTypeWrap');
          if (wrap && !wrap.contains(e.target)) closeTypeDropdown();
        }
      });
    }

    baseUrl && baseUrl.addEventListener('input', function () {
      setError(baseUrl, document.getElementById('paBaseUrlError'), '');
      const g = document.getElementById('paGeneralError'); hide(g);
      setStatus('', null);
    });
    apiKey && apiKey.addEventListener('input', function () {
      setError(apiKey, document.getElementById('paApiKeyError'), '');
      const g = document.getElementById('paGeneralError'); hide(g);
      setStatus('', null);
    });
    name && name.addEventListener('input', function () {
      const g = document.getElementById('paGeneralError'); hide(g);
      setStatus('', null);
    });

    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        const { typeDropdown } = els();
        if (typeDropdown && !typeDropdown.classList.contains('hidden')) {
          e.stopPropagation();
          closeTypeDropdown();
          return;
        }
        e.stopPropagation();
        close();
      }
      if (e.key === 'Enter' && !e.shiftKey && !isSubmitting) {
        const active = document.activeElement;
        if (active && (active.id === 'paName' || active.id === 'paBaseUrl' || active.id === 'paApiKey')) {
          e.preventDefault();
          handleSubmit();
        }
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        const { typeDropdown } = els();
        if (typeDropdown && !typeDropdown.classList.contains('hidden')) {
          e.stopPropagation();
          closeTypeDropdown();
          return;
        }
        e.stopPropagation();
        close();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  M.open = open;
  M.close = close;
  M.toggleEye = toggleEye;
})();
