const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const https = require('node:https');

const execFileAsync = promisify(execFile);
const REPO = 'mrts-wx/isotopus';
const YTDLP_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Isotopus/0.2.4', Accept: 'application/vnd.github+json' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) return requestJson(response.headers.location).then(resolve, reject);
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode}`)); return; }
      let data = ''; response.setEncoding('utf8'); response.on('data', chunk => { data += chunk; if (data.length > 2_000_000) { response.destroy(new Error('Resposta muito grande')); } });
      response.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } }); response.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const output = require('node:fs').createWriteStream(destination, { mode: 0o700 });
    https.get(url, { headers: { 'User-Agent': 'Isotopus/0.2.4' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { output.close(); require('node:fs').unlink(destination, () => {}); return downloadFile(response.headers.location, destination).then(resolve, reject); }
      if (response.statusCode !== 200) { output.close(); require('node:fs').unlink(destination, () => {}); reject(new Error(`Download HTTP ${response.statusCode}`)); return; }
      response.pipe(output); output.on('finish', () => output.close(resolve));
    }).on('error', error => { output.destroy(); reject(error); });
  });
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') return true;
  const family = net.isIP(host);
  if (family === 4) {
    const octets = host.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (family === 6) return host === '::' || host === '::1' || /^(fc|fd|fe[89ab]|ff)/i.test(host) || /^::ffff:(?:0:)?(?:10\.|127\.|192\.168\.|169\.254\.)/i.test(host);
  return false;
}

function registerDownloadController({ app, ipcMain, getWindow, getSettings, saveSettings }) {
  let running = false;
  let processHandle = null;
  const binaryPath = () => path.join(app.getPath('userData'), 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const consentState = () => getSettings().store?.ytDlpConsent;
  const hasConsent = () => consentState() === 'yes';
  const emit = data => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('download:progress', data); };

  async function installYtDlp() {
    const dest = binaryPath();
    try { await fs.access(dest); return dest; } catch {}
    const release = await requestJson(YTDLP_API);
    const assetName = process.platform === 'win32' ? 'yt-dlp.exe' : process.arch === 'x64' ? 'yt-dlp_linux' : '';
    const asset = release.assets?.find(item => item.name === assetName);
    if (!assetName || !asset?.browser_download_url) throw new Error('Não encontrei o executável oficial do yt-dlp para esta arquitetura.');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const temp = `${dest}.download`;
    try {
      emit({ status: 'installing', message: `Baixando yt-dlp ${release.tag_name || ''} do repositório oficial…` });
      await downloadFile(asset.browser_download_url, temp);
      if (asset.digest?.startsWith('sha256:')) {
        const hash = crypto.createHash('sha256').update(await fs.readFile(temp)).digest('hex');
        if (hash !== asset.digest.slice(7)) throw new Error('A verificação SHA-256 do yt-dlp falhou.');
      }
      await fs.chmod(temp, 0o700); await fs.rename(temp, dest);
      return dest;
    } catch (error) { await fs.rm(temp, { force: true }); throw error; }
  }

  ipcMain.handle('downloads:consent:get', () => consentState() === undefined ? null : hasConsent());
  ipcMain.handle('downloads:consent:set', async (_event, accepted) => {
    getSettings().store.ytDlpConsent = accepted ? 'yes' : 'no'; await saveSettings(); return Boolean(accepted);
  });
  ipcMain.handle('downloads:check-ffmpeg', async () => {
    try { const result = await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', ['ffmpeg'], { timeout: 3000 }); return { available: Boolean(result.stdout.trim()) }; }
    catch { return { available: false }; }
  });
  ipcMain.handle('downloads:start', async (_event, input) => {
    if (!hasConsent()) return { ok: false, error: 'Autorize o uso do yt-dlp antes de baixar.' };
    if (running) return { ok: false, error: 'Já existe um download em andamento.' };
    let url;
    const rawUrl = typeof input === 'object' && input ? input.url : input;
    try { url = new URL(String(rawUrl || '').trim()); } catch { return { ok: false, error: 'Cole um link válido.' }; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || String(rawUrl || '').length > 4096) return { ok: false, error: 'Use um link HTTP ou HTTPS público, curto e sem credenciais.' };
    if (isPrivateHost(url.hostname)) return { ok: false, error: 'Por segurança, o downloader aceita apenas endereços públicos da internet.' };
    if (/(^|\.)spotify\.com$/i.test(url.hostname)) return { ok: false, error: 'O Spotify não fornece o áudio para download pelo yt-dlp. Use um link de uma fonte compatível.' };
    const targetDir = typeof input === 'object' ? String(input.folder || '') : '';
    if (!targetDir || !getSettings().folders.includes(targetDir)) return { ok: false, error: 'Escolha uma das pastas de música monitoradas nas opções da tela.' };
    try { if (!(await fs.stat(targetDir)).isDirectory()) throw new Error(); } catch { return { ok: false, error: 'A pasta monitorada escolhida não existe ou não está disponível.' }; }
    const ffmpegExists = await (async () => { try { await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', ['ffmpeg'], { timeout: 3000 }); return true; } catch { return false; } })();
    if (!ffmpegExists) {
      let installHelp = process.platform === 'win32' ? 'Instale o FFmpeg pelo site oficial ffmpeg.org/download.html.' : 'Instale o FFmpeg pelo gerenciador de pacotes.';
      if (process.platform === 'linux') {
        let osRelease = ''; try { osRelease = await fs.readFile('/etc/os-release', 'utf8'); } catch {}
        installHelp = /(^|\n)(ID|ID_LIKE)=.*\b(arch|manjaro|endeavouros)\b/i.test(osRelease) ? 'Instale pelo terminal com: sudo pacman -S ffmpeg' : 'Instale pelo terminal com: sudo apt install ffmpeg';
      }
      return { ok: false, error: `FFmpeg não encontrado. ${installHelp}` };
    }
    let executable;
    try { executable = await installYtDlp(); } catch (error) { return { ok: false, error: `Não consegui instalar o yt-dlp: ${String(error.message || error).slice(0, 220)}` }; }
    const output = path.join(targetDir, '%(title).180B [%(id)s].%(ext)s');
    running = true; emit({ status: 'running', message: 'Preparando o download…' });
    return new Promise(resolve => {
      const args = ['--no-simulate', '--newline', '--progress', '--progress-template', 'download:ISOTOPUS_PROGRESS:%(progress._percent)s|%(info.playlist_index)s|%(info.playlist_count)s|%(info.title)s', '--yes-playlist', '--lazy-playlist', '--playlist-end', '100', '--ignore-errors', '--no-overwrites', '--concurrent-fragments', '1', '--sleep-requests', '1', '--sleep-interval', '5', '--max-sleep-interval', '10', '--retries', '8', '--fragment-retries', '8', '--extractor-retries', '5', '--retry-sleep', 'http:exp=1:20', '--retry-sleep', 'fragment:exp=1:16', '--retry-sleep', 'extractor:exp=1:16', '-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-thumbnail', '--embed-metadata', '--output', output, '--print', 'before_dl:ISOTOPUS_ITEM:%(playlist_index)s|%(playlist_count)s|%(title)s', '--print', 'after_move:ISOTOPUS_DONE:%(playlist_index)s|%(playlist_count)s|%(title)s', url.href];
      let child;
      try { child = require('node:child_process').spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (error) { running = false; emit({ status: 'error', message: error.message }); resolve({ ok: false, error: `Falha ao iniciar o yt-dlp: ${error.message}` }); return; }
      processHandle = child;
      let stderr = '', finished = false, itemSequence = 0, errorCount = 0, playlistTruncated = false;
      const itemKeys = new Map();
      const failedItemIds = new Set();
      const doneItemIds = new Set();
      const complete = value => { if (finished) return; finished = true; running = false; processHandle = null; resolve(value); };
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      const buffers = { stdout: '', stderr: '' };
      const parseItem = value => {
        const first = value.indexOf('|'), second = value.indexOf('|', first + 1);
        if (first < 0 || second < 0) return { title: value.trim() || 'Faixa sem título' };
        const rawIndex = value.slice(0, first), rawCount = value.slice(first + 1, second);
        const index = Number(rawIndex), count = Number(rawCount);
        const title = value.slice(second + 1).trim() || 'Faixa sem título';
        const itemCount = Number.isFinite(count) && count > 0 ? count : null;
        if (itemCount > 100) playlistTruncated = true;
        return { itemIndex: Number.isFinite(index) && index > 0 ? index : null, itemCount, title };
      };
      const itemIdFor = item => {
        const key = item.itemIndex ? `index:${item.itemIndex}` : `title:${item.title}`;
        if (!itemKeys.has(key)) itemKeys.set(key, `item-${++itemSequence}`);
        return itemKeys.get(key);
      };
      const emitItem = (event, item, extra = {}) => {
        const itemId = itemIdFor(item);
        if (event === 'item-done') doneItemIds.add(itemId);
        emit({ status: 'running', event, itemId, ...item, message: item.itemCount ? `Faixa ${item.itemIndex || itemSequence} de ${item.itemCount}` : 'Processando faixa…', ...extra });
      };
      let activeItem = { title: 'Preparando faixa' };
      const parseLines = (stream, chunk) => {
        const lines = (buffers[stream] + chunk).split(/\r\n|\n|\r/);
        buffers[stream] = lines.pop() || '';
        for (const line of lines.filter(Boolean)) {
          if (line.startsWith('ISOTOPUS_ITEM:')) {
            activeItem = parseItem(line.slice('ISOTOPUS_ITEM:'.length)); emitItem('item', activeItem); continue;
          }
          if (line.startsWith('ISOTOPUS_DONE:')) {
            const item = parseItem(line.slice('ISOTOPUS_DONE:'.length)); emitItem('item-done', item, { percent: 100 }); continue;
          }
          const match = /ISOTOPUS_PROGRESS:([\d.]+)\|([^|]*)\|([^|]*)\|(.*)/.exec(line);
          if (match) {
            const percent = Number(match[1]);
            if (Number.isFinite(percent)) {
              const item = parseItem(`${match[2]}|${match[3]}|${match[4]}`); activeItem = item;
              emitItem('item-progress', item, { percent: Math.min(100, Math.max(0, percent)), message: item.itemCount ? `Baixando faixa ${item.itemIndex || itemSequence} de ${item.itemCount}` : 'Baixando áudio…' });
            }
          } else {
            if (/\bERROR:/i.test(line)) { const itemId = itemIdFor(activeItem); if (!failedItemIds.has(itemId)) { failedItemIds.add(itemId); errorCount++; } emitItem('item-error', activeItem, { message: line.slice(0, 240) }); }
            const stage = /thumbnail|metadata|extractaudio|ffmpeg|post.?process/i.test(line) ? 'Finalizando MP3 e incorporando capa…' : line.slice(0, 240);
            if (!/\bERROR:/i.test(line)) emit({ status: 'running', message: stage });
          }
        }
      };
      child.stdout.on('data', chunk => parseLines('stdout', chunk));
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1200); parseLines('stderr', chunk); });
      child.on('error', error => { emit({ status: 'error', message: error.message }); complete({ ok: false, error: `Falha ao iniciar o yt-dlp: ${error.message}` }); });
      child.on('close', code => {
        if (code === 0) {
          const partial = errorCount > 0 || playlistTruncated;
          const message = errorCount && playlistTruncated ? `${errorCount} faixa(s) falharam; playlists são limitadas aos primeiros 100 itens.` : errorCount ? `${errorCount} faixa(s) não puderam ser baixadas; as demais foram salvas.` : playlistTruncated ? 'Primeiros 100 itens baixados. O limite evita filas longas demais.' : 'Download concluído. Os MP3 foram salvos na pasta escolhida.';
          emit({ status: 'done', partial, errorCount, playlistTruncated, message }); complete({ ok: true, partial, errorCount, playlistTruncated });
        }
        else {
          const detail = stderr.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300) || `yt-dlp saiu com código ${code}`;
          if (doneItemIds.size && errorCount) { const message = `${doneItemIds.size} faixa(s) salvas; ${errorCount} falharam.`; emit({ status: 'done', partial: true, errorCount, message }); complete({ ok: true, partial: true, errorCount }); }
          else { emit({ status: 'error', message: detail }); complete({ ok: false, error: detail }); }
        }
      });
    });
  });
  ipcMain.handle('downloads:cancel', () => { if (!processHandle) return false; processHandle.kill(); return true; });

  ipcMain.handle('updates:check', async () => {
    try {
      const release = await requestJson(`https://api.github.com/repos/${REPO}/releases/latest`);
      const latest = String(release.tag_name || '').replace(/^v/, ''), current = app.getVersion();
      const newer = compareVersions(latest, current) > 0;
      let suffix = process.platform === 'win32' ? 'setup-x64.exe' : '', osFamily = process.platform;
      if (process.platform === 'linux' && process.arch === 'x64') {
        let osRelease = '';
        try { osRelease = await fs.readFile('/etc/os-release', 'utf8'); } catch {}
        osFamily = /(^|\n)(ID|ID_LIKE)=.*\b(arch|manjaro|endeavouros)\b/i.test(osRelease) ? 'arch' : 'debian';
        suffix = osFamily === 'arch' ? 'x64.pacman' : 'amd64.deb';
      }
      const asset = suffix && release.assets?.find(item => item.name.endsWith(suffix));
      const installCommand = asset?.name.endsWith('.deb') ? `sudo apt install ./Isotopus-${latest}-amd64.deb` : asset?.name.endsWith('.pacman') ? `sudo pacman -U ./Isotopus-${latest}-x64.pacman` : '';
      return { ok: true, current, latest, newer, releaseUrl: release.html_url, downloadUrl: asset?.browser_download_url || release.html_url, installer: asset?.name || null, platform: process.platform, osFamily, installCommand };
    } catch (error) { return { ok: false, error: String(error.message || error).slice(0, 180) }; }
  });
  return { dispose() { if (processHandle) processHandle.kill(); } };
}

function compareVersions(a, b) {
  const left = String(a).split(/[.+-]/).map(part => Number(part) || 0), right = String(b).split(/[.+-]/).map(part => Number(part) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) { const delta = (left[i] || 0) - (right[i] || 0); if (delta) return Math.sign(delta); }
  return 0;
}

module.exports = { registerDownloadController, compareVersions, isPrivateHost };
