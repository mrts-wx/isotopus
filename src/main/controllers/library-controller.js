const fsSync = require('node:fs');
const path = require('node:path');
const { createLibrary } = require('../services/library');

function createLibraryController({ app, ipcMain, dialog, settings, saveSettings, getWindow, getServerOrigin }) {
  const library = createLibrary(path.join(app.getPath('userData'), 'library-cache'));
  const watchers = [];
  let scanTimer;
  let scanInFlight = null;

  async function scanLibrary() {
    if (scanInFlight) return scanInFlight;
    scanInFlight = (async () => {
      const folders = [...settings.folders];
      const tracks = await library.scan(folders, getServerOrigin());
      const window = getWindow();
      if (window && !window.isDestroyed()) window.webContents.send('library:updated', { tracks, folders });
      return tracks;
    })();
    try { return await scanInFlight; }
    finally { scanInFlight = null; }
  }

  function watchFolders() {
    while (watchers.length) watchers.pop().close();
    const roots = settings.folders.filter(folder => fsSync.existsSync(folder));
    for (const root of roots) {
      const changed = () => {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => scanLibrary().catch(() => {}), 1200);
      };
      let watcher;
      try { watcher = fsSync.watch(root, { recursive: true }, changed); }
      catch { watcher = fsSync.watch(root, changed); }
      watcher.on('error', () => watcher.close());
      watcher.unref?.();
      watchers.push(watcher);
    }
  }

  ipcMain.handle('library:get', async () => ({ tracks: await scanLibrary(), folders: settings.folders }));
  ipcMain.handle('library:chooseFolder', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: 'Escolha uma pasta de músicas', properties: ['openDirectory', 'multiSelections'] });
    if (result.canceled || !result.filePaths.length) return { cancelled: true, folders: settings.folders };
    settings.folders = [...new Set([...settings.folders, ...result.filePaths])];
    await saveSettings(); watchFolders();
    return { tracks: await scanLibrary(), folders: settings.folders };
  });
  ipcMain.handle('library:removeFolder', async (_event, folder) => {
    settings.folders = settings.folders.filter(item => item !== folder);
    await saveSettings(); watchFolders();
    return { tracks: await scanLibrary(), folders: settings.folders };
  });
  ipcMain.handle('library:deleteTrack', async (_event, id) => {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return { ok: false, error: 'Faixa inválida.' };
    const indexedPath = library.resolveTrackPath(id);
    if (!indexedPath) return { ok: false, error: 'A faixa não está mais na biblioteca.' };
    try {
      const file = await fsSync.promises.realpath(indexedPath);
      const roots = await Promise.all(settings.folders.map(folder => fsSync.promises.realpath(folder).catch(() => '')));
      const allowed = roots.some(root => { if (!root) return false; const relative = path.relative(root, file); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); });
      if (!allowed || !fsSync.existsSync(file) || !fsSync.statSync(file).isFile()) return { ok: false, error: 'O arquivo não pertence a uma pasta monitorada.' };
      await fsSync.promises.unlink(file);
      return { ok: true, tracks: await scanLibrary(), folders: settings.folders };
    } catch (error) { return { ok: false, error: `Não foi possível excluir o arquivo: ${String(error.message || error).slice(0, 180)}` }; }
  });
  ipcMain.handle('library:rescan', async () => ({ tracks: await scanLibrary(), folders: settings.folders }));
  ipcMain.handle('library:mediaUrl', (_event, id) => {
    const asset = library.resolveAsset(id);
    if (!asset?.path) return '';
    return `${getServerOrigin()}/media/${encodeURIComponent(id)}`;
  });

  function dispose() {
    clearTimeout(scanTimer);
    while (watchers.length) watchers.pop().close();
  }

  return { scanLibrary, watchFolders, resolveAsset: id => library.resolveAsset(id), resolveTrackPath: id => library.resolveTrackPath(id), dispose };
}

module.exports = { createLibraryController };
