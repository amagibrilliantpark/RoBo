/** Disable all native browser tooltips (title attribute) across the app.
 *  RoBo has many `title="..."` attributes (sidebar, chain cards, provider toggles, etc.)
 *  that show the OS-native small tooltip on hover. User requested to hide all of them.
 *  This script removes existing titles and intercepts future ones via
 *  MutationObserver + prototype override, storing the original value in
 *  `data-native-title` for potential custom tooltip use later without ever
 *  exposing the native tooltip.
 */
(function () {
  const STORE = 'data-native-title';

  function stripTitle(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.hasAttribute('title')) {
      const v = el.getAttribute('title');
      // keep non-empty for debugging / future custom tooltip
      if (v) {
        try { el.setAttribute(STORE, v); } catch {}
      }
      el.removeAttribute('title');
    }
    // Also clear the DOM property if set via el.title = "..."
    try {
      if (el.title) el.title = '';
    } catch {}
  }

  function sweep(root) {
    const nodes = root.querySelectorAll ? root.querySelectorAll('[title]') : [];
    for (let i = 0; i < nodes.length; i++) stripTitle(nodes[i]);
    // Also handle elements where title was set via property but not attribute (rare)
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.title) stripTitle(el);
    }
  }

  // Intercept setAttribute('title', ...) globally
  const origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === 'title') {
      if (value) {
        try { origSetAttr.call(this, STORE, String(value)); } catch {}
      }
      // never actually set title — keep native tooltip hidden
      return;
    }
    return origSetAttr.call(this, name, value);
  };

  // Intercept el.title = "..." setter
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'title');
    if (desc && desc.set) {
      Object.defineProperty(HTMLElement.prototype, 'title', {
        get: desc.get,
        set: function (v) {
          if (v) {
            try { this.setAttribute(STORE, String(v)); } catch {}
          }
          // call original setter with empty to ensure attribute stays removed
          try { desc.set.call(this, ''); } catch {}
          // ensure attribute is gone
          try { this.removeAttribute('title'); } catch {}
        },
        configurable: true,
        enumerable: desc.enumerable
      });
    }
  } catch {}

  // Initial sweep
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { sweep(document); });
  } else {
    sweep(document);
  }

  // Watch for future titles (JS-created chain cards, provider rows, etc.)
  const obs = new MutationObserver(function (muts) {
    for (let i = 0; i < muts.length; i++) {
      const m = muts[i];
      if (m.type === 'attributes' && m.attributeName === 'title') {
        stripTitle(m.target);
      }
      if (m.type === 'childList') {
        for (let j = 0; j < m.addedNodes.length; j++) {
          const n = m.addedNodes[j];
          if (!n || n.nodeType !== 1) continue;
          if (n.hasAttribute && n.hasAttribute('title')) stripTitle(n);
          sweep(n);
        }
      }
    }
  });

  function startObs() {
    try {
      obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['title'],
        childList: true,
        subtree: true
      });
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObs);
  } else {
    startObs();
  }

  // Also sweep periodically as a safety net for direct property sets that bypass setAttribute
  setInterval(function () { sweep(document); }, 1500);

  // Hide the stuck "ileri/geri sarma kaydırma çubuğu" fixed tooltip at bottom left (reported)
  setInterval(function () {
    try {
      const all = document.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        const txt = (el.textContent || '').trim();
        if (txt === 'ileri/geri sarma kaydırma çubuğu' || (txt.length < 80 && txt.includes('kaydırma çubuğu'))) {
          const st = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const isFixedBottomLeft = st.position === 'fixed' && rect.bottom > window.innerHeight - 100 && rect.left < 120;
          const isSmallTooltip = rect.width < 300 && rect.height < 40;
          if (isFixedBottomLeft || isSmallTooltip || el.getAttribute('role') === 'tooltip') {
            el.style.display = 'none';
            el.style.pointerEvents = 'none';
            el.style.opacity = '0';
            el.remove();
          }
        }
        const at = el.getAttribute && (el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('data-native-title') || '');
        if (at && at.includes('kaydırma çubuğu')) {
          try { el.removeAttribute('title'); } catch {}
          try { el.removeAttribute('aria-label'); } catch {}
          el.style.display = 'none';
        }
      }
      // Also hide any WebKit scrollbar tooltip pseudo - force hide via style
      const tip = document.querySelector('[role="tooltip"]');
      if (tip && tip.textContent && tip.textContent.includes('kaydırma')) tip.style.display = 'none';
    } catch {}
  }, 800);
})();
