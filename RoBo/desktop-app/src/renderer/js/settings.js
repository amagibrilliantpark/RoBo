/** Settings page and theme switching UI. */
window.Settings = {
  init() {
    // ── Settings page ──
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPage = document.getElementById('settingsPage');
    const settingsClose = document.getElementById('settingsClose');

    settingsBtn.addEventListener('click', () => {
      settingsPage.classList.remove('hidden');
      fitSettingsModalToSendButton();
      document.querySelector('.settings-section-title[data-target="generalCard"]').click();
    });

    // Size the settings modal so its bottom aligns with the vertical middle of
    // the prompt send button (the modal should stop there, not fill the screen).
    function fitSettingsModalToSendButton() {
      const modal = document.querySelector('.settings-modal');
      if (!modal) return;
      const send = document.querySelector('.btn-send');
      if (!send) {
        modal.style.height = 'calc(100vh - 60px)';
        return;
      }
      const top = 54; // matches .settings-page padding-top
      const centerY = send.getBoundingClientRect().top + send.offsetHeight / 2;
      modal.style.height = Math.max(320, centerY - top) + 'px';
    }

    settingsClose.addEventListener('click', () => {
      settingsPage.classList.add('hidden');
    });

    // Toggle cards on section title click
    document.querySelectorAll('.settings-section-title').forEach(title => {
      title.addEventListener('click', () => {
        const targetId = title.dataset.target;
        const contentMap = {
          'generalCard': 'generalContent',
          'aboutCard': 'aboutContent'
        };
        const targetContentId = contentMap[targetId];
        const targetContent = document.getElementById(targetContentId);
        if (targetContent) {
          document.querySelectorAll('.settings-section-title').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.settings-right-content').forEach(c => c.classList.add('hidden'));
          targetContent.classList.remove('hidden');
          title.classList.add('active');
        }
      });
    });

    // ── Theme: dark mode is hidden from users for now; always light ──
    document.body.setAttribute('data-theme', 'light');
    localStorage.setItem('robo_theme', 'light');
    if (window.electronAPI?.window?.setTheme) {
      window.electronAPI.window.setTheme('light');
    }

    // Feedback button
    document.getElementById('feedbackBtn').addEventListener('click', () => {
      window.electronAPI.openExternal('https://docs.google.com/forms/d/e/1FAIpQLSfbJnE-m8jSKKqtSXtSyqwJMCpyQPjrsmFSjh86aKSNf1rlTw/viewform?usp=header');
    });

    // Close settings on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !settingsPage.classList.contains('hidden')) {
        settingsPage.classList.add('hidden');
      }
    });
  }
};
