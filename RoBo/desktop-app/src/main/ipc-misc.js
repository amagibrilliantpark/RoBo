const { ipcMain, shell } = require("electron");
const log = require("./logger");

let currentTheme = "light";

/** Register logging, external-open, and theme IPC handlers. */
function registerMiscHandlers(instanceManager, sessionManager, project) {
  // Renderer-side logging
  ipcMain.handle("log:write", (event, level, category, message) => {
    const lvl = ["info", "warn", "error"].includes(level) ? level : "info";
    log[lvl](category, message);
  });

  ipcMain.handle("open:external", async (event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle("window:set-theme", (event, theme) => {
    currentTheme = theme === "dark" ? "dark" : "light";
    const mainWindow = require("./window").getMainWindow();
    if (mainWindow) {
      mainWindow.setBackgroundColor(currentTheme === "dark" ? "#0f1923" : "#f5f7fa");
      if (mainWindow.setTitleBarOverlay) {
        mainWindow.setTitleBarOverlay({
          color: currentTheme === "dark" ? "#0f1923" : "#f5f7fa",
          symbolColor: currentTheme === "dark" ? "#ffffff" : "#18283a",
          height: 22,
        });
      }
    }
  });

  // Dim the native title bar overlay while a full-screen modal is open, so it
  // blends with the modal's dimmed backdrop instead of staying bright.
  // Supports double-dim when two overlays stack (e.g. settings + providerAdd).
  ipcMain.handle("window:titlebar-dim", (event, dim) => {
    const mainWindow = require("./window").getMainWindow();
    if (!mainWindow || !mainWindow.setTitleBarOverlay) return;
    const dark = currentTheme === "dark";
    // dim can be boolean (legacy) or number of visible overlays
    const level = typeof dim === "number" ? dim : dim ? 1 : 0;
    let color;
    if (level === 0) color = dark ? "#0f1923" : "#f5f7fa";
    else if (level === 1) color = dark ? "#0b1119" : "#aab0b6";
    else color = dark ? "#080d13" : "#93999f"; // double dim: settings (0.30) + providerAdd (0.18) ≈ 0.43
    mainWindow.setTitleBarOverlay({
      color,
      symbolColor: dark ? "#ffffff" : "#18283a",
      height: 22,
    });
  });
}

module.exports = { registerMiscHandlers };
