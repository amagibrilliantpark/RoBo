/** Auto-dim the native title bar overlay whenever a full-screen modal is open,
 *  so it blends with the modal's dimmed backdrop instead of staying bright. */
(function () {
  const OVERLAYS = [
    "settingsPage",
    "questionModal",
    "centerSearchModal",
    "providerAddModal",
    "confirmModal",
  ];

  let dimLevel = 0;

  function update() {
    if (
      !window.electronAPI ||
      !window.electronAPI.window ||
      !window.electronAPI.window.setTitleBarDim
    ) {
      return;
    }
    const visibleCount = OVERLAYS.filter((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains("hidden");
    }).length;
    // 0 = no dim, 1 = single overlay dim, 2+ = double dim (e.g. settings + providerAdd)
    if (visibleCount !== dimLevel) {
      dimLevel = visibleCount;
      window.electronAPI.window.setTitleBarDim(visibleCount);
    }
  }

  function init() {
    OVERLAYS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      new MutationObserver(update).observe(el, {
        attributes: true,
        attributeFilter: ["class"],
      });
    });
    update();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
