const { app, BrowserWindow, ipcMain, shell, dialog, screen, Tray, Menu, nativeImage, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createStaticServer } = require('./services/server');
const { createLibraryController } = require('./controllers/library-controller');
const { registerPlaylistController } = require('./controllers/playlist-controller');
const { registerLyricsController } = require('./controllers/lyrics-controller');

const singleInstanceLock = app.requestSingleInstanceLock();
let pendingSecondInstanceFocus = false;

let server;
let serverPort;
let win;
let tray;
let isQuitting = false;
let settings = { folders: [], store: {} };
let settingsSaveQueue = Promise.resolve();
let settingsSaveTimer;
let settingsDirty = false;
let libraryController;

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
async function loadSettings() {
  try {
    const stored = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    settings.folders = Array.isArray(stored.folders) ? stored.folders.filter(folder => typeof folder === 'string') : [];
    settings.store = stored.store && typeof stored.store === 'object' && !Array.isArray(stored.store) ? stored.store : {};
  } catch { settings.folders = []; }
}
async function saveSettings() {
  settingsSaveQueue = settingsSaveQueue.catch(() => {}).then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    const file = settingsPath(); const temp = `${file}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ folders: settings.folders, store: settings.store }, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
    settingsDirty = false;
  });
  return settingsSaveQueue;
}
function scheduleSettingsSave() {
  settingsDirty = true; clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => { settingsSaveTimer = null; saveSettings().catch(error => console.error('Could not save settings:', error)); }, 180);
  settingsSaveTimer.unref?.();
}
function showWindow() { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.moveTop(); } }
function syncTray() {
  const enabled = settings.store?.minimizeToTray === 'yes';
  if (enabled && !tray) {
    const iconPath = path.join(__dirname, '../assets/icons/32x32.png');
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (image.isEmpty()) throw new Error('Tray icon could not be loaded');
      tray = new Tray(image);
      tray.setToolTip('Isótopus');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Mostrar Isótopus', click: showWindow },
        { type: 'separator' },
        { label: 'Sair', click: () => { isQuitting = true; app.quit(); } }
      ]));
      tray.on('click', showWindow);
    } catch (error) {
      console.error('System tray is unavailable:', error);
      tray = null; delete settings.store.minimizeToTray;
      saveSettings().catch(() => {});
      return false;
    }
  } else if (!enabled && tray) { tray.destroy(); tray = null; }
  return !enabled || Boolean(tray);
}
function serveApp() {
  server = createStaticServer(path.join(__dirname, '..'), id => libraryController.resolveAsset(id));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    serverPort = server.address().port;
    resolve(serverPort);
  }));
}
function createWindow(port) {
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
  const minWidth = Math.min(760, workWidth), minHeight = Math.min(560, workHeight);
  win = new BrowserWindow({
    width: Math.min(1600, Math.max(minWidth, Math.floor(workWidth * .96))),
    height: Math.min(1000, Math.max(minHeight, Math.floor(workHeight * .92))),
    minWidth, minHeight,
    backgroundColor: '#202629', title: 'Isótopus',
    // Keep audio events, Media Session updates, and crossfade timing active while minimized.
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  win.loadURL(`http://127.0.0.1:${port}/renderer/index.html`);
  win.setMenuBarVisibility(false);
  win.on('close', event => {
    if (!isQuitting && tray && settings.store?.minimizeToTray === 'yes') { event.preventDefault(); win.hide(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    let parsed;
    try { parsed = new URL(url); } catch { return { action: 'deny' }; }
    if (parsed.protocol === 'https:') shell.openExternal(parsed.href);
    return { action: 'deny' };
  });
}
ipcMain.handle('window:setZoomFactor', (event, factor) => {
  const zoom = Number(factor);
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 1.75 || event.sender !== win?.webContents) return false;
  win.webContents.setZoomFactor(zoom);
  return true;
});
ipcMain.on('store:get', event => { event.returnValue = settings.store; });
ipcMain.on('store:set', (event, { key, value }) => {
  if (typeof key !== 'string' || !/^[\w:.-]{1,120}$/.test(key) || typeof value !== 'string' || value.length > 1024 * 1024) return;
  if (value) settings.store[key] = value; else delete settings.store[key];
  if (key === 'minimizeToTray' && !syncTray()) event.sender.send('tray:unavailable');
  scheduleSettingsSave();
});
if (singleInstanceLock) {
  app.on('second-instance', () => {
    pendingSecondInstanceFocus = true;
    if (win && !win.isDestroyed()) showWindow();
  });
  app.whenReady().then(async () => {
    await loadSettings();
    syncTray();
    const port = await serveApp();
    libraryController = createLibraryController({ app, ipcMain, dialog, settings, saveSettings, getWindow: () => win, getServerOrigin: () => `http://127.0.0.1:${serverPort}` });
    registerPlaylistController({ ipcMain, dialog, getWindow: () => win, resolveTrackPath: id => libraryController.resolveTrackPath(id) });
    registerLyricsController({ app, ipcMain, shell, dialog, utilityProcess, getWindow: () => win, resolveTrackPath: id => libraryController.resolveTrackPath(id) });
    createWindow(port);
    if (pendingSecondInstanceFocus) showWindow();
    libraryController.watchFolders();
    libraryController.scanLibrary().catch(error => console.error('Library scan failed:', error));
  });
  app.on('window-all-closed', async () => {
    libraryController?.dispose();
    if (server) server.close();
    if (process.platform !== 'darwin') app.quit();
  });
  let quitAfterSettingsSave = false;
  app.on('before-quit', event => {
    isQuitting = true;
    if ((settingsDirty || settingsSaveTimer) && !quitAfterSettingsSave) {
      event.preventDefault(); quitAfterSettingsSave = true; clearTimeout(settingsSaveTimer); settingsSaveTimer = null;
      saveSettings().finally(() => app.quit());
    }
  });
  app.on('activate', showWindow);
} else {
  app.quit();
}
