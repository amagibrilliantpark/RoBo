/** Fetch available AI providers and populate the model selector. */
async function loadProviders() {
  const t0 = performance.now();
  try {
    if (!window.App.forceShowProviders) window.App.forceShowProviders = [];
    const providers = await window.electronAPI.provider.list();
    // Normalize to object shape even if server returns unexpected
    if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
      window.App.providers = { all: [], connected: [] };
      populateModelSelector(window.App.providers);
      throw new Error('Invalid provider payload');
    }
    if (!Array.isArray(providers.all)) providers.all = [];
    if (!Array.isArray(providers.connected)) providers.connected = [];
    window.App.providers = providers;
    populateModelSelector(providers);
  } catch (error) {
    console.error(`[Init] loadProviders FAILED in ${(performance.now() - t0).toFixed(0)}ms:`, error.message);
    if (window.App.debug) console.error('Failed to load providers:', error);
    // Ensure UI shows empty state and caller can detect failure
    if (!window.App.providers || Array.isArray(window.App.providers)) {
      window.App.providers = { all: [], connected: [] };
      try { populateModelSelector(window.App.providers); } catch {}
    }
    throw error;
  }
}

/** Fetch available agent modes (build, plan, etc). */
async function loadAgents() {
  const t0 = performance.now();
  try {
    const agents = await window.electronAPI.agent.list();
    window.App.agents = agents || [];
  } catch (error) {
    console.error(`[Init] loadAgents FAILED in ${(performance.now() - t0).toFixed(0)}ms:`, error.message);
    if (window.App.debug) console.error('Failed to load agents:', error);
  }
}

function readConnectedProviderIds() {
  try {
    const raw = localStorage.getItem('robo_connected_providers');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getConnectedProviderIds() {
  const prov = window.App.providers;
  const server = (prov && !Array.isArray(prov) && Array.isArray(prov.connected)) ? prov.connected : [];
  let manual = readConnectedProviderIds();
  if (!Array.isArray(manual)) manual = [];
  const force = Array.isArray(window.App.forceShowProviders) ? window.App.forceShowProviders : [];
  return [...new Set([...server, ...manual, ...force])];
}

function addConnectedProvider(id) {
  if (!id) return;
  try {
    const list = readConnectedProviderIds();
    if (!list.includes(id)) {
      list.push(id);
      localStorage.setItem('robo_connected_providers', JSON.stringify(list));
    }
  } catch (e) {
    console.warn('[Providers] addConnected failed', e);
  }
}

function removeConnectedProvider(id) {
  try {
    const list = readConnectedProviderIds().filter((x) => x !== id);
    localStorage.setItem('robo_connected_providers', JSON.stringify(list));
  } catch (e) {
    console.warn('[Providers] removeConnected failed', e);
  }
  if (Array.isArray(window.App.forceShowProviders)) {
    window.App.forceShowProviders = window.App.forceShowProviders.filter((x) => x !== id);
  }
}

function readHiddenProviderIds() {
  try {
    const raw = localStorage.getItem('robo_hidden_providers');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function isProviderHidden(id) {
  if (!id) return false;
  try {
    return readHiddenProviderIds().includes(id);
  } catch {
    return false;
  }
}
function setProviderHidden(id, hidden) {
  if (!id) return;
  try {
    const list = readHiddenProviderIds();
    const has = list.includes(id);
    if (hidden && !has) {
      list.push(id);
      localStorage.setItem('robo_hidden_providers', JSON.stringify(list));
    } else if (!hidden && has) {
      const next = list.filter(function (x) { return x !== id; });
      localStorage.setItem('robo_hidden_providers', JSON.stringify(next));
    }
  } catch (e) {
    console.warn('[Providers] setHidden failed', e);
  }
}

function providerDisplayName(id, fallback) {
  if (fallback && fallback.name) return fallback.name;
  if (fallback && fallback.id) return fallback.id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function updateSelectorTrigger(providerId, name, meta, variantKey) {
  const modelSelector = document.getElementById('modelSelector');
  if (!modelSelector) return;
  modelSelector.innerHTML = '';
  if (providerId && meta && meta.name) {
    const logo = document.createElement('span');
    logo.className = 'selector-logo';
    logo.style.background = meta.color || '#666';
    logo.textContent = (meta.name || providerId).charAt(0).toUpperCase();
    modelSelector.appendChild(logo);
  }
  const label = document.createElement('span');
  label.className = 'selector-label';
  // Kapalıyken sadece model adı — variant suffix kaldırıldı (istek)
  label.textContent = name;
  modelSelector.appendChild(label);
}

function openProvidersSettings() {
  const settingsPage = document.getElementById('settingsPage');
  if (settingsPage) settingsPage.classList.remove('hidden');
  const title = document.querySelector('.settings-section-title[data-target="providersCard"]');
  if (title) title.click();
}

function cssEscape(str) {
  try {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(str);
  } catch {}
  return String(str).replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\' + c; });
}

function populateModelSelector(providers) {
  const modelPopup = document.getElementById('modelPopup');
  if (!modelPopup) return;

  if (!modelPopup._hasClickGuard) {
    modelPopup.addEventListener('click', function (e) { e.stopPropagation(); });
    modelPopup._hasClickGuard = true;
  }

  modelPopup.innerHTML = '';
  modelPopup.classList.remove('has-variants');

  // Detect if any model has variants to decide layout — FINAL two-column
  const allProvidersTmp = providers && typeof providers === 'object' && !Array.isArray(providers) && Array.isArray(providers.all) ? providers.all : [];
  const connectedTmp = getConnectedProviderIds();
  const hasAnyVariant = allProvidersTmp.some(function (p) {
    if (!p || !p.id || !p.models) return false;
    if (p.id !== 'opencode' && !connectedTmp.includes(p.id)) return false;
    return Object.values(p.models).some(function (m) { return m.variants && Object.keys(m.variants).length > 0; });
  });
  if (hasAnyVariant) modelPopup.classList.add('has-variants');

  // Left pane (search + list + hints + footer) and optional right pane (variant detail)
  const left = document.createElement('div');
  left.className = 'model-popup-left';
  const searchWrap = document.createElement('div');
  searchWrap.className = 'model-popup-search';
  const searchIcon = document.createElement('span');
  searchIcon.className = 'model-search-icon';
  searchIcon.textContent = '⌕';
  const search = document.createElement('input');
  search.className = 'model-search-input';
  search.type = 'text';
  search.id = 'modelSearch';
  search.placeholder = hasAnyVariant ? 'Search models or variants...' : 'Search models...';
  search.autocomplete = 'off';
  search.spellcheck = false;
  searchWrap.appendChild(searchIcon);
  searchWrap.appendChild(search);
  left.appendChild(searchWrap);

  const list = document.createElement('div');
  list.className = 'model-popup-list';
  left.appendChild(list);

  const footer = document.createElement('div');
  footer.className = 'model-popup-footer';
  const addItem = document.createElement('button');
  addItem.className = 'model-popup-add';
  addItem.id = 'addProviderBtn';
  addItem.innerHTML =
    '<span class="model-add-icon"><svg viewBox="0 0 16 16"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg></span>' +
    '<span>Add Provider</span>';
  addItem.addEventListener('click', function (e) {
    e.stopPropagation();
    modelPopup.classList.remove('active');
    openProvidersSettings();
  });
  footer.appendChild(addItem);
  left.appendChild(footer);

  let right = null;
  let variantListEl = null;
  let variantHeaderEl = null;
  let currentVariantModel = null;

  if (hasAnyVariant) {
    right = document.createElement('div');
    right.className = 'model-popup-right';
    right.id = 'variantDetailPanel';
    right.style.display = 'none';
    variantHeaderEl = document.createElement('div');
    variantHeaderEl.className = 'variant-detail-header';
    variantHeaderEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">Select a model with variants</div>';
    const vList = document.createElement('div');
    vList.className = 'variant-detail-list';
    vList.id = 'variantDetailList';
    right.appendChild(variantHeaderEl);
    right.appendChild(vList);
    variantListEl = vList;
    modelPopup.appendChild(left);
    modelPopup.appendChild(right);
  } else {
    modelPopup.appendChild(left);
  }

  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return;

  const allProviders = Array.isArray(providers.all) ? providers.all : [];
  const connectedIds = getConnectedProviderIds();
  const providerList = allProviders.filter(function (p) {
    if (!p || !p.id) return false;
    if (p.id === 'opencode') return true;
    if (!connectedIds.includes(p.id)) return false;
    if (window.App.isProviderHidden && window.App.isProviderHidden(p.id)) return false;
    return true;
  });

  let savedModel = localStorage.getItem('robo_model');
  let savedVariant = localStorage.getItem('robo_variant');
  let savedParsed = null;
  if (savedModel) {
    try {
      savedParsed = JSON.parse(savedModel);
      const stillVisible = savedParsed && savedParsed.provider && providerList.some(function (p) { return p.id === savedParsed.provider; });
      if (!stillVisible && savedParsed) {
        const isHidden = savedParsed.provider && isProviderHidden(savedParsed.provider);
        if (isHidden || !connectedIds.includes(savedParsed.provider)) {
          const isDeleted = !allProviders.some(function (p) { return p.id === savedParsed.provider; });
          if (isDeleted) {
            localStorage.removeItem('robo_model');
            localStorage.removeItem('robo_variant');
            savedModel = null;
            savedParsed = null;
            savedVariant = null;
          }
        }
      }
    } catch {
      savedParsed = null;
    }
  }

  let selectedItem = null;
  let firstItem = null;

  const checkSvg =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  const chevronSvg =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';

  // State for keyboard drill-down
  let allItems = [];
  let leftFocusIndex = -1;
  let rightFocusIndex = -1;
  let focusPane = 'left'; // 'left' | 'right'

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function highlightHtml(text, query) {
    if (!query) return escapeHtml(text);
    const lowerText = String(text).toLowerCase();
    const lowerQ = String(query).toLowerCase();
    const idx = lowerText.indexOf(lowerQ);
    if (idx === -1) return escapeHtml(text);
    const before = escapeHtml(text.slice(0, idx));
    const match = escapeHtml(text.slice(idx, idx + query.length));
    const after = escapeHtml(text.slice(idx + query.length));
    return before + '<mark>' + match + '</mark>' + after;
  }

  function refreshVariantHints() {
    // İstek: model satırında "— variant" suffix'i kaldırıldı — hiçbir satırda gösterme
    allItems.forEach(function (it) {
      const hint = it.querySelector('.model-item-variant');
      if (hint) { hint.textContent = ''; hint.style.display = 'none'; }
    });
  }

  function showVariantPanel(provider, model, meta, opts) {
    if (!right || !variantListEl || !variantHeaderEl) return;
    currentVariantModel = { provider: provider, model: model, meta: meta };
    right.style.display = 'flex';
    const logoBg = meta.color || '#666';
    const initial = (meta.name || provider.id).charAt(0).toUpperCase();
    variantHeaderEl.innerHTML =
      '<span class="variant-detail-logo" style="background:' + logoBg + '">' + initial + '</span>' +
      '<div style="flex:1;min-width:0"><div class="variant-detail-title">' + escapeHtml(model.name || model.id) + '</div><div class="variant-detail-sub">' + Object.keys(model.variants).length + ' variants</div></div>';
    variantListEl.innerHTML = '';
    const keys = Object.keys(model.variants);
    let cur = window.App.currentVariant;
    if (!keys.includes(cur)) cur = keys[0];
    const highlight = opts && opts.highlight ? opts.highlight : null;
    const matchedKeys = opts && opts.matchedKeys ? opts.matchedKeys : null;
    keys.forEach(function (k) {
      const row = document.createElement('div');
      row.className = 'variant-detail-row' + (k === cur ? ' selected' : '');
      row.dataset.variant = k;
      // highlight matching part in name if needed
      let displayName = (highlight && k.toLowerCase().includes(highlight.toLowerCase())) ? highlightHtml(k, highlight) : escapeHtml(k);
      let topHtml = '<span class="variant-detail-dot"></span><span class="variant-detail-name" style="font-size:12px;' + (k === cur ? 'font-weight:700;color:var(--accent-color)' : 'font-weight:600') + '">' + displayName + '</span>';
      row.innerHTML = '<div class="variant-detail-top">' + topHtml + '</div>';
      if (matchedKeys && matchedKeys.includes(k) && !row.classList.contains('selected')) {
        row.style.outline = '1px dashed var(--accent-color)';
        row.style.outlineOffset = '-1px';
      }
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        const label = model.name || model.id;
        const leftItem = list.querySelector('.popup-item[data-provider="' + cssEscape(provider.id) + '"][data-model="' + cssEscape(model.id) + '"]');
        if (leftItem) {
          list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected','expanded'); });
          leftItem.classList.add('selected','expanded');
          leftFocusIndex = allItems.indexOf(leftItem);
          focusPane = 'left';
        }
        commitModel(leftItem || { dataset: {} }, null, provider, model, meta, label, k);
      });
      variantListEl.appendChild(row);
    });
    // Set right focus index to selected
    const rows = Array.from(variantListEl.querySelectorAll('.variant-detail-row'));
    rightFocusIndex = rows.findIndex(function (r) { return r.dataset.variant === cur; });
    if (rightFocusIndex === -1 && rows.length) rightFocusIndex = 0;
  }

  function hideVariantPanel() {
    if (!right) return;
    right.style.display = 'none';
    currentVariantModel = null;
    rightFocusIndex = -1;
  }

  function commitModel(item, sub, provider, model, meta, label, variantKey) {
    list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected', 'expanded'); });
    if (item && item.classList) item.classList.add('selected');
    if (item && item.classList && model.variants && Object.keys(model.variants).length>0) item.classList.add('expanded');
    if (sub) sub.classList.add('selected');
    window.App.currentModel = { provider: provider.id, model: model.id };
    localStorage.setItem('robo_model', JSON.stringify({ provider: provider.id, model: model.id }));
    if (variantKey !== null && variantKey !== undefined) {
      window.App.currentVariant = variantKey;
      localStorage.setItem('robo_variant', variantKey);
    } else {
      window.App.currentVariant = null;
      localStorage.removeItem('robo_variant');
    }
    // Update trigger with variant suffix when needed
    const hasVar = model.variants && Object.keys(model.variants).length>0;
    updateSelectorTrigger(provider.id, label, meta, hasVar ? variantKey : null);
    refreshVariantHints();
    modelPopup.classList.remove('active');
    hideVariantPanel();
    focusPane = 'left';
    rightFocusIndex = -1;
  }

  function buildItem(provider, model, meta) {
    const label = model.name || model.id;
    const item = document.createElement('div');
    item.className = 'popup-item';
    item.dataset.value = provider.id + '/' + model.id;
    item.dataset.provider = provider.id;
    item.dataset.model = model.id;
    // Store refs for search/keyboard
    item._modelData = model;
    item._provider = provider;
    item._meta = meta;
    item._label = label;

    const logo = document.createElement('span');
    logo.className = 'model-item-logo';
    logo.style.background = meta.color;
    logo.textContent = (meta.name || provider.id).charAt(0).toUpperCase();

    const name = document.createElement('span');
    name.className = 'model-item-name';
    name.textContent = label;

    // Secondary variant hint — small secondary text on selected row (mock bullet 6)
    let variantHint = null;
    const hasVariants = model.variants && Object.keys(model.variants).length > 0;
    if (hasVariants) {
      variantHint = document.createElement('span');
      variantHint.className = 'model-item-variant';
      variantHint.style.display = 'none';
    }

    const rightEl = document.createElement('span');
    rightEl.className = 'model-item-right';
    if (hasVariants) {
      const chevron = document.createElement('span');
      chevron.className = 'model-item-chevron';
      chevron.innerHTML = chevronSvg;
      rightEl.appendChild(chevron);
      item.classList.add('has-variants');
    } else {
      const check = document.createElement('span');
      check.className = 'model-item-check';
      check.innerHTML = checkSvg;
      rightEl.appendChild(check);
    }

    item.appendChild(logo);
    item.appendChild(name);
    if (variantHint) item.appendChild(variantHint);
    item.appendChild(rightEl);

    item.addEventListener('click', function (e) {
      e.stopPropagation();
      const hasVar = model.variants && Object.keys(model.variants).length > 0;
      if (hasVar) {
        // Drill-down: select model, show right panel with its variants
        list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected', 'expanded'); });
        item.classList.add('selected', 'expanded');
        leftFocusIndex = allItems.indexOf(item);
        focusPane = 'left';
        let curVar = window.App.currentVariant;
        const keys = Object.keys(model.variants);
        if (!keys.includes(curVar)) curVar = keys[0];
        // Update model+variant immediately (preview) — trigger shows variant
        window.App.currentModel = { provider: provider.id, model: model.id };
        window.App.currentVariant = curVar;
        localStorage.setItem('robo_model', JSON.stringify({ provider: provider.id, model: model.id }));
        localStorage.setItem('robo_variant', curVar);
        updateSelectorTrigger(provider.id, label, meta, curVar);
        refreshVariantHints();
        showVariantPanel(provider, model, meta);
      } else {
        hideVariantPanel();
        commitModel(item, null, provider, model, meta, label, null);
      }
    });

    return item;
  }

  for (const provider of providerList) {
    const models = provider.models ? Object.values(provider.models) : [];
    if (!models.length) continue;
    const meta = window.ProviderModal.getProviderMeta(provider.id);
    const groupHeader = document.createElement('div');
    groupHeader.className = 'model-group-header';
    groupHeader.textContent = providerDisplayName(provider.id, provider);
    list.appendChild(groupHeader);
    for (const model of models) {
      const item = buildItem(provider, model, meta);
      list.appendChild(item);
      allItems.push(item);
      const label = model.name || model.id;
      if (!firstItem) firstItem = { el: item, provider: provider.id, model: model.id, name: label, modelData: model, meta: meta, providerObj: provider };
      if (savedParsed && savedParsed.provider === provider.id && savedParsed.model === model.id) {
        selectedItem = { el: item, provider: provider.id, model: model.id, name: label, modelData: model, meta: meta, providerObj: provider };
      }
    }
  }

  const emptyEl = document.createElement('div');
  emptyEl.className = 'model-popup-empty';
  emptyEl.textContent = 'No models found.';
  emptyEl.style.display = 'none';
  list.appendChild(emptyEl);

  // Helper to get visible left items
  function getVisibleLeftItems() {
    return allItems.filter(function (it) { return it.style.display !== 'none'; });
  }
  function getVisibleVariantRows() {
    if (!variantListEl) return [];
    return Array.from(variantListEl.querySelectorAll('.variant-detail-row'));
  }
  function updateLeftFocusByVisibleIndex(visibleIdx) {
    const visible = getVisibleLeftItems();
    if (!visible.length) return;
    if (visibleIdx < 0) visibleIdx = visible.length - 1;
    if (visibleIdx >= visible.length) visibleIdx = 0;
    const target = visible[visibleIdx];
    list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected','expanded'); });
    target.classList.add('selected','expanded');
    leftFocusIndex = allItems.indexOf(target);
    focusPane = 'left';
    const m = target._modelData;
    const p = target._provider;
    const meta = target._meta;
    if (m.variants && Object.keys(m.variants).length>0) {
      // Preview only — don't commit variant yet, just show panel with committed or first variant highlighted
      showVariantPanel(p, m, meta);
    } else {
      hideVariantPanel();
    }
    target.scrollIntoView({ block: 'nearest' });
  }
  function updateRightFocus(newIdx) {
    const rows = getVisibleVariantRows();
    if (!rows.length) return;
    if (newIdx < 0) newIdx = rows.length - 1;
    if (newIdx >= rows.length) newIdx = 0;
    rows.forEach(function (r) { r.classList.remove('selected'); });
    rows[newIdx].classList.add('selected');
    rightFocusIndex = newIdx;
    focusPane = 'right';
    rows[newIdx].scrollIntoView({ block: 'nearest' });
  }

  // Initial selection
  const chosen = selectedItem || firstItem;
  if (chosen) {
    chosen.el.classList.add('selected');
    if (chosen.modelData && chosen.modelData.variants && Object.keys(chosen.modelData.variants).length > 0) {
      chosen.el.classList.add('expanded');
      if (savedVariant && chosen.modelData.variants[savedVariant]) {
        window.App.currentVariant = savedVariant;
      } else {
        const keys = Object.keys(chosen.modelData.variants);
        if (!keys.includes(window.App.currentVariant)) window.App.currentVariant = keys[0];
      }
      const curVar = window.App.currentVariant;
      updateSelectorTrigger(chosen.provider, chosen.name, chosen.meta, curVar);
      window.App.currentModel = { provider: chosen.provider, model: chosen.model };
      leftFocusIndex = allItems.indexOf(chosen.el);
      refreshVariantHints();
      if (hasAnyVariant) showVariantPanel(chosen.providerObj, chosen.modelData, chosen.meta);
    } else {
      updateSelectorTrigger(chosen.provider, chosen.name, chosen.meta, null);
      window.App.currentModel = { provider: chosen.provider, model: chosen.model };
      leftFocusIndex = allItems.indexOf(chosen.el);
      if (savedVariant) { window.App.currentVariant = null; localStorage.removeItem('robo_variant'); }
      refreshVariantHints();
      hideVariantPanel();
    }
    if (savedVariant && chosen.modelData && chosen.modelData.variants && chosen.modelData.variants[savedVariant]) {
      window.App.currentVariant = savedVariant;
      // Re-sync trigger with correct variant if needed
      if (chosen.modelData.variants) updateSelectorTrigger(chosen.provider, chosen.name, chosen.meta, savedVariant);
      refreshVariantHints();
    }
  } else {
    updateSelectorTrigger(null, 'No models', null, null);
    window.App.currentModel = null;
    leftFocusIndex = -1;
    hideVariantPanel();
  }

  // Search — filters BOTH model and variant, auto-expands matching variant's model (FINAL spec bullet 3)
  search.addEventListener('input', function () {
    const qRaw = search.value.trim();
    const q = qRaw.toLowerCase();
    // Reset variant panel highlight state
    if (!q) {
      // Restore all
      allItems.forEach(function (it) {
        it.style.display = '';
        const nameEl = it.querySelector('.model-item-name');
        if (nameEl) nameEl.textContent = it._label;
        // clear temp outline
        const rows = variantListEl ? variantListEl.querySelectorAll('.variant-detail-row') : [];
        rows.forEach(function (r) { r.style.outline=''; r.style.outlineOffset=''; });
      });
      // Group headers
      list.querySelectorAll('.model-group-header').forEach(function (g) { g.style.display=''; });
      emptyEl.style.display = 'none';
      // Restore to current model (not original chosen) — keeps user's latest selection
      let curItem = null;
      if (window.App.currentModel) {
        curItem = allItems.find(function (it) { return it.dataset.provider === window.App.currentModel.provider && it.dataset.model === window.App.currentModel.model; });
      }
      const ch = curItem ? { el: curItem, provider: curItem.dataset.provider, model: curItem.dataset.model, name: curItem._label, modelData: curItem._modelData, meta: curItem._meta, providerObj: curItem._provider } : (selectedItem || firstItem);
      if (ch && ch.modelData && ch.modelData.variants && Object.keys(ch.modelData.variants).length>0) {
        list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected','expanded'); });
        ch.el.classList.add('selected','expanded');
        leftFocusIndex = allItems.indexOf(ch.el);
        focusPane='left';
        showVariantPanel(ch.providerObj, ch.modelData, ch.meta);
        refreshVariantHints();
      } else {
        hideVariantPanel();
        if (ch) {
          list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected','expanded'); });
          ch.el.classList.add('selected');
          leftFocusIndex = allItems.indexOf(ch.el);
        }
        refreshVariantHints();
      }
      return;
    }
    // q not empty: filter
    let anyVisible = false;
    let firstVariantMatchItem = null;
    let firstMatchedKeys = null;
    allItems.forEach(function (it) {
      const label = it._label;
      const model = it._modelData;
      const nameMatch = label.toLowerCase().includes(q);
      const keys = model.variants ? Object.keys(model.variants) : [];
      const matchedKeys = keys.filter(function (k) { return k.toLowerCase().includes(q); });
      const variantMatch = matchedKeys.length>0;
      const visible = nameMatch || variantMatch;
      it.style.display = visible ? '' : 'none';
      const nameEl = it.querySelector('.model-item-name');
      if (visible && nameMatch) {
        nameEl.innerHTML = highlightHtml(label, qRaw);
      } else if (nameEl) {
        nameEl.textContent = label;
      }
      if (visible) anyVisible = true;
      if (visible && variantMatch && !firstVariantMatchItem) {
        firstVariantMatchItem = it;
        firstMatchedKeys = matchedKeys;
      }
      // stash matched for panel reuse
      it._matchedVariantKeys = variantMatch ? matchedKeys : null;
    });
    // Group headers visibility
    list.querySelectorAll('.model-group-header').forEach(function (g) {
      let next = g.nextElementSibling;
      let groupVisible = false;
      while (next && next !== emptyEl && !next.classList.contains('model-group-header')) {
        if (next.classList.contains('popup-item') && next.style.display !== 'none') groupVisible = true;
        next = next.nextElementSibling;
      }
      g.style.display = groupVisible ? '' : 'none';
      if (groupVisible) anyVisible = true;
    });
    emptyEl.style.display = anyVisible ? 'none' : '';
    // Variant panel auto-expand for matching variant's model (bullet 3)
    if (firstVariantMatchItem) {
      list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected','expanded'); });
      firstVariantMatchItem.classList.add('selected','expanded');
      leftFocusIndex = allItems.indexOf(firstVariantMatchItem);
      focusPane = 'left';
      showVariantPanel(firstVariantMatchItem._provider, firstVariantMatchItem._modelData, firstVariantMatchItem._meta, { highlight: qRaw, matchedKeys: firstMatchedKeys });
      refreshVariantHints();
    } else {
      // No variant match, but maybe model name match — hide panel
      // Keep first visible model selected?
      const visibleItems = getVisibleLeftItems();
      if (visibleItems.length) {
        list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected','expanded'); });
        visibleItems[0].classList.add('selected');
        const m = visibleItems[0]._modelData;
        if (m.variants && Object.keys(m.variants).length>0) {
          visibleItems[0].classList.add('expanded');
          leftFocusIndex = allItems.indexOf(visibleItems[0]);
          showVariantPanel(visibleItems[0]._provider, m, visibleItems[0]._meta);
        } else {
          hideVariantPanel();
          leftFocusIndex = allItems.indexOf(visibleItems[0]);
        }
        refreshVariantHints();
      } else {
        hideVariantPanel();
      }
    }
  });

  // Keyboard — FINAL spec bullet 4: ↑/↓ modelde, → variant'a gir, ← geri, Enter seç
  function handlePopupKey(e) {
    if (!modelPopup.classList.contains('active')) return;
    // Only handle navigation keys
    if (['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Enter','Escape'].indexOf(e.key) === -1) return;
    // If popup is active and search is focused, we still want arrows to navigate
    // But avoid handling when user types letters
    const visibleLeft = getVisibleLeftItems();
    if (!visibleLeft.length && e.key !== 'Escape') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      modelPopup.classList.remove('active');
      hideVariantPanel();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (focusPane === 'left') {
        const curIdx = leftFocusIndex >=0 ? visibleLeft.indexOf(allItems[leftFocusIndex]) : -1;
        const nextIdx = curIdx === -1 ? 0 : (curIdx + 1) % visibleLeft.length;
        updateLeftFocusByVisibleIndex(nextIdx);
      } else if (focusPane === 'right') {
        const rows = getVisibleVariantRows();
        if (!rows.length) return;
        const next = (rightFocusIndex + 1) % rows.length;
        updateRightFocus(next);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (focusPane === 'left') {
        const curIdx = leftFocusIndex >=0 ? visibleLeft.indexOf(allItems[leftFocusIndex]) : 0;
        const prevIdx = curIdx <= 0 ? visibleLeft.length -1 : curIdx -1;
        updateLeftFocusByVisibleIndex(prevIdx);
      } else if (focusPane === 'right') {
        const rows = getVisibleVariantRows();
        if (!rows.length) return;
        const prev = rightFocusIndex <=0 ? rows.length -1 : rightFocusIndex -1;
        updateRightFocus(prev);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (focusPane === 'left') {
        const curItem = leftFocusIndex >=0 ? allItems[leftFocusIndex] : visibleLeft[0];
        if (!curItem) return;
        const model = curItem._modelData;
        if (model.variants && Object.keys(model.variants).length>0) {
          // Ensure panel is visible
          if (right && right.style.display === 'none') {
            showVariantPanel(curItem._provider, model, curItem._meta);
          }
          const rows = getVisibleVariantRows();
          if (rows.length) {
            // Focus first variant (or current selected)
            let selIdx = rows.findIndex(function (r) { return r.classList.contains('selected'); });
            if (selIdx === -1) selIdx = 0;
            updateRightFocus(selIdx);
          }
        }
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (focusPane === 'right') {
        focusPane = 'left';
        // Return focus to left item, keep its selection
        const curLeft = leftFocusIndex >=0 ? allItems[leftFocusIndex] : visibleLeft[0];
        if (curLeft) curLeft.scrollIntoView({block:'nearest'});
        // Clear right selection outline? keep highlight but not focused
        // Optionally update foot back to current left's variant
        if (currentVariantModel) {
          const curVar = window.App.currentVariant;
          // no foot to restore
        }
      } else if (focusPane === 'left') {
        // Maybe clear search? no-op
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusPane === 'left') {
        const curItem = leftFocusIndex >=0 ? allItems[leftFocusIndex] : visibleLeft[0];
        if (!curItem) return;
        const model = curItem._modelData;
        const hasVar = model.variants && Object.keys(model.variants).length>0;
        if (hasVar) {
          // If panel not focused, move to right (second Enter will commit)
          // Instead, directly commit current variant in panel (like click variant)
          if (right && right.style.display !== 'none' && getVisibleVariantRows().length) {
            // If already showing panel, Enter should act like ArrowRight if not yet in right pane
            const rows = getVisibleVariantRows();
            let idx = rightFocusIndex;
            if (focusPane !== 'right') {
              // First Enter on left with variants -> go to right
              let selIdx = rows.findIndex(function (r) { return r.classList.contains('selected'); });
              if (selIdx === -1) selIdx = 0;
              updateRightFocus(selIdx);
              return;
            }
            const selRow = rows[idx] || rows[0];
            if (selRow) {
              const vKey = selRow.dataset.variant;
              commitModel(curItem, null, curItem._provider, model, curItem._meta, curItem._label, vKey);
            }
          } else {
            // No panel, set to first variant
            const keys = Object.keys(model.variants);
            let curVar = window.App.currentVariant;
            if (!keys.includes(curVar)) curVar = keys[0];
            commitModel(curItem, null, curItem._provider, model, curItem._meta, curItem._label, curVar);
          }
        } else {
          commitModel(curItem, null, curItem._provider, model, curItem._meta, curItem._label, null);
        }
      } else if (focusPane === 'right') {
        const rows = getVisibleVariantRows();
        const selRow = rows[rightFocusIndex] || rows[0];
        if (!selRow || !currentVariantModel) return;
        const vKey = selRow.dataset.variant;
        const leftItem = leftFocusIndex >=0 ? allItems[leftFocusIndex] : visibleLeft[0];
        // Use currentVariantModel's provider/model
        const provider = currentVariantModel.provider;
        const model = currentVariantModel.model;
        const meta = currentVariantModel.meta;
        const label = model.name || model.id;
        const leftForModel = list.querySelector('.popup-item[data-provider="' + cssEscape(provider.id) + '"][data-model="' + cssEscape(model.id) + '"]') || leftItem;
        commitModel(leftForModel, null, provider, model, meta, label, vKey);
      }
    }
  }

  // Attach key handlers — ensure only one per popup instance
  if (modelPopup._keydownHandler) {
    document.removeEventListener('keydown', modelPopup._keydownHandler);
    search.removeEventListener('keydown', modelPopup._keydownHandler);
  }
  modelPopup._keydownHandler = handlePopupKey;
  document.addEventListener('keydown', handlePopupKey);
  search.addEventListener('keydown', handlePopupKey);
}

function selectModelFromBackend(providerId, modelId) {
  if (!providerId || !modelId) return false;
  const escId = cssEscape(providerId);
  const escModel = cssEscape(modelId);
  const item = document.querySelector('#modelPopup .popup-item[data-provider="' + escId + '"][data-model="' + escModel + '"]');
  if (!item) return false;
  const modelSelector = document.getElementById('modelSelector');
  const modelPopup = document.getElementById('modelPopup');
  if (!modelSelector || !modelPopup) return false;
  modelPopup.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected','expanded'); });
  item.classList.add('selected');
  // If has variants, also expand
  if (item.classList.contains('has-variants')) item.classList.add('expanded');
  const meta = window.ProviderModal.getProviderMeta(providerId);
  const nameEl = item.querySelector('.model-item-name');
  const name = nameEl ? nameEl.textContent : modelId;
  // Try to get variant
  const modelData = item._modelData;
  let variantKey = null;
  if (modelData && modelData.variants) {
    const keys = Object.keys(modelData.variants);
    variantKey = window.App.currentVariant && keys.includes(window.App.currentVariant) ? window.App.currentVariant : keys[0];
    if (variantKey) window.App.currentVariant = variantKey;
  }
  updateSelectorTrigger(providerId, name, meta, variantKey);
  window.App.currentModel = { provider: providerId, model: modelId };
  localStorage.setItem('robo_model', JSON.stringify({ provider: providerId, model: modelId }));
  if (variantKey) localStorage.setItem('robo_variant', variantKey);
  return true;
}

window.Providers = { loadProviders, loadAgents, selectModelFromBackend };
window.App.getConnectedProviderIds = getConnectedProviderIds;
window.App.addConnectedProvider = addConnectedProvider;
window.App.removeConnectedProvider = removeConnectedProvider;
window.App.isProviderHidden = isProviderHidden;
window.App.setProviderHidden = setProviderHidden;
window.App.readHiddenProviderIds = readHiddenProviderIds;
