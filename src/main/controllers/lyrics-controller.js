const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { formatLyrics } = require('../../shared/lyrics');

function registerLyricsController({ app, ipcMain, shell, dialog, utilityProcess, getWindow, resolveTrackPath }) {
  let requestAt = 0, retryAt = 0, searchQueue = Promise.resolve(), alignmentWorker = null;
  const searchCache = new Map();
  const validTrackId = id => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);
  const lyricsStatePath = id => path.join(app.getPath('userData'), 'lyrics', `${id}.json`);

  async function persistBackgroundLyrics(id, inputLines, result) {
    if (!result?.ok || !validTrackId(id)) return;
    try {
      const file = lyricsStatePath(id), state = JSON.parse(await fs.readFile(file, 'utf8'));
      if (state.synced || !Array.isArray(state.lines) || state.lines.length !== inputLines.length || !state.lines.every((line, index) => line?.text === inputLines[index])) return;
      const lines = result.lines.map(line => ({ text: line.text, time: line.time }));
      const updated = JSON.stringify({ raw: formatLyrics(lines), synced: true, lines, offset: Math.max(-10, Math.min(10, Number(state.offset) || 0)) });
      await fs.writeFile(`${file}.tmp`, updated, { mode: 0o600 }); await fs.rename(`${file}.tmp`, file);
    } catch (error) { console.error('Could not persist background lyric alignment:', error); }
  }

  ipcMain.handle('lyrics:state:get', async (_event, id) => {
    if (!validTrackId(id)) return null;
    try { const raw = await fs.readFile(lyricsStatePath(id), 'utf8'); return Buffer.byteLength(raw, 'utf8') <= 1024 * 1024 ? JSON.parse(raw) : null; } catch { return null; }
  });
  ipcMain.handle('lyrics:state:set', async (_event, { id, state }) => {
    if (!validTrackId(id) || !state || typeof state.raw !== 'string' || Buffer.byteLength(state.raw, 'utf8') > 800000 || !Array.isArray(state.lines) || state.lines.length > 5000) return { ok: false };
    const lines = [];
    for (const line of state.lines) {
      if (!line || typeof line.text !== 'string' || line.text.length > 10000 || !(line.time == null || (Number.isFinite(line.time) && line.time >= 0 && line.time <= 86400))) return { ok: false };
      lines.push({ text: line.text, time: line.time == null ? null : line.time });
    }
    const data = JSON.stringify({ raw: state.raw, synced: Boolean(state.synced), lines, offset: Math.max(-10, Math.min(10, Number(state.offset) || 0)) });
    if (Buffer.byteLength(data, 'utf8') > 1024 * 1024) return { ok: false, error: 'A letra passa de 1 MB.' };
    const file = lyricsStatePath(id); await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, data, { mode: 0o600 }); await fs.rename(`${file}.tmp`, file); return { ok: true };
  });
  ipcMain.handle('lyrics:align', async (event, payload) => {
    const id = payload?.id, audioPath = resolveTrackPath(id), samples = payload?.samples, lyrics = payload?.lines, duration = Number(payload?.duration) || 0;
    if (!validTrackId(id) || !audioPath || !fsSync.existsSync(audioPath)) return { ok: false, error: 'A faixa não está mais disponível na biblioteca.' };
    if (!(samples instanceof Float32Array) || samples.length < 16000 * 8 || samples.length > 16000 * 600) return { ok: false, error: 'O áudio precisa ter entre 8 segundos e 10 minutos para a sincronização automática.' };
    if (!Array.isArray(lyrics) || lyrics.length < 2 || lyrics.length > 1200 || lyrics.some(line => typeof line !== 'string' || line.length > 1000)) return { ok: false, error: 'A letra não é válida para sincronização.' };
    if (alignmentWorker) return { ok: false, error: 'Já existe uma sincronização em segundo plano. Aguarde ela terminar antes de iniciar outra.' };
    return new Promise(resolve => {
      let settled = false;
      const workerPath = app.isPackaged ? path.join(process.resourcesPath, 'lyrics-worker.cjs') : path.join(__dirname, '../workers/lyrics-worker.cjs');
      const worker = utilityProcess.fork(workerPath, [], { serviceName: 'Isótopus Lyrics Synchronizer', env: { ...process.env, ISOTOPUS_APP_PATH: app.getAppPath() } });
      alignmentWorker = worker;
      const finish = result => { if (settled) return; settled = true; if (alignmentWorker === worker) alignmentWorker = null; resolve(result); };
      worker.on('message', async message => {
        if (!message || message.id !== id) return;
        if (message.type === 'progress') { if (!event.sender.isDestroyed()) event.sender.send('lyrics:align-progress', { id, phase: message.phase, message: message.message }); }
        else if (message.type === 'result') { await persistBackgroundLyrics(id, lyrics, message.result); finish(message.result); worker.kill(); }
      });
      worker.on('error', error => { console.error('Lyrics worker failed:', error); finish({ ok: false, error: 'O processo de sincronização em segundo plano falhou. O Isótopus continua aberto; você pode tentar novamente.' }); });
      worker.on('exit', code => { if (alignmentWorker === worker) alignmentWorker = null; if (!settled) finish({ ok: false, error: `O processo de sincronização em segundo plano foi encerrado (${code ?? 'sem código'}). O Isótopus continua aberto; tente uma faixa menor ou feche outros aplicativos e tente novamente.` }); });
      try { worker.postMessage({ id, samples, lines: lyrics, duration, cacheDir: path.join(app.getPath('userData'), 'models', 'transformers') }); }
      catch (error) { console.error('Could not start lyrics worker:', error); finish({ ok: false, error: 'Não consegui iniciar a sincronização em segundo plano.' }); worker.kill(); }
    });
  });
  ipcMain.handle('lyrics:local', async (_event, id) => {
    if (typeof id !== 'string') return { content: '' };
    const audioPath = resolveTrackPath(id); if (!audioPath) return { content: '' };
    const lyricPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, path.extname(audioPath))}.lrc`);
    try { return { content: await fs.readFile(lyricPath, 'utf8'), path: lyricPath }; } catch { return { content: '' }; }
  });
  ipcMain.handle('lyrics:openFile', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: 'Abrir letra', properties: ['openFile'], filters: [{ name: 'Letras', extensions: ['lrc', 'txt'] }] });
    if (result.canceled || !result.filePaths.length) return { cancelled: true };
    const stat = await fs.stat(result.filePaths[0]); if (stat.size > 1024 * 1024) return { error: 'O arquivo de letra passa de 1 MB.' };
    return { content: await fs.readFile(result.filePaths[0], 'utf8'), path: result.filePaths[0] };
  });
  ipcMain.handle('lyrics:save', async (_event, { id, content }) => {
    if (typeof id !== 'string' || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 1024 * 1024) return { ok: false, error: 'Letra inválida.' };
    const audioPath = resolveTrackPath(id); if (!audioPath) return { ok: false, error: 'A faixa não está mais na biblioteca.' };
    const defaultPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, path.extname(audioPath))}.lrc`);
    const result = await dialog.showSaveDialog(getWindow(), { title: 'Salvar letra sincronizada', defaultPath, filters: [{ name: 'Letra LRC', extensions: ['lrc'] }] });
    if (result.canceled || !result.filePath) return { cancelled: true };
    const file = path.extname(result.filePath) ? result.filePath : `${result.filePath}.lrc`;
    await fs.writeFile(file, content, { encoding: 'utf8', mode: 0o600 }); return { ok: true, path: file };
  });
  async function performLyricsSearch(track) {
    if (!track || typeof track.title !== 'string' || typeof track.artist !== 'string') return { ok: false, error: 'Metadados da faixa inválidos.' };
    const cacheKey = [track.title, track.artist, track.album || '', Math.round(Number(track.duration) || 0)].join('|').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const cached = searchCache.get(cacheKey); if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.value;
    const now = Date.now(); if (now < retryAt) return { ok: false, error: 'Aguarde alguns segundos antes de buscar outra letra.' };
    const delay = Math.max(0, 1200 - (now - requestAt)); if (delay) await new Promise(resolve => setTimeout(resolve, delay)); requestAt = Date.now();
    const params = new URLSearchParams({ track_name: track.title.slice(0, 256), artist_name: track.artist.slice(0, 256) });
    if (track.album) params.set('album_name', String(track.album).slice(0, 256));
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`https://lrclib.net/api/search?${params}`, { headers: { 'User-Agent': 'Isotopus/0.2.0 (https://github.com/mrts-wx/isotopus)', Accept: 'application/json' }, signal: controller.signal });
      if (response.status === 429) { const value = response.headers.get('retry-after'), seconds = Number(value); retryAt = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : value ? Date.parse(value) || Date.now() + 5000 : Date.now() + 5000; return { ok: false, error: 'Muitas buscas em sequência. Tente novamente em alguns segundos.' }; }
      if (!response.ok) return { ok: false, error: `Serviço de letras indisponível (${response.status}).` };
      const records = await response.json(); if (!Array.isArray(records)) return { ok: false, error: 'Resposta inesperada do serviço de letras.' };
      const duration = Number(track.duration) || 0; records.sort((a, b) => Math.abs((Number(a.duration) || 0) - duration) - Math.abs((Number(b.duration) || 0) - duration));
      const result = { ok: true, records: records.slice(0, 12).map(record => ({ title: String(record.trackName || record.name || '').slice(0, 256), artist: String(record.artistName || '').slice(0, 256), album: String(record.albumName || '').slice(0, 256), duration: Number(record.duration) || 0, plainLyrics: String(record.plainLyrics || '').slice(0, 100000), syncedLyrics: String(record.syncedLyrics || '').slice(0, 100000), instrumental: Boolean(record.instrumental) })) };
      searchCache.set(cacheKey, { at: Date.now(), value: result }); if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value); return result;
    } catch (error) { return { ok: false, error: error.name === 'AbortError' ? 'A busca de letras demorou demais.' : 'Não consegui acessar o serviço de letras.' }; }
    finally { clearTimeout(timeout); }
  }
  ipcMain.handle('lyrics:search', (_event, track) => { const queued = searchQueue.then(() => performLyricsSearch(track)); searchQueue = queued.catch(() => {}); return queued; });
  ipcMain.handle('lyrics:webSearch', async (_event, track) => {
    if (!track || typeof track.title !== 'string') return { ok: false, error: 'Faixa inválida.' };
    const url = new URL('https://www.google.com/search'); url.searchParams.set('q', [track.title, track.artist, 'letra'].filter(value => typeof value === 'string' && value.trim()).join(' ').slice(0, 600));
    try { await shell.openExternal(url.href); return { ok: true }; } catch { return { ok: false, error: 'Não consegui abrir o navegador.' }; }
  });
}

module.exports = { registerLyricsController };
