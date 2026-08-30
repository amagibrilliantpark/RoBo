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

function updateSelectorTrigger(providerId, name, meta) {
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

  // L3: avoid duplicate click guard
  if (!modelPopup._hasClickGuard) {
    modelPopup.addEventListener('click', function (e) { e.stopPropagation(); });
    modelPopup._hasClickGuard = true;
  }

  modelPopup.innerHTML = '';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'model-popup-search';
  const search = document.createElement('input');
  search.className = 'model-search-input';
  search.type = 'text';
  search.id = 'modelSearch';
  search.placeholder = 'Search models...';
  search.autocomplete = 'off';
  search.spellcheck = false;
  searchWrap.appendChild(search);
  modelPopup.appendChild(searchWrap);

  const list = document.createElement('div');
  list.className = 'model-popup-list';
  modelPopup.appendChild(list);

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
  modelPopup.appendChild(footer);

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

  // L4: handle stale savedModel pointing at hidden/deleted provider
  let savedModel = localStorage.getItem('robo_model');
  let savedVariant = localStorage.getItem('robo_variant');
  let savedParsed = null;
  if (savedModel) {
    try {
      savedParsed = JSON.parse(savedModel);
      const stillVisible = savedParsed && savedParsed.provider && providerList.some(function (p) { return p.id === savedParsed.provider; });
      if (!stillVisible && savedParsed) {
        // Provider hidden or deleted — clear stale selection so fallback to first visible
        const isHidden = savedParsed.provider && isProviderHidden(savedParsed.provider);
        if (isHidden || !connectedIds.includes(savedParsed.provider)) {
          // keep the key for hidden case? For hidden we clear so fallback shows, but hidden can be re-shown later
          // Clear only if deleted (not hidden) to avoid confusion; for hidden we keep but don't select it now
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

  function buildItem(provider, model, meta) {
    const label = model.name || model.id;
    const item = document.createElement('div');
    item.className = 'popup-item';
    item.dataset.value = provider.id + '/' + model.id;
    item.dataset.provider = provider.id;
    item.dataset.model = model.id;

    const logo = document.createElement('span');
    logo.className = 'model-item-logo';
    logo.style.background = meta.color;
    logo.textContent = (meta.name || provider.id).charAt(0).toUpperCase();

    const name = document.createElement('span');
    name.className = 'model-item-name';
    name.textContent = label;

    const right = document.createElement('span');
    right.className = 'model-item-right';
    const hasVariants = model.variants && Object.keys(model.variants).length > 0;
    if (hasVariants) {
      const chevron = document.createElement('span');
      chevron.className = 'model-item-chevron';
      chevron.innerHTML = chevronSvg;
      right.appendChild(chevron);
    } else {
      const check = document.createElement('span');
      check.className = 'model-item-check';
      check.innerHTML = checkSvg;
      right.appendChild(check);
    }

    item.appendChild(logo);
    item.appendChild(name);
    item.appendChild(right);

    item.addEventListener('click', function (e) {
      e.stopPropagation();
      const isVariants = model.variants && Object.keys(model.variants).length > 0;
      if (isVariants) {
        toggleVariants(item, provider, model, meta, label);
      } else {
        commitModel(item, null, provider, model, meta, label, null);
      }
    });

    return item;
  }

  function commitModel(item, sub, provider, model, meta, label, variantKey) {
    list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected'); });
    item.classList.add('selected');
    if (sub) sub.classList.add('selected');
    window.App.currentModel = { provider: provider.id, model: model.id };
    localStorage.setItem('robo_model', JSON.stringify({ provider: provider.id, model: model.id }));
    if (variantKey !== null) {
      window.App.currentVariant = variantKey;
      localStorage.setItem('robo_variant', variantKey);
    } else {
      // clear variant if model has none
      window.App.currentVariant = null;
      localStorage.removeItem('robo_variant');
    }
    updateSelectorTrigger(provider.id, label, meta);
    modelPopup.classList.remove('active');
  }

  function expandVariants(item, provider, model, meta, label) {
    const keys = Object.keys(model.variants);
    let currentVariant = window.App.currentVariant;
    if (!keys.includes(currentVariant)) {
      currentVariant = keys[0];
      window.App.currentVariant = currentVariant;
      localStorage.setItem('robo_variant', currentVariant);
    }
    list.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected'); });
    const wrap = document.createElement('div');
    wrap.className = 'model-variants';
    keys.forEach(function (key) {
      const chip = document.createElement('div');
      chip.className = 'model-variant-chip' + (key === currentVariant ? ' selected' : '');
      chip.dataset.provider = provider.id;
      chip.dataset.model = model.id;
      chip.dataset.variant = key;
      chip.textContent = key;
      chip.addEventListener('click', function (e) {
        e.stopPropagation();
        wrap.querySelectorAll('.model-variant-chip').forEach(function (c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
        commitModel(item, chip, provider, model, meta, label, key);
      });
      wrap.appendChild(chip);
    });
    item.after(wrap);
    item.classList.add('expanded', 'selected');
    window.App.currentModel = { provider: provider.id, model: model.id };
    localStorage.setItem('robo_model', JSON.stringify({ provider: provider.id, model: model.id }));
    updateSelectorTrigger(provider.id, label, meta);
  }

  function collapseVariants(item) {
    item.classList.remove('expanded');
    const wrap = item.nextElementSibling;
    if (wrap && wrap.classList.contains('model-variants')) wrap.remove();
  }

  function toggleVariants(item, provider, model, meta, label) {
    list.querySelectorAll('.popup-item.expanded').forEach(function (other) {
      if (other !== item) collapseVariants(other);
    });
    if (item.classList.contains('expanded')) collapseVariants(item);
    else expandVariants(item, provider, model, meta, label);
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
      const label = model.name || model.id;
      if (!firstItem) firstItem = { el: item, provider: provider.id, model: model.id, name: label, modelData: model };
      if (savedParsed && savedParsed.provider === provider.id && savedParsed.model === model.id) {
        selectedItem = { el: item, provider: provider.id, model: model.id, name: label, modelData: model };
      }
    }
  }

  const emptyEl = document.createElement('div');
  emptyEl.className = 'model-popup-empty';
  emptyEl.textContent = 'No models found.';
  emptyEl.style.display = 'none';
  list.appendChild(emptyEl);

  const chosen = selectedItem || firstItem;
  if (chosen) {
    chosen.el.classList.add('selected');
    const meta = window.ProviderModal.getProviderMeta(chosen.provider);
    updateSelectorTrigger(chosen.provider, chosen.name, meta);
    window.App.currentModel = { provider: chosen.provider, model: chosen.model };
    if (savedVariant && chosen.modelData && chosen.modelData.variants && chosen.modelData.variants[savedVariant]) {
      window.App.currentVariant = savedVariant;
    } else if (savedVariant) {
      // variant points at hidden/deleted model — clear
      window.App.currentVariant = null;
    }
    if (chosen.modelData && chosen.modelData.variants && Object.keys(chosen.modelData.variants).length > 0) {
      expandVariants(chosen.el, { id: chosen.provider }, chosen.modelData, meta, chosen.name);
    }
  } else {
    updateSelectorTrigger(null, 'No models', null);
    window.App.currentModel = null;
  }

  // Search filter
  search.addEventListener('input', function () {
    const q = search.value.trim().toLowerCase();
    list.querySelectorAll('.popup-item').forEach(function (it) {
      const nmEl = it.querySelector('.model-item-name');
      const nm = nmEl ? nmEl.textContent.toLowerCase() : '';
      it.style.display = !q || nm.includes(q) ? '' : 'none';
    });
    list.querySelectorAll('.model-variants').forEach(function (wrap) {
      const item = wrap.previousElementSibling;
      const hidden = item && item.style.display === 'none';
      wrap.style.display = hidden ? 'none' : '';
      if (!hidden) {
        wrap.querySelectorAll('.model-variant-chip').forEach(function (chip) {
          chip.style.display = !q || chip.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
        // Hide wrapper if all chips hidden
        const anyChipVisible = Array.from(wrap.querySelectorAll('.model-variant-chip')).some(function (c) { return c.style.display !== 'none'; });
        if (!anyChipVisible) wrap.style.display = 'none';
      }
    });
    let anyVisible = false;
    list.querySelectorAll('.model-group-header').forEach(function (g) {
      let next = g.nextElementSibling;
      let groupVisible = false;
      while (next && next !== emptyEl && !next.classList.contains('model-group-header')) {
        if (next.classList.contains('popup-item') && next.style.display !== 'none') groupVisible = true;
        if (next.classList.contains('model-variants') && next.style.display !== 'none' && next.style.display !== '') groupVisible = true;
        next = next.nextElementSibling;
      }
      g.style.display = groupVisible ? '' : 'none';
      if (groupVisible) anyVisible = true;
    });
    emptyEl.style.display = anyVisible ? 'none' : '';
  });
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
  modelPopup.querySelectorAll('.popup-item').forEach(function (i) { i.classList.remove('selected'); });
  item.classList.add('selected');
  const meta = window.ProviderModal.getProviderMeta(providerId);
  const nameEl = item.querySelector('.model-item-name');
  const name = nameEl ? nameEl.textContent : modelId;
  updateSelectorTrigger(providerId, name, meta);
  window.App.currentModel = { provider: providerId, model: modelId };
  localStorage.setItem('robo_model', JSON.stringify({ provider: providerId, model: modelId }));
  return true;
}

window.Providers = { loadProviders, loadAgents, selectModelFromBackend };
window.App.getConnectedProviderIds = getConnectedProviderIds;
window.App.addConnectedProvider = addConnectedProvider;
window.App.removeConnectedProvider = removeConnectedProvider;
window.App.isProviderHidden = isProviderHidden;
window.App.setProviderHidden = setProviderHidden;
window.App.readHiddenProviderIds = readHiddenProviderIds;
