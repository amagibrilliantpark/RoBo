/** Fetch available AI providers and populate the model selector. */
async function loadProviders() {
  const t0 = performance.now();
  try {
    if (!window.App.forceShowProviders) window.App.forceShowProviders = [];
    const providers = await window.electronAPI.provider.list();
    window.App.providers = providers || [];
    populateModelSelector(providers);
  } catch (error) {
    console.error(`[Init] loadProviders FAILED in ${(performance.now() - t0).toFixed(0)}ms:`, error.message);
    if(window.App.debug)console.error('Failed to load providers:', error);
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
    if(window.App.debug)console.error('Failed to load agents:', error);
  }
}

/** Persisted set of provider ids the user has confirmed connected this session.
 *  OpenCode only marks providers "connected" after reloading its startup auth,
 *  so we track them locally to keep the checkmark / model catalog in sync. */
function readConnectedProviderIds() {
  try {
    const raw = localStorage.getItem('robo_connected_providers');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Union of server-reported connected providers, locally confirmed ones, and
 *  providers force-revealed right after a connect. */
function getConnectedProviderIds() {
  const server = (window.App.providers && window.App.providers.connected) || [];
  const manual = readConnectedProviderIds();
  const force = window.App.forceShowProviders || [];
  return [...new Set([...server, ...manual, ...force])];
}

function addConnectedProvider(id) {
  if (!id) return;
  const list = readConnectedProviderIds();
  if (!list.includes(id)) {
    list.push(id);
    localStorage.setItem('robo_connected_providers', JSON.stringify(list));
  }
}

function removeConnectedProvider(id) {
  const list = readConnectedProviderIds().filter((x) => x !== id);
  localStorage.setItem('robo_connected_providers', JSON.stringify(list));
  if (window.App.forceShowProviders) {
    window.App.forceShowProviders = window.App.forceShowProviders.filter(
      (x) => x !== id,
    );
  }
}

function providerDisplayName(id, fallback) {
  if (fallback && fallback.name) return fallback.name;
  if (fallback && fallback.id) return fallback.id;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Render the model-selector trigger as a small provider avatar + model name,
 *  matching the command-palette look used inside the popup. */
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

/** Build the model selector dropdown from provider data, restoring saved selection.
 *  Models with variants expand inline (nested sub-items) instead of opening a
 *  separate popup, so the whole pick stays in one command palette. */
function populateModelSelector(providers) {
  const modelPopup = document.getElementById('modelPopup');
  modelPopup.innerHTML = '';

  // Command-style search input (fixed at top)
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

  // Scrollable list container for model items
  const list = document.createElement('div');
  list.className = 'model-popup-list';
  modelPopup.appendChild(list);

  // Footer: add provider (command-item styled)
  const footer = document.createElement('div');
  footer.className = 'model-popup-footer';
  const addItem = document.createElement('button');
  addItem.className = 'model-popup-add';
  addItem.id = 'addProviderBtn';
  addItem.innerHTML =
    '<span class="model-add-icon"><svg viewBox="0 0 16 16"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg></span>' +
    '<span>Add Provider</span>';
  addItem.addEventListener('click', (e) => {
    e.stopPropagation();
    modelPopup.classList.remove('active');
    if (window.ProviderModal) {
      window.ProviderModal.open();
    }
  });
  footer.appendChild(addItem);
  modelPopup.appendChild(footer);

  if (!providers) return;

  const allProviders = providers.all || [];
  // Providers the user just added are force-revealed even before OpenCode's
  // server marks them "connected" (credentials load at startup, so a freshly
  // stored key may not appear in `connected` until a restart). This keeps the
  // newly added provider visible in the model picker immediately. When nothing
  // is connected yet we fall back to showing every provider so the user can pick.
  const effectiveConnected = getConnectedProviderIds();
  const providerList = effectiveConnected.length > 0
    ? allProviders.filter((p) => effectiveConnected.includes(p.id))
    : allProviders;

  const savedModel = localStorage.getItem('robo_model');
  const savedVariant = localStorage.getItem('robo_variant');
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
    item.dataset.value = `${provider.id}/${model.id}`;
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

    item.addEventListener('click', (e) => {
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
    list.querySelectorAll('.popup-item').forEach((i) => i.classList.remove('selected'));
    item.classList.add('selected');
    if (sub) sub.classList.add('selected');
    window.App.currentModel = { provider: provider.id, model: model.id };
    localStorage.setItem('robo_model', JSON.stringify({ provider: provider.id, model: model.id }));
    if (variantKey !== null) {
      window.App.currentVariant = variantKey;
      localStorage.setItem('robo_variant', variantKey);
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
    list.querySelectorAll('.popup-item').forEach((i) => i.classList.remove('selected'));
    const wrap = document.createElement('div');
    wrap.className = 'model-variants';
    keys.forEach((key) => {
      const chip = document.createElement('div');
      chip.className = 'model-variant-chip' + (key === currentVariant ? ' selected' : '');
      chip.dataset.provider = provider.id;
      chip.dataset.model = model.id;
      chip.dataset.variant = key;
      chip.textContent = key;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        wrap
          .querySelectorAll('.model-variant-chip')
          .forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        commitModel(item, chip, provider, model, meta, label, key);
      });
      wrap.appendChild(chip);
    });
    item.after(wrap);
    item.classList.add('expanded', 'selected');
    // Selecting a model with variants still commits the model immediately so a
    // default variant is in effect even if the user closes without picking one.
    window.App.currentModel = { provider: provider.id, model: model.id };
    localStorage.setItem('robo_model', JSON.stringify({ provider: provider.id, model: model.id }));
    updateSelectorTrigger(provider.id, label, meta);
  }

  function collapseVariants(item) {
    item.classList.remove('expanded');
    const wrap = item.nextElementSibling;
    if (wrap && wrap.classList.contains('model-variants')) {
      wrap.remove();
    }
  }

  function toggleVariants(item, provider, model, meta, label) {
    list.querySelectorAll('.popup-item.expanded').forEach((other) => {
      if (other !== item) collapseVariants(other);
    });
    if (item.classList.contains('expanded')) {
      collapseVariants(item);
    } else {
      expandVariants(item, provider, model, meta, label);
    }
  }

  for (const provider of providerList) {
    const models = provider.models ? Object.values(provider.models) : [];
    if (!models.length) continue;

    const meta = window.ProviderModal.getProviderMeta(provider.id);

    // Group header: provider name above its models
    const groupHeader = document.createElement('div');
    groupHeader.className = 'model-group-header';
    groupHeader.textContent = providerDisplayName(provider.id, provider);
    list.appendChild(groupHeader);

    for (const model of models) {
      const item = buildItem(provider, model, meta);
      list.appendChild(item);
      const label = model.name || model.id;

      if (!firstItem) {
        firstItem = { el: item, provider: provider.id, model: model.id, name: label, modelData: model };
      }

      if (savedModel) {
        try {
          const saved = JSON.parse(savedModel);
          if (saved.provider === provider.id && saved.model === model.id) {
            selectedItem = { el: item, provider: provider.id, model: model.id, name: label, modelData: model };
          }
        } catch {}
      }
    }
  }

  // Empty-state element for search misses (toggled by the search handler)
  const emptyEl = document.createElement('div');
  emptyEl.className = 'model-popup-empty';
  emptyEl.textContent = 'No models found.';
  emptyEl.style.display = 'none';
  list.appendChild(emptyEl);

  // Select saved or first model
  const chosen = selectedItem || firstItem;
  if (chosen) {
    chosen.el.classList.add('selected');
    const meta = window.ProviderModal.getProviderMeta(chosen.provider);
    updateSelectorTrigger(chosen.provider, chosen.name, meta);
    window.App.currentModel = { provider: chosen.provider, model: chosen.model };

    if (savedVariant) {
      window.App.currentVariant = savedVariant;
    }
    // Expand the chosen model's variants inline so the active variant shows.
    if (
      chosen.modelData &&
      chosen.modelData.variants &&
      Object.keys(chosen.modelData.variants).length > 0
    ) {
      expandVariants(chosen.el, { id: chosen.provider }, chosen.modelData, meta, chosen.name);
    }
  } else {
    updateSelectorTrigger(null, 'No models', null);
  }

  // Search filter across model + variant names; hide empty groups; show empty state
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    list.querySelectorAll('.popup-item').forEach((it) => {
      const nm = it.querySelector('.model-item-name').textContent.toLowerCase();
      it.style.display = !q || nm.includes(q) ? '' : 'none';
    });
    list.querySelectorAll('.model-variants').forEach((wrap) => {
      const item = wrap.previousElementSibling;
      const hidden = item && item.style.display === 'none';
      wrap.style.display = hidden ? 'none' : '';
      if (!hidden) {
        wrap.querySelectorAll('.model-variant-chip').forEach((chip) => {
          chip.style.display = !q || chip.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      }
    });
    let anyVisible = false;
    list.querySelectorAll('.model-group-header').forEach((g) => {
      let next = g.nextElementSibling;
      let groupVisible = false;
      while (next && next !== emptyEl && !next.classList.contains('model-group-header')) {
        if (next.classList.contains('popup-item') && next.style.display !== 'none') {
          groupVisible = true;
        }
        next = next.nextElementSibling;
      }
      g.style.display = groupVisible ? '' : 'none';
      if (groupVisible) anyVisible = true;
    });
    emptyEl.style.display = anyVisible ? 'none' : '';
  });

  // Keep internal clicks from closing the popup (e.g. typing in search)
  modelPopup.addEventListener('click', (e) => e.stopPropagation());
}

/**
 * Apply a model selection that came from the backend (e.g. a session's stored
 * model) onto the dropdown. The model must exist in the current provider list,
 * otherwise we leave the user's last manual selection alone.
 */
function selectModelFromBackend(providerId, modelId) {
  if (!providerId || !modelId) return false;
  const item = document.querySelector(
    `#modelPopup .popup-item[data-provider="${CSS.escape(providerId)}"][data-model="${CSS.escape(modelId)}"]`,
  );
  if (!item) return false;
  const modelSelector = document.getElementById("modelSelector");
  const modelPopup = document.getElementById("modelPopup");
  if (!modelSelector || !modelPopup) return false;

  modelPopup
    .querySelectorAll(".popup-item")
    .forEach((i) => i.classList.remove("selected"));
  item.classList.add("selected");
  const meta = window.ProviderModal.getProviderMeta(providerId);
  const name = item.querySelector('.model-item-name').textContent;
  updateSelectorTrigger(providerId, name, meta);

  window.App.currentModel = { provider: providerId, model: modelId };
  localStorage.setItem(
    "robo_model",
    JSON.stringify({ provider: providerId, model: modelId }),
  );
  return true;
}

window.Providers = { loadProviders, loadAgents, selectModelFromBackend };
window.App.getConnectedProviderIds = getConnectedProviderIds;
window.App.addConnectedProvider = addConnectedProvider;
window.App.removeConnectedProvider = removeConnectedProvider;
