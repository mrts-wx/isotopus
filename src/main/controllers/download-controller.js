const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const https = require('node:https');

const execFileAsync = promisify(execFile);
const REPO = 'mrts-wx/isotopus';
const YTDLP_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Isotopus/0.2.2', Accept: 'application/vnd.github+json' } }, response => {
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
    https.get(url, { headers: { 'User-Agent': 'Isotopus/0.2.2' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { output.close(); require('node:fs').unlink(destination, () => {}); return downloadFile(response.headers.location, destination).then(resolve, reject); }
      if (response.statusCode !== 200) { output.close(); require('node:fs').unlink(destination, () => {}); reject(new Error(`Download HTTP ${response.statusCode}`)); return; }
      response.pipe(output); output.on('finish', () => output.close(resolve));
    }).on('error', error => { output.destroy(); reject(error); });
  });
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
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { ok: false, error: 'Use um link público HTTP ou HTTPS, sem credenciais.' };
    if (/(^|\.)spotify\.com$/i.test(url.hostname)) return { ok: false, error: 'O Spotify não fornece o áudio para download pelo yt-dlp. Use um link de uma fonte compatível.' };
    const targetDir = typeof input === 'object' ? String(input.folder || '') : '';
    if (!targetDir || !getSettings().folders.includes(targetDir)) return { ok: false, error: 'Escolha uma das pastas de música monitoradas nas opções da tela.' };
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
      const args = ['--newline', '--progress', '--progress-template', 'download:ISOTOPUS_PROGRESS:%(progress._percent)s', '--no-playlist', '-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-thumbnail', '--embed-metadata', '--output', output, '--print', 'after_move:filepath', url.href];
      const child = require('node:child_process').spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); processHandle = child;
      let stderr = '', finished = false;
      const complete = value => { if (finished) return; finished = true; running = false; processHandle = null; resolve(value); };
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      const buffers = { stdout: '', stderr: '' };
      const parseLines = (stream, chunk) => {
        const lines = (buffers[stream] + chunk).split(/\r\n|\n|\r/);
        buffers[stream] = lines.pop() || '';
        for (const line of lines.filter(Boolean)) {
          const match = /ISOTOPUS_PROGRESS:([\d.]+)/.exec(line);
          if (match) {
            const percent = Number(match[1]);
            if (Number.isFinite(percent)) emit({ status: 'running', message: 'Baixando áudio…', percent: Math.min(100, Math.max(0, percent)) });
          } else {
            const stage = /thumbnail|metadata|extractaudio|ffmpeg|post.?process/i.test(line) ? 'Finalizando MP3 e incorporando capa…' : line.slice(0, 240);
            emit({ status: 'running', message: stage });
          }
        }
      };
      child.stdout.on('data', chunk => parseLines('stdout', chunk));
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1200); parseLines('stderr', chunk); });
      child.on('error', error => { emit({ status: 'error', message: error.message }); complete({ ok: false, error: `Falha ao iniciar o yt-dlp: ${error.message}` }); });
      child.on('close', code => {
        if (code === 0) { emit({ status: 'done', message: 'Download concluído. O MP3 foi salvo na pasta escolhida.' }); complete({ ok: true }); }
        else { const detail = stderr.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300); emit({ status: 'error', message: detail || `yt-dlp saiu com código ${code}` }); complete({ ok: false, error: detail || `yt-dlp saiu com código ${code}` }); }
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

module.exports = { registerDownloadController, compareVersions };
