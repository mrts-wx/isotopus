const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { buildM3u } = require('../services/playlist');

function registerPlaylistController({ ipcMain, dialog, getWindow, resolveTrackPath }) {
  ipcMain.handle('playlist:export', async (_event, ids) => {
    if (!Array.isArray(ids) || ids.length > 100000) return { ok: false, error: 'Fila inválida.' };
    const seen = new Set();
    const tracks = [];
    for (const item of ids) {
      if (!item || typeof item.id !== 'string' || !/^[a-f0-9]{24}$/.test(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      const file = resolveTrackPath(item.id);
      if (!file || !fsSync.existsSync(file)) continue;
      tracks.push({ path: file, title: String(item.title || '').slice(0, 1000), artist: String(item.artist || '').slice(0, 1000), duration: Number(item.duration) || 0 });
    }
    if (!tracks.length) return { ok: false, error: 'Nenhuma faixa da fila está disponível.' };
    const result = await dialog.showSaveDialog(getWindow(), { title: 'Exportar fila de reprodução', defaultPath: 'Isotopus.m3u8', filters: [{ name: 'Playlist M3U8', extensions: ['m3u8'] }] });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await fs.writeFile(result.filePath, buildM3u(tracks), { encoding: 'utf8', mode: 0o600 });
    return { ok: true, count: tracks.length, path: result.filePath };
  });
}

module.exports = { registerPlaylistController };
