/** Auto-dim the native title bar overlay whenever a full-screen modal is open,
 *  so it blends with the modal's dimmed backdrop instead of staying bright. */
(function () {
  const OVERLAYS = [
    "settingsPage",
    "providerModalOverlay",
    "questionModal",
    "centerSearchModal",
  ];

  let dimmed = false;

  function update() {
    if (
      !window.electronAPI ||
      !window.electronAPI.window ||
      !window.electronAPI.window.setTitleBarDim
    ) {
      return;
    }
    const anyVisible = OVERLAYS.some((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains("hidden");
    });
    if (anyVisible !== dimmed) {
      dimmed = anyVisible;
      window.electronAPI.window.setTitleBarDim(anyVisible);
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
