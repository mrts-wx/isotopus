const { app, BrowserWindow, ipcMain, shell, dialog, screen, Tray, Menu, nativeImage, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createStaticServer } = require('./services/server');
const { createLibraryController } = require('./controllers/library-controller');
const { registerPlaylistController } = require('./controllers/playlist-controller');
const { registerLyricsController } = require('./controllers/lyrics-controller');
const { registerDownloadController } = require('./controllers/download-controller');

const singleInstanceLock = app.requestSingleInstanceLock();
let pendingSecondInstanceFocus = false;

let server;
let serverPort;
let win;
let miniPlayerWindow;
let tray;
let isQuitting = false;
let settings = { folders: [], store: {} };
let settingsSaveQueue = Promise.resolve();
let settingsSaveTimer;
let settingsDirty = false;
let libraryController;
let downloadController;

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
function updateMainBackgroundThrottling() {
  if (!win || win.isDestroyed()) return;
  // Keep crossfade timing exact while hidden only when the user enabled it.
  const crossfadeNeedsTimers = Number(settings.store?.crossfade) > 0;
  win.webContents.setBackgroundThrottling(!win.isVisible() && !crossfadeNeedsTimers);
}
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
  win.on('hide', updateMainBackgroundThrottling);
  win.on('show', updateMainBackgroundThrottling);
  win.on('minimize', updateMainBackgroundThrottling);
  win.on('restore', updateMainBackgroundThrottling);
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
function openMiniPlayerWindow() {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) { miniPlayerWindow.show(); miniPlayerWindow.focus(); return; }
  miniPlayerWindow = new BrowserWindow({ width: 430, height: 148, minWidth: 380, minHeight: 90, maxWidth: 560, maxHeight: 210, frame: false, transparent: true, resizable: true, alwaysOnTop: false, show: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true } });
  miniPlayerWindow.loadURL(`http://127.0.0.1:${serverPort}/renderer/mini-player.html`);
  miniPlayerWindow.once('ready-to-show', () => { miniPlayerWindow?.show(); win?.webContents.send('mini-player:request-state'); });
  miniPlayerWindow.on('closed', () => { miniPlayerWindow = null; });
  miniPlayerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
ipcMain.handle('mini-player:open', event => { if (event.sender !== win?.webContents) return false; openMiniPlayerWindow(); return true; });
ipcMain.on('mini-player:state', (event, state) => {
  if (event.sender !== win?.webContents || !miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
  miniPlayerWindow.webContents.send('mini-player:state', state);
});
ipcMain.on('mini-player:request-state', event => { if (event.sender === miniPlayerWindow?.webContents) win?.webContents.send('mini-player:request-state'); });
ipcMain.on('mini-player:compact', (event, compact) => {
  if (event.sender !== miniPlayerWindow?.webContents || !miniPlayerWindow || miniPlayerWindow.isDestroyed() || typeof compact !== 'boolean') return;
  const [width] = miniPlayerWindow.getSize();
  miniPlayerWindow.setSize(width, compact ? 90 : 148, true);
});
ipcMain.on('mini-player:command', (event, command) => {
  if (event.sender !== miniPlayerWindow?.webContents || win?.isDestroyed()) return;
  const allowed = new Set(['playPause', 'next', 'previous', 'seek', 'volume']);
  if (!command || !allowed.has(command.type)) return;
  if (command.type === 'volume' && (!Number.isFinite(command.value) || command.value < 0 || command.value > 100)) return;
  if (command.type === 'seek' && (!Number.isFinite(command.value) || command.value < 0 || command.value > 86400)) return;
  win.webContents.send('mini-player:command', command);
});
ipcMain.on('mini-player:always-on-top', (event, enabled) => {
  if (event.sender !== miniPlayerWindow?.webContents || !miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
  miniPlayerWindow.setAlwaysOnTop(Boolean(enabled));
});
ipcMain.on('mini-player:close', event => { if (event.sender === miniPlayerWindow?.webContents) miniPlayerWindow?.hide(); });
ipcMain.handle('window:setZoomFactor', (event, factor) => {
  const zoom = Number(factor);
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 1.75 || event.sender !== win?.webContents) return false;
  win.webContents.setZoomFactor(zoom);
  return true;
});
ipcMain.handle('shell:openExternal', async (_event, rawUrl) => {
  try { const url = new URL(String(rawUrl)); if (url.protocol !== 'https:') return false; await shell.openExternal(url.href); return true; } catch { return false; }
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
    downloadController = registerDownloadController({ app, ipcMain, getWindow: () => win, getSettings: () => settings, saveSettings });
    createWindow(port);
    if (pendingSecondInstanceFocus) showWindow();
    libraryController.watchFolders();
    libraryController.scanLibrary().catch(error => console.error('Library scan failed:', error));
  });
  app.on('window-all-closed', async () => {
    libraryController?.dispose();
    downloadController?.dispose();
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
