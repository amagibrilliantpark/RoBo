/** Provider modal: list, custom-provider, and detail rendering. */
(function () {
  const M = (window.ProviderModal = window.ProviderModal || {});

  function renderProviderList() {
    const container = M.el("providerList");
    const ids = M.PM.providersList;
    if (!ids || ids.length === 0) {
      container.innerHTML = `<div class="provider-list-empty">No providers available</div>`;
      return;
    }

    const connectedIds = window.App.getConnectedProviderIds
      ? window.App.getConnectedProviderIds()
      : M.PM.connectedProviders || [];

    container.innerHTML = "";

    // Search input (command-style, fixed at top)
    const searchWrap = document.createElement("div");
    searchWrap.className = "provider-popup-search";
    const search = document.createElement("input");
    search.className = "provider-search-input";
    search.type = "text";
    search.id = "providerSearch";
    search.placeholder = "Search providers...";
    search.autocomplete = "off";
    search.spellcheck = false;
    searchWrap.appendChild(search);
    container.appendChild(searchWrap);

    const listWrap = document.createElement("div");
    listWrap.className = "provider-list-scroll";
    container.appendChild(listWrap);

    const connected = [];
    const others = [];
    for (const id of ids) {
      if (connectedIds.includes(id)) connected.push(id);
      else others.push(id);
    }

    function buildCard(id, isConnected) {
      const detail = M.PM.providersAllDetails ? M.PM.providersAllDetails[id] : null;
      const meta = detail && detail.name
        ? { name: detail.name, color: detail.color }
        : M.getProviderMeta(id);
      const name = (detail && detail.name) || meta.name;

      const card = document.createElement("button");
      card.className = "provider-card";
      card.dataset.id = id;
      card.dataset.name = name.toLowerCase();

      const avatar = document.createElement("span");
      avatar.className = "provider-card-avatar";
      avatar.style.background = meta.color;
      avatar.textContent = name.charAt(0).toUpperCase();

      const body = document.createElement("span");
      body.className = "provider-card-body";

      const nameEl = document.createElement("span");
      nameEl.className = "provider-card-name";
      nameEl.textContent = name;

      const status = document.createElement("span");
      status.className = "provider-card-status" + (isConnected ? " connected" : "");
      status.textContent = isConnected ? "Connected" : "Tap to connect";

      body.appendChild(nameEl);
      body.appendChild(status);
      card.appendChild(avatar);
      card.appendChild(body);

      card.addEventListener("click", () =>
        M.selectProvider(id, M.PM.authMethods[id] || [], meta),
      );
      return card;
    }

    function appendGroup(title, items) {
      const header = document.createElement("div");
      header.className = "provider-group-header";
      header.textContent = title;
      listWrap.appendChild(header);
      const grid = document.createElement("div");
      grid.className = "provider-card-grid";
      items.forEach((id) => grid.appendChild(buildCard(id, title === "Connected")));
      listWrap.appendChild(grid);
    }

    if (connected.length) appendGroup("Connected", connected);
    if (others.length) appendGroup("Custom", others);

    const customBtn = document.createElement("button");
    customBtn.className = "provider-custom-btn";
    customBtn.dataset.name = "other custom";
    customBtn.innerHTML =
      '<span class="provider-custom-plus">+</span><span>Custom Provider</span>';
    customBtn.addEventListener("click", () => M.openCustomProvider());
    listWrap.appendChild(customBtn);

    // Filter providers by name; hide empty groups
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      listWrap.querySelectorAll(".provider-card").forEach((card) => {
        const name = card.dataset.name || "";
        card.style.display = !q || name.includes(q) ? "" : "none";
      });
      listWrap.querySelectorAll(".provider-group-header").forEach((g) => {
        let next = g.nextElementSibling;
        let visible = false;
        while (
          next &&
          !next.classList.contains("provider-group-header") &&
          !next.classList.contains("provider-custom-btn")
        ) {
          if (next.classList.contains("provider-card") && next.style.display !== "none") {
            visible = true;
          }
          next = next.nextElementSibling;
        }
        g.style.display = visible ? "" : "none";
      });
    });
  }

  function setDetailHeader(opts) {
    const avatar = M.el("providerDetailAvatar");
    if (opts.showAvatar === false) {
      avatar.style.display = "none";
    } else {
      avatar.style.display = "";
      avatar.style.background = opts.color || "#8a93a6";
      avatar.textContent = (opts.char || "?").toUpperCase();
    }
    M.el("providerDetailKicker").textContent = opts.kicker || "";
    M.el("providerDetailTitle").textContent = opts.title || "";
    const steps = M.el("providerDetailSteps");
    if (opts.steps) {
      steps.style.display = "";
      steps.querySelectorAll(".provider-step").forEach((d, i) => {
        d.classList.toggle("active", i < (opts.activeStep || 1));
      });
    } else {
      steps.style.display = "none";
    }
  }

  const ARROW_SVG =
    '<svg class="provider-btn-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9M9 4l4 4-4 4"/></svg>';
  function connectLabel(text) {
    return `<span>${text}</span>${ARROW_SVG}`;
  }
  M.connectLabel = connectLabel;

  function setupKeyToggles() {
    const pairs = [
      ["providerKeyToggle", "providerKeyInput"],
      ["providerCustomKeyToggle", "providerCustomKey"],
    ];
    pairs.forEach(([btnId, inputId]) => {
      const btn = document.getElementById(btnId);
      const input = document.getElementById(inputId);
      if (!btn || !input) return;
      btn.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        const eye = btn.querySelector(".icon-eye");
        const eyeOff = btn.querySelector(".icon-eye-off");
        if (eye) eye.style.display = show ? "none" : "";
        if (eyeOff) eyeOff.style.display = show ? "" : "none";
      });
    });
  }

  function openCustomProvider() {
    M.PM.selectedProvider = "__custom__";
    M.PM.customStep = 1;
    M.el("providerList").classList.remove("active");
    M.el("providerList").classList.add("hidden");
    M.el("providerDetail").classList.add("active");
    M.el("providerError").classList.remove("active");
    M.el("providerSuccess").classList.remove("active");

    document.getElementById("providerDetailCustom").classList.add("active");
    document.getElementById("providerDetailDefault").classList.remove("active");

    setDetailHeader({
      kicker: "Custom Provider",
      title: "Custom Provider",
      color: "#8a93a6",
      char: "C",
      steps: true,
      activeStep: 1,
    });
    M.showCustomStep(1);
  }

  function showCustomStep(step) {
    M.PM.customStep = step;
    const idRow = M.el("providerCustomIdRow");
    const keyRow = M.el("providerCustomKeyRow");
    const connectBtn = M.el("providerBtnConnect");

    if (step === 1) {
      idRow.style.display = "flex";
      keyRow.style.display = "none";
      M.el("providerCustomId").value = "";
      M.el("providerCustomId").focus();
      connectBtn.innerHTML = M.connectLabel("Next");
      connectBtn.disabled = false;
      connectBtn.classList.remove("loading");
    } else {
      idRow.style.display = "none";
      keyRow.style.display = "flex";
      M.el("providerCustomIdDisplay").textContent = M.PM.customProviderId;
      M.el("providerCustomKey").value = "";
      M.el("providerCustomKey").focus();
      connectBtn.innerHTML = M.connectLabel("Connect");
      connectBtn.disabled = false;
      connectBtn.classList.remove("loading");
      const id = M.PM.customProviderId;
      setDetailHeader({
        kicker: "Custom Provider",
        title: id || "Custom Provider",
        color: "#8a93a6",
        char: (id || "C").charAt(0),
        steps: true,
        activeStep: 2,
      });
    }
  }

  /** Render extra prompt fields (beyond the base API key) declared by an auth method. */
  function renderExtraPrompts(prompts) {
    const container = M.el("providerExtraFields");
    container.innerHTML = "";
    M.PM.extraPrompts = prompts || [];

    for (const prompt of M.PM.extraPrompts) {
      const group = document.createElement("div");
      group.className = "provider-field-group";
      group.style.marginTop = "16px";

      const label = document.createElement("div");
      label.className = "provider-detail-label";
      label.textContent = prompt.message || prompt.key;
      group.appendChild(label);

      if (prompt.type === "select") {
        const select = document.createElement("select");
        select.className = "provider-key-input";
        select.dataset.promptKey = prompt.key;
        for (const opt of prompt.options || []) {
          const option = document.createElement("option");
          option.value = opt.value;
          option.textContent = opt.label;
          select.appendChild(option);
        }
        group.appendChild(select);
      } else {
        const input = document.createElement("input");
        input.className = "provider-key-input";
        input.type = "text";
        input.placeholder = prompt.placeholder || "";
        input.dataset.promptKey = prompt.key;
        group.appendChild(input);
      }

      container.appendChild(group);
    }
  }

  /** Collect the values of any extra prompt fields into a metadata object. */
  function collectExtraPromptValues() {
    const metadata = {};
    const container = M.el("providerExtraFields");
    container.querySelectorAll("[data-prompt-key]").forEach((fieldEl) => {
      metadata[fieldEl.dataset.promptKey] = fieldEl.value;
    });
    return metadata;
  }

  function selectProvider(id, methods, meta) {
    M.PM.selectedProvider = id;
    M.PM.oauthStage = null;

    const apiMethodIndex = methods.findIndex((m) => m.type === "api");
    const oauthMethodIndex = methods.findIndex((m) => m.type === "oauth");

    const isConnected =
      window.App.getConnectedProviderIds &&
      window.App.getConnectedProviderIds().includes(id);

    const kicker = isConnected
      ? "Connected"
      : oauthMethodIndex !== -1
        ? "OAuth"
        : "API Key";
    setDetailHeader({
      kicker,
      title: meta.name,
      color: meta.color,
      char: meta.name.charAt(0),
      steps: false,
    });
    M.el("providerList").classList.remove("active");
    M.el("providerList").classList.add("hidden");
    M.el("providerDetail").classList.add("active");
    M.el("providerError").classList.remove("active");
    M.el("providerSuccess").classList.remove("active");

    const defaultDetail = document.getElementById("providerDetailDefault");
    const customDetail = document.getElementById("providerDetailCustom");
    const connectedDetail = document.getElementById("providerDetailConnected");

    M.el("providerOAuthCodeRow").style.display = "none";
    M.el("providerExtraFields").innerHTML = "";

    const connectBtn = M.el("providerBtnConnect");
    const disconnectBtn = M.el("providerBtnDisconnect");
    const removeBtn = M.el("providerBtnRemove");

    if (isConnected) {
      defaultDetail.classList.remove("active");
      customDetail.classList.remove("active");
      connectedDetail.classList.add("active");
      connectBtn.style.display = "none";
      const isCustom = M.isCustomProvider(id);
      disconnectBtn.style.display = "";
      removeBtn.style.display = isCustom ? "" : "none";
      disconnectBtn.disabled = false;
      disconnectBtn.classList.remove("loading");
      removeBtn.disabled = false;
      removeBtn.classList.remove("loading");
      disconnectBtn.innerHTML = "<span>Disconnect</span>";
      removeBtn.innerHTML = "<span>Delete Provider</span>";
      return;
    }

    connectedDetail.classList.remove("active");
    defaultDetail.classList.add("active");
    customDetail.classList.remove("active");
    connectBtn.style.display = "";
    disconnectBtn.style.display = "none";
    removeBtn.style.display = "none";

    document.getElementById("providerDetailDefault").classList.add("active");
    document.getElementById("providerDetailCustom").classList.remove("active");

    M.el("providerOAuthCodeRow").style.display = "none";
    M.el("providerExtraFields").innerHTML = "";

    if (apiMethodIndex !== -1) {
      M.PM.methodType = "api";
      M.PM.methodIndex = apiMethodIndex;
      const method = methods[apiMethodIndex];

      M.el("providerDetailHint").textContent =
        `Enter your ${meta.name} API key to connect.`;
      M.el("providerKeyRow").style.display = "flex";
      M.el("providerKeyInput").value = "";
      M.el("providerKeyInput").placeholder =
        meta.name === "OpenAI"
          ? "sk-..."
          : meta.name === "Anthropic"
            ? "sk-ant-..."
            : "Paste your API key...";
      M.el("providerKeyInput").focus();

      M.renderExtraPrompts(method.prompts);
    } else if (oauthMethodIndex !== -1) {
      M.PM.methodType = "oauth";
      M.PM.methodIndex = oauthMethodIndex;

      M.el("providerDetailHint").textContent =
        `Click Connect to authorize ${meta.name} in your browser.`;
      M.el("providerKeyRow").style.display = "none";
    } else {
      M.PM.methodType = "api";
      M.PM.methodIndex = 0;

      M.el("providerDetailHint").textContent =
        `Paste your credentials for ${meta.name}.`;
      M.el("providerKeyRow").style.display = "flex";
      M.el("providerKeyInput").value = "";
      M.el("providerKeyInput").placeholder = "Paste your credentials...";
      M.el("providerKeyInput").focus();
    }

    connectBtn.disabled = false;
    connectBtn.classList.remove("loading");
    connectBtn.innerHTML = M.connectLabel("Connect");
  }

  function showListView() {
    M.el("providerList").classList.add("active");
    M.el("providerList").classList.remove("hidden");
    M.el("providerDetail").classList.remove("active");
    M.el("providerSuccess").classList.remove("active");
    M.el("providerError").classList.remove("active");
    document.getElementById("providerDetailDefault").classList.remove("active");
    document.getElementById("providerDetailCustom").classList.remove("active");
    document.getElementById("providerDetailConnected").classList.remove("active");
    M.el("providerBtnConnect").style.display = "";
    M.el("providerBtnDisconnect").style.display = "none";
    M.el("providerBtnRemove").style.display = "none";
  }

  function setConnecting(label) {
    const connectBtn = M.el("providerBtnConnect");
    connectBtn.disabled = true;
    connectBtn.classList.add("loading");
    connectBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg><span>${label}</span>`;
  }

  function addForceShowProvider(id) {
    if (!id) return;
    if (!window.App.forceShowProviders) window.App.forceShowProviders = [];
    if (!window.App.forceShowProviders.includes(id)) {
      window.App.forceShowProviders.push(id);
    }
  }

  M.renderProviderList = renderProviderList;
  M.openCustomProvider = openCustomProvider;
  setupKeyToggles();
  M.showCustomStep = showCustomStep;
  M.renderExtraPrompts = renderExtraPrompts;
  M.collectExtraPromptValues = collectExtraPromptValues;
  M.selectProvider = selectProvider;
  M.showListView = showListView;
  M.setConnecting = setConnecting;
  M.addForceShowProvider = addForceShowProvider;
})();
