// Electron main process.
// Owns the application window and is the ONLY place that touches the data file
// on disk. The renderer asks it to load/save via the `window.planner` IPC bridge
// defined in preload.js. Writes are atomic (temp file + rename) with a single
// rolling .bak backup so a crash mid-write can never corrupt your data.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// Stable identity for Windows taskbar grouping + pinning (must match build.appId).
if (process.platform === 'win32') app.setAppUserModelId('com.dylan.protocol');

const DATA_FILE = 'planner-data.json';

function dataPath() {
  return path.join(app.getPath('userData'), DATA_FILE);
}
function backupPath() {
  return dataPath() + '.bak';
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#0c0d10',
    title: 'Protocol',
    frame: false,            // frameless — we draw our own title bar in the page
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Keep the custom maximize button's icon in sync with the real window state.
  const sendMax = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMax);
  mainWindow.on('unmaximize', sendMax);
}

// ---- Custom title-bar window controls --------------------------------------
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('window:is-maximized', () => (mainWindow ? mainWindow.isMaximized() : false));

// ---- Data persistence -------------------------------------------------------

async function readJsonFile(file) {
  const raw = await fsp.readFile(file, 'utf8');
  return JSON.parse(raw);
}

ipcMain.handle('data:load', async () => {
  const file = dataPath();
  try {
    return await readJsonFile(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null; // no data yet — first run
    // Primary file is unreadable/corrupt — try the backup before giving up.
    console.error('Primary data file unreadable:', err.message);
    try {
      return await readJsonFile(backupPath());
    } catch (bErr) {
      console.error('Backup also unreadable:', bErr.message);
      return { __loadError: true, message: String(err.message) };
    }
  }
});

ipcMain.handle('data:save', async (_evt, data) => {
  const file = dataPath();
  const tmp = file + '.tmp';
  try {
    const json = JSON.stringify(data, null, 2);
    // 1. write to a temp file
    await fsp.writeFile(tmp, json, 'utf8');
    // 2. roll the existing good file into .bak (best-effort)
    try {
      await fsp.copyFile(file, backupPath());
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Backup copy failed:', e.message);
    }
    // 3. atomically replace the real file
    await fsp.rename(tmp, file);
    return { ok: true, path: file };
  } catch (err) {
    console.error('Save failed:', err.message);
    return { error: String(err.message) };
  }
});

// Synchronous save — used on quit/unload to flush the last edit before exit.
ipcMain.on('data:save-sync', (evt, data) => {
  const file = dataPath();
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    try { fs.copyFileSync(file, backupPath()); } catch (e) { /* first run: no file yet */ }
    fs.renameSync(tmp, file);
    evt.returnValue = true;
  } catch (err) {
    console.error('Sync save failed:', err.message);
    evt.returnValue = false;
  }
});

ipcMain.handle('data:export', async (_evt, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export planner backup',
    defaultPath: 'planner-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { error: String(err.message) };
  }
});

ipcMain.handle('data:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import planner backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePaths || !filePaths.length) return null;
  try {
    const data = await readJsonFile(filePaths[0]);
    return data;
  } catch (err) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      message: 'Could not import that file',
      detail: String(err.message)
    });
    return null;
  }
});

ipcMain.handle('data:reveal', async () => {
  const file = dataPath();
  try {
    // Ensure the file exists so Explorer has something to select.
    await fsp.access(file).catch(async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, '{}', 'utf8');
    });
    shell.showItemInFolder(file);
    return { ok: true };
  } catch (err) {
    return { error: String(err.message) };
  }
});

ipcMain.handle('data:path', async () => dataPath());

// ---- Menu (keeps standard copy/paste/reload shortcuts working) --------------

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- App lifecycle ----------------------------------------------------------

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
