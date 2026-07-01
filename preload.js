// Preload script — runs in an isolated context with access to a limited set of
// Electron APIs. It exposes a small, explicit `window.planner` bridge to the
// renderer. No Node.js internals are leaked to the page (contextIsolation + no
// nodeIntegration), so this is the only surface the UI can use to touch disk.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('planner', {
  // Load the saved data object (or null if there is no file yet).
  load: () => ipcRenderer.invoke('data:load'),
  // Persist the full data object. Returns { ok, path } or { error }.
  save: (data) => ipcRenderer.invoke('data:save', data),
  // Synchronous save (used on quit to flush the last edit). Returns true/false.
  saveSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  // Export a copy of the current data to a user-chosen location.
  exportBackup: (data) => ipcRenderer.invoke('data:export', data),
  // Open a file picker and return the parsed contents (or null if cancelled).
  importBackup: () => ipcRenderer.invoke('data:import'),
  // Reveal the data file in Windows Explorer.
  openDataFolder: () => ipcRenderer.invoke('data:reveal'),
  // Absolute path of the data file (for display).
  dataPath: () => ipcRenderer.invoke('data:path')
});

// Custom title-bar window controls (only present in the desktop app).
contextBridge.exposeInMainWorld('win', {
  // Platform tag so the renderer can adapt chrome (e.g. hide the Windows-only
  // custom window buttons on macOS, where native traffic lights are used).
  platform: process.platform,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizeChange: (cb) => ipcRenderer.on('window:maximized', (_e, val) => cb(val))
});
