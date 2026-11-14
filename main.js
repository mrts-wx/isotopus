const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createStaticServer } = require('./server');
const { createLibrary } = require('./library');
const { buildM3u } = require('./playlist');

let server;
let serverPort;
let win;
let settings = { folders: [] };
let scanTimer;
const watchers = [];
let library;
let lyricsRequestAt = 0;
let lyricsRetryAt = 0;

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
async function loadSettings() {
  try {
    const stored = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    settings.folders = Array.isArray(stored.folders) ? stored.folders.filter(folder => typeof folder === 'string') : [];
  } catch { settings.folders = []; }
}
async function saveSettings() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify({ folders: settings.folders }, null, 2), { mode: 0o600 });
}
function serveApp() {
  server = createStaticServer(__dirname, id => library.resolveAsset(id));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    serverPort = server.address().port;
    resolve(serverPort);
  }));
}
function createWindow(port) {
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
  const minWidth = Math.min(1040, workWidth), minHeight = Math.min(700, workHeight);
  win = new BrowserWindow({
    width: Math.min(1600, Math.max(minWidth, Math.floor(workWidth * .96))),
    height: Math.min(1000, Math.max(minHeight, Math.floor(workHeight * .92))),
    minWidth, minHeight,
    backgroundColor: '#eddbc4', title: 'Isótopus',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true }
  });
  win.loadURL(`http://127.0.0.1:${port}`);
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    let parsed;
    try { parsed = new URL(url); } catch { return { action: 'deny' }; }
    if (parsed.protocol === 'https:') shell.openExternal(parsed.href);
    return { action: 'deny' };
  });
}
async function scanLibrary() {
  const tracks = await library.scan(settings.folders, `http://127.0.0.1:${serverPort}`);
  if (win && !win.isDestroyed()) win.webContents.send('library:updated', { tracks, folders: settings.folders });
  return tracks;
}
function watchFolders() {
  while (watchers.length) watchers.pop().close();
  const roots = settings.folders.filter(folder => fsSync.existsSync(folder));
  if (!roots.length) return;
  for (const root of roots) {
    const changed = () => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => scanLibrary().catch(() => {}), 1200);
    };
    let current;
    try { current = fsSync.watch(root, { recursive: true }, changed); }
    catch { current = fsSync.watch(root, changed); }
    current.on('error', () => current.close());
    current.unref?.();
    watchers.push(current);
  }
}

ipcMain.handle('library:get', async () => ({ tracks: await scanLibrary(), folders: settings.folders }));
ipcMain.handle('library:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Escolha uma pasta de músicas', properties: ['openDirectory', 'multiSelections'] });
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
ipcMain.handle('library:rescan', async () => ({ tracks: await scanLibrary(), folders: settings.folders }));
ipcMain.handle('library:mediaUrl', (_event, id) => {
  const asset = library.resolveAsset(id);
  if (!asset?.path) return '';
  return `http://127.0.0.1:${serverPort}/media/${encodeURIComponent(id)}`;
});
ipcMain.handle('playlist:export', async (_event, ids) => {
  if (!Array.isArray(ids) || ids.length > 100000) return { ok: false, error: 'Fila inválida.' };
  const seen = new Set();
  const tracks = [];
  for (const item of ids) {
    if (!item || typeof item.id !== 'string' || !/^[a-f0-9]{24}$/.test(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const file = library.resolveTrackPath(item.id);
    if (!file || !fsSync.existsSync(file)) continue;
    tracks.push({ path: file, title: String(item.title || '').slice(0, 1000), artist: String(item.artist || '').slice(0, 1000), duration: Number(item.duration) || 0 });
  }
  if (!tracks.length) return { ok: false, error: 'Nenhuma faixa da fila está disponível.' };
  const result = await dialog.showSaveDialog(win, { title: 'Exportar fila de reprodução', defaultPath: 'Isotopus.m3u8', filters: [{ name: 'Playlist M3U8', extensions: ['m3u8'] }] });
  if (result.canceled || !result.filePath) return { cancelled: true };
  await fs.writeFile(result.filePath, buildM3u(tracks), { encoding: 'utf8', mode: 0o600 });
  return { ok: true, count: tracks.length, path: result.filePath };
});
ipcMain.handle('lyrics:local', async (_event, id) => {
  if (typeof id !== 'string') return { content: '' };
  const audioPath = library.resolveTrackPath(id);
  if (!audioPath) return { content: '' };
  const lyricPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, path.extname(audioPath))}.lrc`);
  try { return { content: await fs.readFile(lyricPath, 'utf8'), path: lyricPath }; }
  catch { return { content: '' }; }
});
ipcMain.handle('lyrics:openFile', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Abrir letra', properties: ['openFile'], filters: [{ name: 'Letras', extensions: ['lrc', 'txt'] }] });
  if (result.canceled || !result.filePaths.length) return { cancelled: true };
  const stat = await fs.stat(result.filePaths[0]);
  if (stat.size > 1024 * 1024) return { error: 'O arquivo de letra passa de 1 MB.' };
  const content = await fs.readFile(result.filePaths[0], 'utf8');
  return { content, path: result.filePaths[0] };
});
ipcMain.handle('lyrics:save', async (_event, { id, content }) => {
  if (typeof id !== 'string' || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 1024 * 1024) return { ok: false, error: 'Letra inválida.' };
  const audioPath = library.resolveTrackPath(id);
  if (!audioPath) return { ok: false, error: 'A faixa não está mais na biblioteca.' };
  const defaultPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, path.extname(audioPath))}.lrc`);
  const result = await dialog.showSaveDialog(win, { title: 'Salvar letra sincronizada', defaultPath, filters: [{ name: 'Letra LRC', extensions: ['lrc'] }] });
  if (result.canceled || !result.filePath) return { cancelled: true };
  const file = path.extname(result.filePath) ? result.filePath : `${result.filePath}.lrc`;
  await fs.writeFile(file, content, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, path: file };
});
ipcMain.handle('lyrics:search', async (_event, track) => {
  if (!track || typeof track.title !== 'string' || typeof track.artist !== 'string') return { ok: false, error: 'Metadados da faixa inválidos.' };
  const now = Date.now();
  if (now < lyricsRetryAt) return { ok: false, error: 'Aguarde alguns segundos antes de buscar outra letra.' };
  const delay = Math.max(0, 300 - (now - lyricsRequestAt));
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  lyricsRequestAt = Date.now();
  const params = new URLSearchParams({ track_name: track.title.slice(0, 256), artist_name: track.artist.slice(0, 256) });
  if (track.album) params.set('album_name', String(track.album).slice(0, 256));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`https://lrclib.net/api/search?${params}`, {
      headers: { 'User-Agent': 'Isotopus/0.1.3 (https://github.com/)', 'Accept': 'application/json' }, signal: controller.signal
    });
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const seconds = Number(retryAfter);
      lyricsRetryAt = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : retryAfter ? (Date.parse(retryAfter) || Date.now() + 5000) : Date.now() + 5000;
      return { ok: false, error: 'Muitas buscas em sequência. Tente novamente em alguns segundos.' };
    }
    if (!response.ok) return { ok: false, error: `Serviço de letras indisponível (${response.status}).` };
    const records = await response.json();
    if (!Array.isArray(records)) return { ok: false, error: 'Resposta inesperada do serviço de letras.' };
    const duration = Number(track.duration) || 0;
    records.sort((a, b) => Math.abs((Number(a.duration) || 0) - duration) - Math.abs((Number(b.duration) || 0) - duration));
    return { ok: true, records: records.slice(0, 12).map(record => ({
      title: String(record.trackName || record.name || '').slice(0, 256), artist: String(record.artistName || '').slice(0, 256),
      album: String(record.albumName || '').slice(0, 256), duration: Number(record.duration) || 0,
      plainLyrics: String(record.plainLyrics || '').slice(0, 100000), syncedLyrics: String(record.syncedLyrics || '').slice(0, 100000),
      instrumental: Boolean(record.instrumental)
    })) };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? 'A busca de letras demorou demais.' : 'Não consegui acessar o serviço de letras.' };
  } finally { clearTimeout(timeout); }
});
ipcMain.handle('lyrics:webSearch', async (_event, track) => {
  if (!track || typeof track.title !== 'string') return { ok: false, error: 'Faixa inválida.' };
  const query = [track.title, track.artist, 'letra'].filter(value => typeof value === 'string' && value.trim()).join(' ');
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query.slice(0, 600));
  try { await shell.openExternal(url.href); return { ok: true }; }
  catch { return { ok: false, error: 'Não consegui abrir o navegador.' }; }
});

app.whenReady().then(async () => {
  await loadSettings();
  library = createLibrary(path.join(app.getPath('userData'), 'library-cache'));
  const port = await serveApp();
  createWindow(port);
  watchFolders();
  scanLibrary().catch(error => console.error('Library scan failed:', error));
});
app.on('window-all-closed', async () => {
  clearTimeout(scanTimer);
  while (watchers.length) watchers.pop().close();
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});
