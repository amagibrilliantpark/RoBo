const { ipcMain } = require("electron");
const log = require("./logger");

/** Register config, provider, agent, and tools IPC handlers. */
function registerProviderHandlers(instanceManager, sessionManager, project) {
  ipcMain.handle("config:get", async () => {
    const client = instanceManager.getClient(project.id);
    if (!client) throw new Error("Instance not running");
    return await client.getConfig();
  });

  ipcMain.handle("config:set", async (event, patch) => {
    const client = instanceManager.getClient(project.id);
    if (!client) throw new Error("Instance not running");
    // I1: allowlist — only provider.* keys, validate npm and baseURL
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid config patch');
    const allowedTop = new Set(['provider']);
    for (const k of Object.keys(patch)) {
      if (!allowedTop.has(k)) throw new Error('Config patch top-level key not allowed: ' + k);
    }
    if (patch.provider !== undefined) {
      if (patch.provider === null || typeof patch.provider !== 'object' || Array.isArray(patch.provider)) throw new Error('Invalid provider patch');
      for (const [pid, pval] of Object.entries(patch.provider)) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(pid)) throw new Error('Invalid provider id: ' + pid);
        if (pval === null) continue; // deletion
        if (typeof pval !== 'object' || Array.isArray(pval)) throw new Error('Invalid provider value for ' + pid);
        if (pval.npm !== undefined && (typeof pval.npm !== 'string' || !pval.npm.startsWith('@ai-sdk/'))) throw new Error('Invalid npm for ' + pid);
        if (pval.options !== undefined) {
          if (typeof pval.options !== 'object' || Array.isArray(pval.options)) throw new Error('Invalid options for ' + pid);
          if (pval.options.baseURL !== undefined) {
            try {
              const u = new URL(pval.options.baseURL);
              if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
            } catch { throw new Error('Invalid baseURL for ' + pid); }
          }
        }
      }
    }
    return await client.patchConfig(patch);
  });

  ipcMain.handle("provider:list", async () => {
    const client = instanceManager.getClient(project.id);
    if (!client) throw new Error("Instance not running");
    return await client.listProviders();
  });

  ipcMain.handle("provider:auth-methods", async () => {
    const client = instanceManager.getClient(project.id);
    if (!client) throw new Error("Instance not running");
    return await client.getProviderAuth();
  });

  ipcMain.handle("provider:connect", async (event, providerId, credentials) => {
    const client = instanceManager.getClient(project.id);
    if (!client) throw new Error("Instance not running");
    return await client.setAuth(providerId, credentials);
  });

  ipcMain.handle(
    "provider:oauth-authorize",
    async (event, providerId, method, inputs) => {
      const client = instanceManager.getClient(project.id);
      if (!client) throw new Error("Instance not running");
      return await client.oauthAuthorize(providerId, method, inputs);
    },
  );

  ipcMain.handle(
    "provider:oauth-callback",
    async (event, providerId, method, code) => {
      const client = instanceManager.getClient(project.id);
      if (!client) throw new Error("Instance not running");
      return await client.oauthCallback(providerId, method, code);
    },
  );

  ipcMain.handle("provider:delete", async (event, providerId) => {
    const client = instanceManager.getClient(project.id);
    if (!client) throw new Error("Instance not running");
    return await client.deleteAuth(providerId);
  });

  ipcMain.handle("agent:list", async () => {
    const client = instanceManager.getClient(project.id);
    if (!client) throw new Error("Instance not running");
    return await client.listAgents();
  });

  ipcMain.handle("tools:list", async () => {
    const client = instanceManager.getClient(project.id);
    if (!client) throw new Error("Instance not running");
    return await client.listTools();
  });
}

module.exports = { registerProviderHandlers };
