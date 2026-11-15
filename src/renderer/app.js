const $ = id => document.getElementById(id);
const seekVisualizers = [...document.querySelectorAll('.seek-visualizer')];
const durableStore = new Map(Object.entries(window.isotopus.getPersistentStore?.() || {}));
const store = {
  get: key => durableStore.get(key) || '',
  set: (key, value) => { const text = String(value || ''); if (text) durableStore.set(key, text); else durableStore.delete(key); window.isotopus.setPersistentStore?.(key, text); }
};
let audio = new Audio();
audio.preload = 'metadata';
let standbyAudio = new Audio();
standbyAudio.preload = 'metadata'; standbyAudio.volume = 0;
let crossfadeSeconds = 0;
let crossfadeActive = false;
let crossfadeTimer = 0;
let crossfadeProgress = 0;
let baseVolume = 0.75;
let crossfadeFromTrack = null;
let crossfadeFromIndex = -1;
const shuffleTracks = window.IsotopusShuffle.shuffleTracks;
let equalizer;
let tracks = [];
let folders = [];
let activeView = 'listen';
let visibleTracks = [];
let queue = [];
let queueIndex = -1;
const failedTracks = new Set();
let currentTrack = null;
let miniPlayerVisible = false;
let listeningSession = null;
let mediaSessionTrackId = null;
let mediaSessionPlaybackState = null;
let lastMediaPositionUpdate = 0;
let playlists = [];
let playlistDraftIds = [];
let playlistPendingTrackId = '';
let playlistEditingId = '';
let playlistDeletePendingId = '';
let trackDeletePendingId = '';
let currentLyrics = { raw: '', synced: false, lines: [], source: '' };
let timedLyricsIndex = [];
let lyricsTrackId = '';
let manualLyricsMode = false;
let manualRedoPending = false;
let activeLyricIndex = -1;
let shuffled = false;
let repeatMode = 0;
let toastTimer;
let searchTimer;
// Smaller batches keep fewer album images decoded and fewer card nodes alive at once.
const PAGE_SIZE = 24;
const titles = { listen: 'Ouvir agora', songs: 'Faixas', artists: 'Artistas', favorites: 'Favoritas', playlists: 'Playlists', downloads: 'Baixar música', queue: 'Fila de reprodução', statistics: 'Estatísticas', smart: 'Pastas inteligentes', about: 'Sobre o Isótopus' };
const safeArray = key => { try { return JSON.parse(store.get(key) || '[]'); } catch { return []; } };
const safeObject = key => { try { const value = JSON.parse(store.get(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
const normalizeSearch = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();
let listeningStats = safeObject('listeningStats');
if (!Array.isArray(listeningStats.sessions)) listeningStats = { sessions: [] };
const completedPlayCounts = new Map();
function rebuildCompletedPlayCounts() {
  completedPlayCounts.clear();
  for (const session of listeningStats.sessions) {
    if (session?.completed && session.id) completedPlayCounts.set(session.id, (completedPlayCounts.get(session.id) || 0) + 1);
  }
}
rebuildCompletedPlayCounts();
let lastStatsPersist = 0;
let smartFolders = safeArray('smartFolders').filter(folder => folder && typeof folder.id === 'string' && typeof folder.name === 'string' && Array.isArray(folder.rules));
let smartFolderEditingId = '';

function saveListeningStats() {
  listeningStats.sessions = listeningStats.sessions.slice(-1000);
  rebuildCompletedPlayCounts();
  store.set('listeningStats', JSON.stringify(listeningStats));
}
function persistListeningSession() {
  if (!listeningSession || listeningSession.seconds <= 0) return;
  const threshold = Math.min(30, Math.max(8, (Number(listeningSession.duration) || 0) * .5));
  listeningSession.completed = listeningSession.seconds >= threshold;
  const existing = listeningStats.sessions.find(item => item.key === listeningSession.key);
  if (existing) Object.assign(existing, listeningSession);
  else listeningStats.sessions.push({ ...listeningSession });
  saveListeningStats(); lastStatsPersist = Date.now();
}
function recordListeningProgress() {
  if (!currentTrack || audio.paused) return;
  const now = audio.currentTime || 0;
  if (!listeningSession || listeningSession.id !== currentTrack.id) {
    persistListeningSession();
    listeningSession = { key: `${currentTrack.id}:${Date.now()}`, id: currentTrack.id, title: currentTrack.title, artist: currentTrack.artist, album: currentTrack.album, genre: currentTrack.genre || '', duration: Number(audio.duration) || Number(currentTrack.duration) || 0, seconds: 0, completed: false, startedAt: Date.now(), lastTime: now };
  }
  const delta = now - listeningSession.lastTime;
  if (delta > 0 && delta <= 3) listeningSession.seconds += delta;
  listeningSession.lastTime = now;
  const threshold = Math.min(30, Math.max(8, listeningSession.duration * .5));
  if (Date.now() - lastStatsPersist > 15000 || (!listeningSession.completed && listeningSession.seconds >= threshold)) persistListeningSession();
}
function finishListeningSession() { persistListeningSession(); listeningSession = null; }
function sessionsForPeriod(period = 'all') {
  const cutoff = period === '30' ? Date.now() - 30 * 86400000 : period === '365' ? Date.now() - 365 * 86400000 : 0;
  return listeningStats.sessions.filter(item => Number(item.startedAt) >= cutoff);
}
function statsForTrack(id) { return completedPlayCounts.get(id) || 0; }
function matchesSmartFolder(track, folder) {
  return folder.rules.every(rule => {
    const field = rule.field === 'plays' ? String(statsForTrack(track.id)) : String(track[rule.field] ?? '');
    if (rule.field === 'year' || rule.field === 'plays') return Number(field) >= Number(rule.value || 0);
    return rule.op === 'contains' ? normalizeSearch(field).includes(normalizeSearch(rule.value)) : normalizeSearch(field) === normalizeSearch(rule.value);
  });
}

function setStyledSelect(id, value) {
  const root = $(id); if (!root) return;
  const option = root.querySelector(`[data-option="${value}"]`);
  if (!option) return;
  root.dataset.value = value;
  root.querySelector('.styled-select-trigger span').textContent = option.textContent;
  root.querySelectorAll('[role="option"]').forEach(item => item.setAttribute('aria-selected', String(item === option)));
  root.classList.remove('open');
  root.querySelector('.styled-select-trigger').setAttribute('aria-expanded', 'false');
  root.querySelector('.styled-select-menu').hidden = true;
}
function bindStyledSelect(id, onChange) {
  const root = $(id); if (!root) return;
  const trigger = root.querySelector('.styled-select-trigger');
  const menu = root.querySelector('.styled-select-menu');
  const close = () => { root.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); menu.hidden = true; };
  const open = () => { document.querySelectorAll('.styled-select.open').forEach(item => { item.classList.remove('open'); item.querySelector('.styled-select-trigger').setAttribute('aria-expanded', 'false'); item.querySelector('.styled-select-menu').hidden = true; }); root.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); menu.hidden = false; menu.querySelector('[aria-selected="true"]')?.focus(); };
  trigger.addEventListener('click', () => menu.hidden ? open() : close());
  root.addEventListener('click', event => {
    const option = event.target.closest('[data-option]'); if (!option) return;
    setStyledSelect(id, option.dataset.option); onChange(option.dataset.option);
  });
  trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); open(); } });
  menu.addEventListener('keydown', event => {
    const options = [...menu.querySelectorAll('[role="option"]')]; const index = options.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length].focus(); }
    else if (event.key === 'Tab') close();
  });
}
function createStyledSelect(id, ariaLabel, options, value, className = '') {
  const root = document.createElement('div'); root.id = id; root.className = `styled-select ${className}`.trim(); root.dataset.value = value;
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'styled-select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', ariaLabel);
  const selected = options.find(option => option[0] === value) || options[0];
  const label = document.createElement('span'); label.textContent = selected?.[1] || '';
  const arrow = document.createElement('i'); arrow.textContent = '⌄'; trigger.append(label, arrow);
  const menu = document.createElement('div'); menu.className = 'styled-select-menu'; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', ariaLabel); menu.hidden = true;
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement('button'); option.type = 'button'; option.setAttribute('role', 'option'); option.dataset.option = optionValue; option.setAttribute('aria-selected', String(optionValue === selected?.[0])); option.textContent = optionLabel; menu.append(option);
  }
  root.append(trigger, menu); return root;
}
equalizer = window.IsotopusEqualizer.create({ store, getElement: $, setStyledSelect, decks: () => [audio, standbyAudio] });

function applyTheme(theme = store.get('theme') || 'system') {
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
  document.body.classList.toggle('dark-theme', theme === 'dark' || (theme === 'system' && systemDark));
  const surfaceStyle = ['normal', 'glass', 'mica'].includes(store.get('surfaceStyle')) ? store.get('surfaceStyle') : 'normal';
  document.body.dataset.surfaceStyle = surfaceStyle;
  document.body.classList.toggle('dynamic-colors', store.get('dynamicColors') === 'yes');
  if (currentTrack) refreshCoverAmbient(currentTrack);
  refreshAppearanceOptions();
}
function refreshAppearanceOptions() {
  const defaults = { theme: 'system', surfaceStyle: 'normal', dynamicColors: 'no' };
  document.querySelectorAll('[data-appearance-key]').forEach(button => {
    button.setAttribute('aria-pressed', String((store.get(button.dataset.appearanceKey) || defaults[button.dataset.appearanceKey]) === button.dataset.appearanceValue));
  });
  const dynamicToggle = $('dynamicColorsToggle'); if (dynamicToggle) dynamicToggle.checked = store.get('dynamicColors') === 'yes';
}
function syncNavIndicator() {
  const sidebar = document.querySelector('.sidebar'), active = sidebar?.querySelector('.nav-item.selected'), indicator = $('navSelectionIndicator');
  if (!sidebar || !active || !indicator) return;
  const y = active.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
  indicator.style.top = `${Math.round(y)}px`;
  indicator.style.height = `${Math.round(active.getBoundingClientRect().height)}px`;
  document.body.classList.add('nav-indicator-ready');
}
async function refreshCoverAmbient(track) {
  if (store.get('dynamicColors') !== 'yes') { document.body.style.removeProperty('--cover-tone'); publishMiniPlayerState(); return; }
  const image = $('trackArt')?.querySelector('img'); if (!image || !track?.coverUrl) { document.body.style.removeProperty('--cover-tone'); publishMiniPlayerState(); return; }
  try {
    if (!image.complete) await image.decode();
    if (currentTrack?.id !== track.id) return;
    const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 12;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, 12, 12);
    const pixels = context.getImageData(0, 0, 12, 12).data; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < pixels.length; i += 4) { const y = .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]; if (y < 25 || y > 230) continue; r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++; }
    if (!n) { document.body.style.removeProperty('--cover-tone'); publishMiniPlayerState(); return; }
    const soften = value => Math.round(value / n * .76 + 128 * .24);
    document.body.style.setProperty('--cover-tone', `rgb(${soften(r)},${soften(g)},${soften(b)})`);
    publishMiniPlayerState();
  } catch { document.body.style.removeProperty('--cover-tone'); publishMiniPlayerState(); }
}
function refreshAcrylicArtwork(track) {
  document.body.style.removeProperty('--cover-artwork');
  const image = $('trackArt')?.querySelector('img');
  if (!image || !track?.coverUrl) return;
  const apply = () => {
    if (currentTrack?.id !== track.id || !image.naturalWidth) return;
    document.body.style.setProperty('--cover-artwork', `url(${JSON.stringify(image.currentSrc || image.src)})`);
  };
  if (image.complete) apply(); else image.addEventListener('load', apply, { once: true });
}


function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
let ytDlpConsentKnown = false;
let updateRelease = null;
const downloadJobs = [];
let currentDownloadJob = null;
function updateDownloadFolderOptions() {
  const select = $('downloadFolder'), previous = select.value;
  select.replaceChildren();
  folders.forEach(folder => { const option = document.createElement('option'); option.value = folder; option.textContent = folder; select.append(option); });
  if (folders.includes(previous)) select.value = previous;
  select.disabled = folders.length === 0;
  $('downloadStartButton').disabled = folders.length === 0;
  $('downloadAddFolder').hidden = folders.length > 0;
  if (!folders.length) setDownloadStatus('Adicione primeiro uma pasta de músicas nas configurações; os downloads serão salvos nela.');
}
function setDownloadStatus(message, error = false) {
  const status = $('downloadStatus'); status.textContent = message; status.classList.toggle('error', error);
}
function renderDownloadJobs() {
  const list = $('downloadList'); list.replaceChildren();
  const activeCount = downloadJobs.filter(job => job.status === 'running').length;
  const badge = $('downloadManagerBadge'); badge.hidden = activeCount === 0; badge.textContent = String(activeCount);
  $('downloadManagerEmpty').hidden = downloadJobs.length > 0;
  $('clearDownloadHistoryButton').disabled = !downloadJobs.some(job => job.status !== 'running' || job.tracks.some(track => track.status === 'done' || track.status === 'error'));
  for (const job of downloadJobs.slice(-20).reverse()) {
    const batch = document.createElement('section'); batch.className = `download-batch ${job.status}`;
    const batchHead = document.createElement('div'); batchHead.className = 'download-batch-head';
    const batchTitle = document.createElement('b'); batchTitle.textContent = job.title;
    const completed = job.tracks.filter(track => track.status === 'done').length;
    const failed = job.tracks.filter(track => track.status === 'error').length;
    const total = job.tracks.find(track => track.itemCount)?.itemCount;
    const expected = total ? Math.min(total, 100) : job.tracks.length || '…';
    const summary = document.createElement('span'); summary.textContent = job.status === 'running' ? `${completed}/${expected} concluídas` : failed ? `${completed} concluídas · ${failed} falharam` : `${completed} concluídas`;
    const detail = document.createElement('small'); detail.textContent = job.message;
    batchHead.append(batchTitle, summary); batch.append(batchHead, detail);
    for (const trackJob of job.tracks) {
      const row = document.createElement('article'); row.className = `download-job ${trackJob.status}`;
      const head = document.createElement('div'); head.className = 'download-job-head';
      const title = document.createElement('b'); title.textContent = trackJob.title;
      const percent = document.createElement('span'); percent.textContent = trackJob.status === 'done' ? 'Concluída' : trackJob.status === 'error' ? 'Falhou' : `${trackJob.position ? `${trackJob.position} · ` : ''}${Math.round(trackJob.percent || 0)}%`;
      const progress = document.createElement('div'); progress.className = 'download-progress-track';
      const fill = document.createElement('span'); fill.style.width = `${trackJob.percent ?? (trackJob.status === 'done' ? 100 : 0)}%`; progress.append(fill);
      const message = document.createElement('small'); message.textContent = trackJob.message || 'Na fila';
      head.append(title, percent); row.append(head, progress, message); batch.append(row);
    }
    list.append(batch);
  }
}
async function ensureYtDlpConsent() {
  const existing = await window.isotopus.getDownloadConsent();
  if (existing === true) return true;
  if (ytDlpConsentKnown && existing === false) return false;
  const dialog = $('ytDlpConsentDialog');
  return new Promise(resolve => {
    let settled = false;
    const finish = async accepted => { if (settled) return; settled = true; ytDlpConsentKnown = true; await window.isotopus.setDownloadConsent(accepted); if (dialog.open) dialog.close(); resolve(accepted); };
    const onClose = () => { cleanup(); if (!settled) { settled = true; ytDlpConsentKnown = true; window.isotopus.setDownloadConsent(false); resolve(false); } };
    const cleanup = () => { dialog.removeEventListener('close', onClose); $('acceptYtDlp').removeEventListener('click', accept); $('declineYtDlp').removeEventListener('click', decline); };
    const accept = () => { cleanup(); finish(true); }, decline = () => { cleanup(); finish(false); };
    dialog.addEventListener('close', onClose, { once: true }); $('acceptYtDlp').addEventListener('click', accept, { once: true }); $('declineYtDlp').addEventListener('click', decline, { once: true }); dialog.showModal();
  });
}
async function enterDownloadsView() {
  const consent = await window.isotopus.getDownloadConsent();
  if (consent === null) { const accepted = await ensureYtDlpConsent(); if (!accepted) setDownloadStatus('Uso do yt-dlp não autorizado. Você pode autorizar ao tentar baixar.'); }
  if (consent === false && !ytDlpConsentKnown) await ensureYtDlpConsent();
  const ffmpeg = await window.isotopus.checkFfmpeg();
  $('ffmpegHint').textContent = ffmpeg.available ? 'FFmpeg encontrado · necessário para gerar MP3' : 'FFmpeg ausente · instale para converter em MP3';
  if (!folders.length) updateDownloadFolderOptions();
}
async function startAudioDownload() {
  if (await window.isotopus.getDownloadConsent() === false) ytDlpConsentKnown = false;
  if (!await ensureYtDlpConsent()) { setDownloadStatus('Sem autorização o Isótopus não instala nem executa o yt-dlp.'); return; }
  const url = $('downloadUrl').value.trim(); if (!url) { setDownloadStatus('Cole um link antes de iniciar.', true); $('downloadUrl').focus(); return; }
  if (!folders.length) { setDownloadStatus('Adicione primeiro uma pasta monitorada nas configurações.', true); return; }
  let parsed; try { parsed = new URL(url); } catch { setDownloadStatus('Cole um link HTTP ou HTTPS válido.', true); return; }
  const job = { title: `${parsed.hostname}${parsed.pathname}`.slice(0, 140), message: 'Analisando o link…', status: 'running', tracks: [] }; currentDownloadJob = job; downloadJobs.push(job); if (downloadJobs.length > 20) downloadJobs.shift(); renderDownloadJobs();
  $('downloadStartButton').disabled = true; setDownloadStatus('Download iniciado. Acompanhe o progresso das faixas no gerenciador no canto superior direito.');
  const result = await window.isotopus.downloadAudio({ url, folder: $('downloadFolder').value });
  $('downloadStartButton').disabled = folders.length === 0;
  if (result?.ok) { job.status = result.partial ? 'partial' : 'done'; job.message = result.playlistTruncated ? 'Limite de segurança: foram baixados apenas os primeiros 100 itens da playlist.' : result.partial ? `${result.errorCount} faixa(s) não puderam ser baixadas; as demais foram salvas.` : `Salvo em ${$('downloadFolder').value}`; setDownloadStatus(result.partial ? job.message : 'Download concluído. A pasta monitorada atualizará sua biblioteca automaticamente.', result.partial); $('downloadUrl').value = ''; }
  else if (result?.cancelled) { job.status = 'error'; job.message = 'Download cancelado.'; setDownloadStatus('Download cancelado.'); }
  else { job.status = 'error'; job.message = result?.error || 'O download falhou.'; setDownloadStatus(job.message, true); }
  for (const trackJob of job.tracks) if (trackJob.status === 'running' && result?.ok) { trackJob.status = 'done'; trackJob.percent = 100; }
  if (!job.tracks.length && result?.error) job.tracks.push({ title: 'Download', status: 'error', percent: 0, message: result.error });
  currentDownloadJob = null; renderDownloadJobs();
}
async function checkForAppUpdate() {
  const result = await window.isotopus.checkForUpdates();
  if (!result?.ok || !result.newer || store.get('dismissUpdate') === result.latest) return;
  updateRelease = result;
  $('updateBannerTitle').textContent = `Isótopus ${result.latest} disponível`;
  $('updateBannerHelp').textContent = result.installer ? `Para ${result.osFamily === 'arch' ? 'Arch Linux' : result.osFamily === 'debian' ? 'Ubuntu/Debian' : 'Windows'} · ${result.installer}` : 'Consulte as opções de instalação desta versão.';
  $('updateBanner').hidden = false;
}
function fmt(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
function prettySize(bytes) {
  if (!bytes) return '';
  const n = bytes / (1024 * 1024);
  return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n.toFixed(0)} MB`;
}
function qualityText(track) {
  if (track.lossless) {
    const depth = track.bitDepth ? ` · ${track.bitDepth}-bit` : '';
    const rate = track.sampleRate ? ` / ${(track.sampleRate / 1000).toFixed(track.sampleRate % 1000 ? 1 : 0)} kHz` : '';
    return `${track.codec}${depth}${rate}`;
  }
  return `${track.codec || 'ÁUDIO'}${track.bitrate ? ` · ${Math.round(track.bitrate / 1000)} kbps` : ''}`;
}
function setPlayIcon(button, playing) {
  button.innerHTML = playing
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM15 5h3v14h-3z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>';
  const label = playing ? 'Pausar' : 'Reproduzir';
  button.title = label; button.setAttribute('aria-label', label);
}
function setLibraryState() {
  const count = tracks.length;
  $('heroCard').hidden = folders.length > 0;
  $('connectionLabel').textContent = folders.length ? `${count} faixas · monitorando` : 'Nenhuma pasta monitorada';
  $('connectionLabel').previousElementSibling.classList.toggle('connected', Boolean(folders.length));
  $('libraryStatus').textContent = folders.length ? `${count} FAIXAS LOCAIS` : 'BIBLIOTECA LOCAL';
  $('trackCount').textContent = `${count} faixa${count === 1 ? '' : 's'}`;
  $('playlistCount').textContent = `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`;
  const favoriteCount = safeArray('favorites').length;
  $('favoriteCount').textContent = `${favoriteCount} favorita${favoriteCount === 1 ? '' : 's'}`;
}
function showCoverFallback(element) {
  element.classList.add('missing-cover');
  element.style.backgroundImage = 'none';
  element.replaceChildren();
  element.insertAdjacentHTML('afterbegin', '<svg class="cover-fallback" viewBox="0 0 512 512" aria-hidden="true" focusable="false"><rect class="fallback-paper" x="0" y="0" width="512" height="512" rx="72"/><circle class="fallback-disc" cx="256" cy="256" r="178"/><circle class="fallback-ring" cx="256" cy="256" r="134"/><circle class="fallback-center" cx="256" cy="256" r="84"/><circle class="fallback-hub" cx="256" cy="256" r="38"/><circle class="fallback-label" cx="256" cy="256" r="10"/><path class="fallback-groove" d="M128 357c36 29 80 45 128 45s92-16 128-45"/></svg>');
}
function coverStyle(track, element) {
  const source = typeof track?.coverUrl === 'string' ? track.coverUrl.trim() : '';
  element.style.removeProperty('background-image');
  const currentImage = element.querySelector('.cover-image');
  if (source && currentImage?.getAttribute('src') === source) { element.classList.remove('missing-cover'); return; }
  if (!source && element.classList.contains('missing-cover') && element.querySelector('.cover-fallback')) return;
  element.replaceChildren();
  if (!source) { showCoverFallback(element); return; }
  element.classList.remove('missing-cover');
  const image = document.createElement('img');
  image.className = 'cover-image'; image.alt = ''; image.draggable = false; image.decoding = 'async';
  const isPlayerCover = element.id === 'trackArt';
  image.loading = isPlayerCover ? 'eager' : 'lazy'; image.fetchPriority = isPlayerCover ? 'high' : 'low';
  image.addEventListener('error', () => {
    if (element.querySelector('.cover-image') === image) showCoverFallback(element);
  }, { once: true });
  element.append(image);
  image.src = source;
}
function renderFolderList() {
  const list = $('folderList'); list.replaceChildren();
  if (!folders.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state'; empty.innerHTML = '<strong>Nenhuma pasta escolhida</strong>Adicione uma pasta com sua coleção de áudio.'; list.append(empty); return;
  }
  folders.forEach(folder => {
    const row = document.createElement('div'); row.className = 'folder-row';
    const icon = document.createElement('span'); icon.textContent = '▤';
    const name = document.createElement('b'); name.textContent = folder; name.title = folder;
    const remove = document.createElement('button'); remove.className = 'folder-remove'; remove.type = 'button'; remove.textContent = 'Remover';
    remove.addEventListener('click', async () => applyLibrary(await window.isotopus.removeMusicFolder(folder)));
    row.append(icon, name, remove); list.append(row);
  });
}
function applyLibrary(result) {
  if (!result) return;
  if (result.tracks) tracks = result.tracks;
  if (result.folders) folders = result.folders;
  setLibraryState(); renderFolderList();
  if ($('searchInput').value.trim()) searchLibrary($('searchInput').value.trim());
  else if (activeView === 'listen') renderHome();
  else openView(activeView, false);
  renderCurrentTrack();
}
async function chooseFolders() {
  const result = await window.isotopus.chooseMusicFolder();
  if (result?.cancelled) return;
  applyLibrary(result); toast(`${tracks.length} faixas encontradas.`);
}
function renderHome() {
  const recents = safeArray('recentIds').map(id => tracks.find(track => track.id === id)).filter(Boolean).slice(0, 6);
  const newest = [...tracks].sort((a, b) => b.modified - a.modified).slice(0, 6);
  const items = recents.length ? recents : newest;
  const grid = $('recentGrid'); grid.replaceChildren();
  renderLosslessHome();
  $('homeListening').hidden = tracks.length === 0;
  $('homeTrackCount').textContent = String(tracks.length);
  $('homeListeningCaption').textContent = `${tracks.length} faixa${tracks.length === 1 ? '' : 's'} disponível${tracks.length === 1 ? '' : 'is'} na sua biblioteca.`;
  $('recentHeading').textContent = recents.length ? 'Tocadas recentemente' : 'Adicionadas recentemente';
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'home-empty';
    empty.innerHTML = '<span class="home-empty-mark">♫</span><div><b>Seu próximo som começa aqui</b><small>Escolha uma pasta de músicas e suas capas aparecerão neste espaço.</small></div>';
    const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = 'Escolher pasta'; button.addEventListener('click', chooseFolders); empty.append(button); grid.append(empty);
  } else items.forEach(track => grid.append(createTrackCard(track, items, 'track')));
  const albumGrid = $('albumHighlightsGrid'); albumGrid.replaceChildren();
  const albumGroups = groupsForAlbums(tracks).sort((a, b) => b.count - a.count).slice(0, 6);
  $('albumHighlightsSection').hidden = !albumGroups.length;
  albumGroups.forEach(item => albumGrid.append(createTrackCard(item, albumGroups, 'album')));
  const artistGrid = $('artistHighlightsGrid'); artistGrid.replaceChildren();
  const artistGroups = groupsForArtists(tracks).sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 6);
  $('artistHighlightsSection').hidden = !artistGroups.length;
  artistGroups.forEach(item => artistGrid.append(createTrackCard(item, artistGroups, 'artist')));
  const favoriteTracks = safeArray('favorites').map(id => tracks.find(track => track.id === id)).filter(Boolean).slice(0, 6);
  const favoriteGrid = $('favoritesHomeGrid'); favoriteGrid.replaceChildren();
  $('favoritesHomeEmpty').hidden = favoriteTracks.length > 0;
  favoriteTracks.forEach(track => favoriteGrid.append(createTrackCard(track, favoriteTracks, 'track')));
  renderRecommendations();
}
function renderRecommendations() {
  let section = $('recommendationsSection');
  if (!section) { section = document.createElement('section'); section.id = 'recommendationsSection'; section.className = 'section-block'; $('content').append(section); }
  section.hidden = activeView !== 'listen' || !tracks.length; section.replaceChildren(); if (!tracks.length) return;
  const header = document.createElement('div'); header.className = 'section-heading'; const title = document.createElement('div'); const kicker = document.createElement('div'); kicker.className = 'section-kicker'; kicker.textContent = 'DESCOBERTAS NA SUA BIBLIOTECA'; const heading = document.createElement('h3');
  const completed = listeningStats.sessions.filter(item => item.completed); const artistCounts = new Map(), genreCounts = new Map(); completed.forEach(item => { if (item.artist) artistCounts.set(item.artist, (artistCounts.get(item.artist) || 0) + 1); if (item.genre) genreCounts.set(item.genre, (genreCounts.get(item.genre) || 0) + 1); });
  const favoriteArtist = [...artistCounts].sort((a, b) => b[1] - a[1])[0]?.[0], favoriteGenre = [...genreCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  heading.textContent = favoriteArtist || favoriteGenre ? 'Talvez você goste' : 'Continue explorando'; title.append(kicker, heading); const note = document.createElement('small'); note.className = 'section-note'; note.textContent = favoriteArtist || favoriteGenre ? 'Sugestões relacionadas ao histórico local' : 'Faixas ainda não ouvidas na sua biblioteca'; header.append(title, note); section.append(header);
  const recent = new Set(safeArray('recentIds').slice(0, 12)); const candidates = tracks.filter(track => !recent.has(track.id)).map(track => ({ track, score: (favoriteArtist && track.artist === favoriteArtist ? 3 : 0) + (favoriteGenre && normalizeSearch(track.genre).includes(normalizeSearch(favoriteGenre)) ? 2 : 0) - statsForTrack(track.id) }));
  candidates.sort((a, b) => b.score - a.score || (b.track.modified || 0) - (a.track.modified || 0)); const picks = candidates.slice(0, 6).map(item => item.track);
  const grid = document.createElement('div'); grid.className = 'results-grid'; picks.forEach(track => grid.append(createTrackCard(track, picks, 'track'))); section.append(grid);
}
function renderLosslessHome() {
  const grid = $('losslessGrid'); grid.replaceChildren();
  const flacTracks = tracks.filter(track => /FLAC/i.test(track.codec || ''));
  $('losslessEmpty').hidden = flacTracks.length > 0;
  if (!flacTracks.length) return;
  flacTracks.slice(0, 6).forEach(track => grid.append(createTrackCard(track, flacTracks, 'track')));
}
function groupsForAlbums(items) {
  const groups = new Map();
  for (const track of items) {
    const key = `${track.albumArtist || track.artist}|${track.album}`;
    if (!groups.has(key)) groups.set(key, { title: track.album, artist: track.albumArtist || track.artist, tracks: [], coverUrl: track.coverUrl, kind: 'album' });
    const group = groups.get(key);
    if (!group.coverUrl && track.coverUrl) group.coverUrl = track.coverUrl;
    group.tracks.push(track);
  }
  return [...groups.values()].map(group => ({ ...group, tracks: group.tracks.sort((a, b) => (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 0) - (b.trackNo || 0)), count: group.tracks.length }));
}
function groupsForArtists(items) {
  const groups = new Map();
  for (const track of items) {
    const name = track.artist || 'Artista desconhecido';
    if (!groups.has(name)) groups.set(name, { title: name, artist: '', coverUrl: track.coverUrl, kind: 'artist', tracks: [] });
    const group = groups.get(name);
    if (!group.coverUrl && track.coverUrl) group.coverUrl = track.coverUrl;
    group.tracks.push(track);
  }
  return [...groups.values()].map(group => ({ ...group, artist: `${group.tracks.length} faixas` })).sort((a, b) => a.title.localeCompare(b.title));
}
function collectTracks(items) {
  const seen = new Set(), result = [];
  for (const item of items || []) for (const track of item.tracks || [item]) {
    if (track?.id && track.streamUrl && !seen.has(track.id)) { seen.add(track.id); result.push(track); }
  }
  return result;
}
function toggleFavorite(track) {
  const favorites = new Set(safeArray('favorites'));
  const added = !favorites.has(track.id);
  added ? favorites.add(track.id) : favorites.delete(track.id);
  store.set('favorites', JSON.stringify([...favorites]));
  if (currentTrack?.id === track.id) renderCurrentTrack();
  $('favoriteCount').textContent = `${favorites.size} favorita${favorites.size === 1 ? '' : 's'}`;
  if (activeView === 'favorites') openView('favorites');
  else if (activeView === 'listen') renderHome();
  else if (activeView !== 'downloads') openView(activeView, false);
  toast(added ? `“${track.title}” adicionada às favoritas.` : `“${track.title}” removida das favoritas.`);
}
function renderStatisticsPage(period = $('statsPeriod')?.dataset.value || 'all') {
  const sessions = sessionsForPeriod(period), completed = sessions.filter(item => item.completed);
  let root = $('dynamicResults'); if (!root) { root = document.createElement('section'); root.id = 'dynamicResults'; root.className = 'section-block'; $('content').append(root); }
  root.replaceChildren(); visibleTracks = [];
  const toolbar = document.createElement('div'); toolbar.className = 'stats-toolbar'; const caption = document.createElement('p'); caption.textContent = 'Dados locais baseados no tempo real de reprodução neste dispositivo.';
  const select = createStyledSelect('statsPeriod', 'Período das estatísticas', [['all', 'Todo o período'], ['30', 'Últimos 30 dias'], ['365', 'Últimos 12 meses']], period);
  toolbar.append(caption, select); root.append(toolbar); bindStyledSelect('statsPeriod', selected => renderStatisticsPage(selected));
  const countBy = key => { const counts = new Map(); for (const item of completed) { const value = item[key] || 'Desconhecido'; counts.set(value, (counts.get(value) || 0) + 1); } return [...counts].sort((a, b) => b[1] - a[1]); };
  const topArtists = countBy('artist'), topAlbums = countBy('album'), topTracks = countBy('title'), topGenres = countBy('genre'); const seconds = sessions.reduce((sum, item) => sum + (Number(item.seconds) || 0), 0);
  const cards = document.createElement('div'); cards.className = 'stats-summary-grid';
  for (const [label, value] of [['Tempo ouvido', `${(seconds / 3600).toFixed(1)} h`], ['Reproduções qualificadas', String(completed.length)], ['Artista mais ouvido', topArtists[0]?.[0] || '—'], ['Faixa mais reproduzida', topTracks[0]?.[0] || '—'], ['Álbum mais ouvido', topAlbums[0]?.[0] || '—'], ['Gênero predominante', topGenres[0]?.[0] || '—']]) { const card = document.createElement('article'); card.className = 'stats-metric'; const small = document.createElement('small'); small.textContent = label; const strong = document.createElement('b'); strong.textContent = value; card.append(small, strong); cards.append(card); } root.append(cards);
  const monthCounts = new Map(); for (const session of sessions) { const date = new Date(Number(session.startedAt)); if (!Number.isFinite(date.getTime())) continue; const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; monthCounts.set(key, (monthCounts.get(key) || 0) + (Number(session.seconds) || 0)); }
  const months = [...monthCounts].sort((a, b) => a[0].localeCompare(b[0])).slice(-12), max = Math.max(1, ...months.map(item => item[1]));
  const panel = document.createElement('section'); panel.className = 'stats-chart-panel'; const heading = document.createElement('h3'); heading.textContent = 'Tempo de reprodução por mês'; panel.append(heading);
  if (!months.length) { const empty = document.createElement('p'); empty.className = 'field-help'; empty.textContent = 'As estatísticas aparecem conforme você ouve. Uma reprodução conta após metade da faixa ou 30 segundos.'; panel.append(empty); }
  else { const chart = document.createElement('div'); chart.className = 'stats-month-chart'; chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', 'Tempo ouvido por mês'); for (const [month, value] of months) { const column = document.createElement('div'); column.className = 'stats-month-column'; const bar = document.createElement('span'); bar.style.height = `${Math.max(3, value / max * 100)}%`; bar.title = `${month}: ${(value / 3600).toFixed(1)} horas`; const label = document.createElement('small'); label.textContent = month.slice(5); column.append(bar, label); chart.append(column); } panel.append(chart); }
  root.append(panel);
  for (const [labelText, rows] of [['Artistas mais ouvidos', topArtists], ['Gêneros mais ouvidos', topGenres]]) { const ranking = document.createElement('section'); ranking.className = 'stats-chart-panel stats-ranking'; const title = document.createElement('h3'); title.textContent = labelText; ranking.append(title); if (!rows.length) { const empty = document.createElement('p'); empty.className = 'field-help'; empty.textContent = 'Ainda não há reproduções suficientes.'; ranking.append(empty); } rows.slice(0, 5).forEach(([name, amount]) => { const row = document.createElement('div'); row.className = 'stats-ranking-row'; const text = document.createElement('span'); text.textContent = name; const count = document.createElement('b'); count.textContent = String(amount); row.append(text, count); ranking.append(row); }); root.append(ranking); }
}
function renderSmartFolders(view = 'smart') {
  let root = $('dynamicResults'); if (!root) { root = document.createElement('section'); root.id = 'dynamicResults'; root.className = 'section-block'; $('content').append(root); }
  root.replaceChildren(); visibleTracks = [];
  if (view.startsWith('smart:')) {
    const folder = smartFolders.find(item => item.id === view.slice(6)); if (!folder) return openView('smart');
    const items = tracks.filter(track => matchesSmartFolder(track, folder)); const toolbar = document.createElement('div'); toolbar.className = 'queue-toolbar'; const count = document.createElement('span'); count.textContent = `${items.length} faixas correspondem aos critérios salvos.`;
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary-button'; edit.textContent = 'Editar critérios'; edit.addEventListener('click', () => openSmartFolderDialog(folder.id));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'secondary-button'; del.textContent = 'Excluir coleção'; del.addEventListener('click', () => { smartFolders = smartFolders.filter(item => item.id !== folder.id); store.set('smartFolders', JSON.stringify(smartFolders)); openView('smart'); }); toolbar.append(count, edit, del);
    renderCards(items, 'Nenhuma faixa corresponde atualmente; a coleção será atualizada conforme a biblioteca mudar.'); $('dynamicResults').prepend(toolbar); return;
  }
  const toolbar = document.createElement('div'); toolbar.className = 'queue-toolbar'; const description = document.createElement('span'); description.textContent = 'Coleções dinâmicas: os arquivos permanecem no lugar e os resultados acompanham sua biblioteca.';
  const create = document.createElement('button'); create.type = 'button'; create.className = 'primary-button'; create.textContent = 'Nova pasta inteligente'; create.addEventListener('click', () => openSmartFolderDialog()); toolbar.append(description, create); root.append(toolbar);
  if (!smartFolders.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'Crie coleções por artista, álbum, gênero, ano ou reproduções.'; root.append(empty); return; }
  const grid = document.createElement('div'); grid.className = 'smart-folder-grid';
  for (const folder of smartFolders) { const card = document.createElement('article'); card.className = 'smart-folder-card'; const open = document.createElement('button'); open.type = 'button'; open.className = 'smart-folder-open'; const label = document.createElement('b'); label.textContent = folder.name; const count = tracks.filter(track => matchesSmartFolder(track, folder)).length; const detail = document.createElement('small'); detail.textContent = `${count} faixas · ${folder.rules.map(rule => `${rule.field} ${rule.op} ${rule.value}`).join(' e ')}`; open.append(label, detail); open.addEventListener('click', () => openView(`smart:${folder.id}`)); const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary-button'; edit.textContent = 'Editar'; edit.addEventListener('click', () => openSmartFolderDialog(folder.id)); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary-button'; remove.textContent = 'Excluir'; remove.addEventListener('click', () => { smartFolders = smartFolders.filter(item => item.id !== folder.id); store.set('smartFolders', JSON.stringify(smartFolders)); renderSmartFolders(); }); card.append(open, edit, remove); grid.append(card); } root.append(grid);
}
function openSmartFolderDialog(id = '') {
  const folder = smartFolders.find(item => item.id === id); smartFolderEditingId = id;
  $('smartFolderName').value = folder?.name || ''; $('smartRuleField').value = folder?.rules[0]?.field || 'genre'; $('smartRuleOp').value = folder?.rules[0]?.op || 'contains'; $('smartRuleValue').value = folder?.rules[0]?.value || '';
  $('smartRule2Field').value = folder?.rules[1]?.field || ''; $('smartRule2Op').value = folder?.rules[1]?.op || 'contains'; $('smartRule2Value').value = folder?.rules[1]?.value || '';
  $('smartFolderDialogTitle').textContent = folder ? 'Editar pasta inteligente' : 'Nova pasta inteligente'; $('smartFolderDialog').showModal();
}
function saveSmartFolder() {
  const name = $('smartFolderName').value.trim(); if (!name) return toast('Dê um nome para a coleção.');
  const allowed = ['genre', 'artist', 'album', 'year', 'plays'];
  const fields = [[$('smartRuleField').value, $('smartRuleOp').value, $('smartRuleValue').value.trim()], [$('smartRule2Field').value, $('smartRule2Op').value, $('smartRule2Value').value.trim()]].filter(item => item[0] && item[2]);
  if (!fields.length || fields.some(([field, , value]) => !allowed.includes(field) || !value || (['year', 'plays'].includes(field) && !Number.isFinite(Number(value))))) return toast('Preencha ao menos uma regra válida.');
  const folder = { id: smartFolderEditingId || globalThis.crypto?.randomUUID?.() || `smart-${Date.now()}`, name: name.slice(0, 80), rules: fields.map(([field, op, value]) => ({ field, op: field === 'year' || field === 'plays' ? 'gte' : op === 'equals' ? 'equals' : 'contains', value: value.slice(0, 160) })) };
  if (smartFolderEditingId) smartFolders = smartFolders.map(item => item.id === smartFolderEditingId ? folder : item); else smartFolders.unshift(folder);
  store.set('smartFolders', JSON.stringify(smartFolders)); smartFolderEditingId = ''; $('smartFolderDialog').close(); openView('smart', false);
}
function renderAboutPage() {
  let root = $('dynamicResults'); if (!root) { root = document.createElement('section'); root.id = 'dynamicResults'; root.className = 'section-block about-page'; $('content').append(root); }
  root.replaceChildren(); visibleTracks = [];
  const title = document.createElement('h2'); title.textContent = 'Música local, no seu ritmo.';
  const manifesto = document.createElement('blockquote'); manifesto.textContent = 'O Isótopus nasceu da ideia de que a música deve pertencer a quem a escuta. Uma biblioteca musical livre, local e pessoal, sem dependência de plataformas, assinaturas ou serviços externos. Sua música, seu computador, sua experiência.';
  const info = document.createElement('dl'); const rows = [['Versão', '0.2.8'], ['Tecnologias', 'Electron · music-metadata · @huggingface/transformers'], ['Projeto', 'mrts-wx/isotopus'], ['Licença', 'MIT — consulte o arquivo LICENSE no repositório. Dependências de terceiros mantêm suas próprias licenças.'], ['Créditos', 'Criado por omartinss · Desenvolvimento assistido por Codex (OpenAI). Projeto independente, sem afiliação ou endosso da OpenAI.']];
  rows.forEach(([term, value]) => { const dt = document.createElement('dt'); dt.textContent = term; const dd = document.createElement('dd'); dd.textContent = value; info.append(dt, dd); });
  const link = document.createElement('a'); link.href = 'https://github.com/mrts-wx/isotopus'; link.textContent = 'Repositório oficial no GitHub'; link.target = '_blank'; link.rel = 'noreferrer'; root.append(title, manifesto, info, link);
}
function enqueueNext(track) {
  if (currentTrack?.id === track.id) return toast('Essa faixa já está tocando.');
  queue = queue.filter(item => item.id !== track.id);
  if (!currentTrack) { queue.push(track); queueIndex = -1; }
  else {
    let currentIndex = queue.findIndex(item => item.id === currentTrack.id);
    if (currentIndex < 0) { queue.unshift(currentTrack); currentIndex = 0; }
    queue.splice(currentIndex + 1, 0, track); queueIndex = currentIndex;
  }
  renderQueuePopover();
  toast(`“${track.title}” será a próxima faixa.`);
}
function appendToQueue(items) {
  const additions = collectTracks(items).filter(item => !queue.some(existing => existing.id === item.id));
  if (!additions.length) return toast('Essas músicas já estão na fila.');
  if (currentTrack && !queue.some(item => item.id === currentTrack.id)) {
    queue.unshift(currentTrack);
    if (queueIndex >= 0) queueIndex++;
  }
  queue.push(...additions);
  if (!currentTrack && queueIndex < 0) queueIndex = 0;
  renderQueuePopover();
  toast(`${additions.length} faixa${additions.length === 1 ? '' : 's'} adicionada${additions.length === 1 ? '' : 's'} ao fim da fila.`);
}
function requestTrackDeletion(track) {
  trackDeletePendingId = track.id;
  $('deleteTrackName').textContent = track.title;
  $('deleteTrackDialog').showModal();
}
function closeTrackActionMenu(menu) {
  const trigger = menu?._triggerButton;
  menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  menu.classList.remove('opens-up');
  menu.style.cssText = '';
  if (menu?._trackActions?.isConnected && menu.parentElement !== menu._trackActions) menu._trackActions.append(menu);
  else if (!menu?._trackActions?.isConnected) menu.remove();
}
function positionTrackActionMenu(menu, trigger) {
  const margin = 10;
  const anchor = trigger.getBoundingClientRect();
  const width = menu.getBoundingClientRect().width;
  const height = menu.getBoundingClientRect().height;
  const spaceBelow = innerHeight - anchor.bottom - margin * 2;
  const spaceAbove = anchor.top - margin * 2;
  const opensUp = spaceBelow < height && spaceAbove > spaceBelow;
  const availableHeight = Math.max(100, opensUp ? spaceAbove : spaceBelow);
  const top = opensUp
    ? Math.max(margin, anchor.top - Math.min(height, availableHeight) - 6)
    : Math.min(innerHeight - margin - Math.min(height, availableHeight), anchor.bottom + 6);
  const left = Math.max(margin, Math.min(anchor.right - width, innerWidth - width - margin));
  menu.classList.toggle('opens-up', opensUp);
  menu.style.position = 'fixed';
  menu.style.left = `${left}px`;
  menu.style.right = 'auto';
  menu.style.top = `${top}px`;
  menu.style.bottom = 'auto';
  menu.style.maxHeight = `${availableHeight}px`;
  menu.style.overflowY = 'auto';
}
function createTrackCard(item, items, kind) {
  const card = document.createElement('article'); card.className = 'result-card';
  const main = document.createElement('button'); main.className = 'result-main'; main.type = 'button';
  const art = document.createElement('span'); art.className = 'result-art'; coverStyle(item, art);
  const copy = document.createElement('span'); copy.className = 'result-copy';
  const title = document.createElement('b'); title.textContent = item.title;
  const subtitle = document.createElement('small'); subtitle.textContent = item.artist || item.album || '';
  copy.append(title, subtitle);
  if (kind === 'track' || kind === 'playlist-track') {
    const meta = document.createElement('span'); meta.className = 'track-info';
    const quality = document.createElement('span'); quality.className = `quality-badge${item.lossless ? '' : ' compressed'}`; quality.textContent = item.lossless ? 'LOSSLESS' : 'COMPRESSED';
    const duration = document.createElement('small'); duration.textContent = fmt(item.duration);
    meta.append(quality, duration); copy.append(meta);
  } else {
    const extra = document.createElement('small'); extra.textContent = item.kind === 'album' ? `${item.count} faixas` : `${item.tracks?.length || 0} faixas`; extra.className = 'folder-count'; copy.append(extra);
  }
  main.append(art, copy);
  if (item.id === currentTrack?.id || item.tracks?.some(track => track.id === currentTrack?.id)) card.classList.add('playing-card');
  main.addEventListener('click', () => {
    if (item.kind === 'playlist') openView(`playlist:${item.id}`);
    else if (item.kind === 'album' || item.kind === 'artist') playCollection(item.tracks);
    else if (item.kind === 'folder') showSettings();
    else playTrack(item, items);
  });
  card.append(main);
  if (item.kind === 'playlist') {
    const actions = document.createElement('div'); actions.className = 'playlist-manage-actions';
    const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'playlist-manage-button'; rename.textContent = '✎'; rename.title = 'Renomear playlist'; rename.setAttribute('aria-label', `Renomear playlist ${item.title}`);
    rename.addEventListener('click', event => { event.stopPropagation(); openPlaylistDialog(item.tracks.map(track => track.id), item.id); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'playlist-manage-button delete'; remove.textContent = '×'; remove.title = 'Excluir playlist'; remove.setAttribute('aria-label', `Excluir playlist ${item.title}`);
    remove.addEventListener('click', event => { event.stopPropagation(); playlistDeletePendingId = item.id; $('deletePlaylistName').textContent = item.title; $('deletePlaylistDialog').showModal(); });
    actions.append(rename, remove); card.append(actions);
  }
  if (item.kind === 'album' || item.kind === 'artist' || item.kind === 'playlist') {
    const add = document.createElement('button'); add.type = 'button'; add.className = 'collection-queue-button'; add.textContent = '＋ Fila'; add.title = 'Adicionar coleção ao fim da fila';
    add.addEventListener('click', event => { event.stopPropagation(); appendToQueue(item.tracks); }); card.append(add);
  }
  if ((kind === 'track' || kind === 'playlist-track') && item.id) {
    card.classList.add('has-track-actions');
    const inPlaylist = kind === 'playlist-track' || activeView.startsWith('playlist:');
    const actions = document.createElement('div'); actions.className = 'track-actions';
    if (kind === 'playlist-track' && inPlaylist) {
      const playlist = playlists.find(entry => entry.id === activeView.slice('playlist:'.length));
      const index = playlist?.trackIds.indexOf(item.id) ?? -1;
      const move = (delta, label, symbol) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'playlist-order-button'; button.textContent = symbol; button.title = label; button.setAttribute('aria-label', `${label}: ${item.title}`); button.disabled = !playlist || index < 0 || index + delta < 0 || index + delta >= playlist.trackIds.length;
        button.addEventListener('click', event => { event.stopPropagation(); if (!playlist || button.disabled) return; const other = index + delta; [playlist.trackIds[index], playlist.trackIds[other]] = [playlist.trackIds[other], playlist.trackIds[index]]; savePlaylists(); openView(activeView, false); });
        return button;
      };
      actions.append(move(-1, 'Mover para cima', '↑'), move(1, 'Mover para baixo', '↓'));
    }
    const menuButton = document.createElement('button'); menuButton.type = 'button'; menuButton.className = 'track-menu-button'; menuButton.innerHTML = '<span aria-hidden="true">☰</span>'; menuButton.title = 'Mais opções'; menuButton.setAttribute('aria-label', `Mais opções para ${item.title}`); menuButton.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div'); menu.className = 'track-action-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
    menu._triggerButton = menuButton; menu._trackActions = actions;
    const addAction = (label, symbol, handler, danger = false) => { const button = document.createElement('button'); button.type = 'button'; button.className = danger ? 'track-action-option danger' : 'track-action-option'; button.setAttribute('role', 'menuitem'); button.innerHTML = `<span aria-hidden="true">${symbol}</span><b>${label}</b>`; button.addEventListener('click', event => { event.stopPropagation(); closeTrackActionMenu(menu); handler(); }); menu.append(button); };
    if (inPlaylist) addAction('Remover desta playlist', '−', () => { const playlist = playlists.find(entry => entry.id === activeView.slice('playlist:'.length)); if (playlist) { playlist.trackIds = playlist.trackIds.filter(id => id !== item.id); savePlaylists(); openView(activeView, false); toast('Faixa removida da playlist.'); } });
    else addAction('Adicionar à playlist', '＋', () => openPlaylistPicker(item));
    addAction(safeArray('favorites').includes(item.id) ? 'Remover das favoritas' : 'Adicionar às favoritas', '♡', () => toggleFavorite(item));
    addAction('Adicionar à fila como próxima', '⇥', () => enqueueNext(item));
    addAction('Excluir arquivo do computador', '⌫', () => requestTrackDeletion(item), true);
    menuButton.addEventListener('click', event => {
      event.stopPropagation(); const opening = menu.hidden;
      document.querySelectorAll('.track-action-menu:not([hidden])').forEach(closeTrackActionMenu);
      if (!opening) return;
      document.body.append(menu);
      menu.hidden = false;
      menuButton.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => positionTrackActionMenu(menu, menuButton));
    });
    actions.append(menuButton, menu); card.append(actions);
  }
  return card;
}
function renderCards(items, emptyMessage, kind = 'track') {
  let results = $('dynamicResults');
  if (!results) { results = document.createElement('section'); results.id = 'dynamicResults'; results.className = 'section-block'; $('content').append(results); }
  results.replaceChildren();
  visibleTracks = items;
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    const strong = document.createElement('strong'); strong.textContent = activeView === 'playlists' ? 'Nenhuma playlist ainda' : folders.length ? 'Nada por aqui ainda' : 'Sua biblioteca começa aqui';
    const copy = document.createElement('div'); copy.textContent = emptyMessage;
    empty.append(strong, copy);
    if (!folders.length && !['playlists', 'queue'].includes(activeView) && !activeView.startsWith('playlist:')) { const button = document.createElement('button'); button.className = 'primary-button'; button.textContent = 'Escolher pasta'; button.addEventListener('click', chooseFolders); empty.append(button); }
    results.append(empty); return;
  }
  const grid = document.createElement('div'); grid.className = kind === 'queue' ? 'results-grid queue-list' : 'results-grid';
  let offset = 0;
  results.append(grid);
  installDockMagnification(grid);
  const playlistTracks = collectTracks(items);
  if (playlistTracks.length && kind === 'track' && activeView !== 'folders') {
    const toolbar = document.createElement('div'); toolbar.className = 'queue-toolbar playlist-create-toolbar';
    const label = document.createElement('span'); label.textContent = `${playlistTracks.length} faixas nesta seleção`;
    const create = document.createElement('button'); create.type = 'button'; create.className = 'secondary-button'; create.textContent = 'Criar playlist';
    create.addEventListener('click', () => openPlaylistDialog(playlistTracks.map(track => track.id)));
    toolbar.append(label, create); results.prepend(toolbar);
  }
  const renderBatch = () => {
    const end = Math.min(offset + PAGE_SIZE, items.length);
    for (; offset < end; offset++) grid.append(createTrackCard(items[offset], items, kind));
    results.querySelector('.load-more')?.remove();
    if (offset < items.length) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'load-more';
      more.textContent = `Mostrar mais · ${items.length - offset} restantes`;
      more.addEventListener('click', renderBatch, { once: true }); results.append(more);
    }
  };
  renderBatch();
}
function installDockMagnification(grid) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let active = null;
  let releaseTimer;
  const clearNeighbors = () => grid.querySelectorAll('.dock-neighbor').forEach(card => card.classList.remove('dock-neighbor'));
  const clearAll = () => {
    clearTimeout(releaseTimer); clearNeighbors(); active?.classList.remove('dock-hover'); active = null;
  };
  grid.addEventListener('pointermove', event => {
    const card = event.target.closest?.('.result-card');
    if (!card || card.parentElement !== grid) {
      clearTimeout(releaseTimer); releaseTimer = setTimeout(() => { clearNeighbors(); active?.classList.remove('dock-hover'); active = null; }, 120); return;
    }
    if (active !== card) { active?.classList.remove('dock-hover'); clearNeighbors(); active = card; active.classList.add('dock-hover'); }
    clearNeighbors();
    const rect = card.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
    let left = null, right = null, leftDistance = Infinity, rightDistance = Infinity;
    for (const neighbor of grid.querySelectorAll(':scope > .result-card')) {
      if (neighbor === card) continue;
      const box = neighbor.getBoundingClientRect();
      if (Math.abs((box.top + box.height / 2) - centerY) > Math.max(24, rect.height * .22)) continue;
      const x = box.left + box.width / 2;
      if (x < centerX && centerX - x < leftDistance) { left = neighbor; leftDistance = centerX - x; }
      if (x > centerX && x - centerX < rightDistance) { right = neighbor; rightDistance = x - centerX; }
    }
    left?.classList.add('dock-neighbor'); right?.classList.add('dock-neighbor');
    clearTimeout(releaseTimer); releaseTimer = setTimeout(clearNeighbors, 180);
  });
  grid.addEventListener('pointerleave', clearAll);
}
function playlistTracks(playlist) {
  const index = new Map(tracks.map(track => [track.id, track]));
  return playlist.trackIds.map(id => index.get(id)).filter(Boolean);
}
function savePlaylists() { store.set('playlists', JSON.stringify(playlists)); }
function openPlaylistDialog(trackIds = [], editId = '') {
  playlistEditingId = editId;
  playlistDraftIds = [...new Set(trackIds)];
  const existing = playlists.find(item => item.id === editId);
  $('playlistDialogTitle').textContent = existing ? 'Renomear playlist' : 'Nova playlist';
  $('savePlaylist').textContent = existing ? 'Salvar alterações' : 'Criar playlist';
  $('playlistName').value = existing?.name || '';
  $('playlistDraftCount').textContent = existing ? `${playlistDraftIds.length} faixas nesta playlist.` : playlistDraftIds.length ? `${playlistDraftIds.length} faixas serão adicionadas à playlist.` : 'Playlist vazia. Você poderá adicionar faixas depois.';
  $('playlistDialog').showModal(); $('playlistName').focus();
}
function openPlaylistPicker(track) {
  playlistPendingTrackId = track.id;
  const list = $('playlistPickerList'); list.replaceChildren();
  if (!playlists.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'Crie uma playlist para organizar esta faixa.'; list.append(empty);
  }
  for (const playlist of playlists) {
    const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'playlist-choice';
    choice.textContent = `${playlist.name} · ${playlist.trackIds.length} faixas`;
    choice.addEventListener('click', () => {
      if (!playlist.trackIds.includes(track.id)) { playlist.trackIds.push(track.id); savePlaylists(); toast(`Adicionada a “${playlist.name}”.`); }
      else toast('Esta faixa já está na playlist.');
      $('playlistPickerDialog').close();
    });
    list.append(choice);
  }
  $('playlistPickerDialog').showModal();
}
function renderPlaylistCollection() {
  const items = playlists.map(playlist => {
    const list = playlistTracks(playlist);
    return { id: playlist.id, title: playlist.name, artist: `${list.length} faixas`, kind: 'playlist', tracks: list, coverUrl: list.find(track => track.coverUrl)?.coverUrl || '' };
  });
  renderCards(items, 'Crie playlists para agrupar as faixas que combinam.', 'playlist');
  const results = $('dynamicResults');
  if (!results) return;
  const toolbar = document.createElement('div'); toolbar.className = 'queue-toolbar playlist-create-toolbar';
  const label = document.createElement('span'); label.textContent = `${playlists.length} playlists · edite ou exclua pelos botões de cada cartão`;
  const create = document.createElement('button'); create.type = 'button'; create.className = 'secondary-button'; create.textContent = 'Nova playlist';
  create.addEventListener('click', () => openPlaylistDialog());
  toolbar.append(label, create); results.prepend(toolbar);
}
function renderPlaylistPlaybackControls(items) {
  if (!items.length) return;
  const results = $('dynamicResults');
  if (!results) return;
  const toolbar = document.createElement('div'); toolbar.className = 'queue-toolbar playlist-playback-toolbar';
  const label = document.createElement('span'); label.textContent = `${items.length} faixas nesta playlist`;
  const actions = document.createElement('div'); actions.className = 'playlist-playback-actions';
  const play = document.createElement('button'); play.type = 'button'; play.className = 'primary-button'; play.textContent = '▶  Reproduzir';
  play.addEventListener('click', () => playCollection(items, { shuffle: false }));
  const random = document.createElement('button'); random.type = 'button'; random.className = 'secondary-button'; random.textContent = '⤨  Aleatório';
  random.addEventListener('click', () => playCollection(items, { shuffle: true }));
  actions.append(play, random); toolbar.append(label, actions); results.prepend(toolbar);
}
function removeDynamic() { $('dynamicResults')?.remove(); }
function setPageHeading(view) {
  if (view === 'downloads') { $('pageTitle').textContent = 'Baixar música.'; $('pageSubtitle').textContent = 'Encontre novos sons para sua coleção local.'; return; }
  if (view === 'statistics') { $('pageTitle').textContent = 'Estatísticas.'; $('pageSubtitle').textContent = 'Seu histórico musical, calculado e mantido neste computador.'; return; }
  if (view === 'about') { $('pageTitle').textContent = 'Sobre o Isótopus.'; $('pageSubtitle').textContent = 'Um player local feito para a sua coleção.'; return; }
  if (view === 'smart') { $('pageTitle').textContent = 'Pastas inteligentes.'; $('pageSubtitle').textContent = 'Coleções que se atualizam com regras e dados da biblioteca.'; return; }
  const playlist = view.startsWith('playlist:') ? playlists.find(item => item.id === view.slice('playlist:'.length)) : null;
  const smartFolder = view.startsWith('smart:') ? smartFolders.find(item => item.id === view.slice(6)) : null;
  const title = smartFolder?.name || playlist?.name || titles[view] || 'Sua biblioteca';
  $('pageTitle').textContent = `${title}.`;
  $('pageSubtitle').textContent = smartFolder ? 'Coleção dinâmica atualizada a partir da biblioteca local.' : playlist ? `${playlist.trackIds.length} faixas nesta playlist.` : view === 'listen' ? 'Um espaço feito para ouvir com atenção.' : `${tracks.length} faixas disponíveis na sua coleção.`;
}
function openView(view, setSelected = true) {
  activeView = view;
  const navView = view.startsWith('playlist:') ? 'playlists' : view.startsWith('smart:') ? 'smart' : view;
  if (setSelected) document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('selected', el.dataset.view === navView));
  requestAnimationFrame(syncNavIndicator);
  syncTransportStates();
  setPageHeading(view);
  $('downloadsView').hidden = view !== 'downloads';
  $('heroCard').hidden = view !== 'listen' || folders.length > 0;
  $('homeListening').hidden = view !== 'listen' || tracks.length === 0;
  $('quickSection').hidden = view !== 'listen'; $('catalogSection').hidden = view !== 'listen'; $('recentSection').hidden = view !== 'listen';
  $('favoritesHomeSection').hidden = view !== 'listen';
  if ($('recommendationsSection')) $('recommendationsSection').hidden = view !== 'listen';
  $('albumHighlightsSection').hidden = view !== 'listen' || !tracks.length; $('artistHighlightsSection').hidden = view !== 'listen' || !tracks.length;
  removeDynamic();
  if (view === 'downloads') { updateDownloadFolderOptions(); enterDownloadsView(); return; }
  if (view === 'listen') { renderHome(); return; }
  if (view === 'statistics') { renderStatisticsPage(); return; }
  if (view === 'smart' || view.startsWith('smart:')) { renderSmartFolders(view); return; }
  if (view === 'about') { renderAboutPage(); return; }
  if (view === 'folders') {
    const items = folders.map(folder => ({ title: folder.split('/').filter(Boolean).at(-1) || folder, artist: folder, kind: 'folder', tracks: tracks.filter(track => track.pathLabel) }));
    renderCards(items, 'Adicione uma pasta para monitorá-la.'); return;
  }
  if (view === 'albums') { renderCards(groupsForAlbums(tracks), 'Os álbuns encontrados aparecerão aqui.', 'album'); return; }
  if (view === 'artists') { renderCards(groupsForArtists(tracks), 'Os artistas encontrados aparecerão aqui.', 'artist'); return; }
  if (view === 'playlists') { renderPlaylistCollection(); return; }
  if (view.startsWith('playlist:')) {
    const playlist = playlists.find(item => item.id === view.slice('playlist:'.length));
    if (!playlist) { openView('playlists'); return; }
    const items = playlistTracks(playlist);
    renderCards(items, 'Adicione músicas usando o botão + em qualquer faixa.', 'playlist-track');
    renderPlaylistPlaybackControls(items); return;
  }
  if (view === 'favorites') {
    const ids = new Set(safeArray('favorites'));
    renderCards(tracks.filter(track => ids.has(track.id)), 'Marque uma faixa com o coração para guardá-la aqui.'); return;
  }
  if (view === 'recent') {
    const recent = safeArray('recentIds').map(id => tracks.find(track => track.id === id)).filter(Boolean);
    renderCards(recent, 'As faixas tocadas aparecerão aqui.'); return;
  }
  if (view === 'queue') { renderCards(queue, 'Adicione uma faixa à fila.', 'queue'); return; }
  renderCards(tracks, folders.length ? 'Adicione músicas às pastas monitoradas.' : 'Escolha uma pasta com arquivos de áudio.');
}
function searchLibrary(query) {
  if (activeView === 'downloads') return;
  if (!query) { openView(activeView); return; }
  $('quickSection').hidden = true; $('catalogSection').hidden = true; $('recentSection').hidden = true;
  $('pageTitle').innerHTML = 'Resultados<span class="gold-dot">.</span>';
  $('pageSubtitle').textContent = `Busca local por “${query}”`;
  const lower = normalizeSearch(query);
  const results = tracks.filter(track => normalizeSearch(`${track.title} ${track.artist} ${track.album} ${track.codec} ${track.genre}`).includes(lower));
  renderCards(results, 'Nenhuma faixa corresponde à busca.');
}
function syncTransportStates() {
  const playing = Boolean(currentTrack && !audio.paused);
  document.body.classList.toggle('audio-playing', playing);
  setPlayIcon($('playButton'), playing); setPlayIcon($('lyricsPlay'), playing);
  $('playButton').classList.toggle('active', playing);
  $('playButton').setAttribute('aria-pressed', String(playing));
  $('shuffleButton').classList.toggle('active', shuffled);
  $('shuffleButton').setAttribute('aria-pressed', String(shuffled));
  $('shuffleButton').title = shuffled ? 'Aleatório ativado' : 'Aleatório';
  $('repeatButton').classList.toggle('active', repeatMode > 0);
  $('repeatButton').setAttribute('aria-pressed', String(repeatMode > 0));
  $('repeatButton').dataset.mode = String(repeatMode);
  $('repeatButton').title = ['Repetição desativada', 'Repetir fila', 'Repetir faixa'][repeatMode];
  $('lyricsShuffle').classList.toggle('active', shuffled); $('lyricsShuffle').setAttribute('aria-pressed', String(shuffled));
  $('lyricsRepeat').classList.toggle('active', repeatMode > 0); $('lyricsRepeat').setAttribute('aria-pressed', String(repeatMode > 0));
  $('lyricsPlay').classList.toggle('active', playing); $('lyricsPlay').setAttribute('aria-pressed', String(playing));
}
function renderQueuePopover() {
  const list = $('queuePopoverList'); if (!list) return;
  $('queueCount').textContent = String(queue.length);
  list.replaceChildren();
  if (!queue.length) { const empty = document.createElement('div'); empty.className = 'queue-popover-empty'; empty.textContent = 'A fila está vazia. Escolha uma faixa para começar.'; list.append(empty); return; }
  queue.forEach((track, index) => {
    const row = document.createElement('div'); row.className = 'queue-popover-row'; row.draggable = true;
    if (index === queueIndex) row.classList.add('current');
    if (index === queueIndex + 1) row.classList.add('up-next');
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('span'); copy.className = 'queue-popover-copy';
    const title = document.createElement('b'); title.textContent = track.title;
    const artist = document.createElement('small'); artist.textContent = track.artist;
    const play = document.createElement('button'); play.type = 'button'; play.className = 'queue-row-play'; play.textContent = '▶'; play.title = 'Reproduzir agora'; play.addEventListener('click', () => { queueIndex = index; $('queuePopover').hidden = true; $('queueToggle').setAttribute('aria-expanded', 'false'); playTrack(track, queue, { keepQueue: true }); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'queue-row-remove'; remove.textContent = '×'; remove.title = 'Remover da fila'; remove.addEventListener('click', () => {
      queue.splice(index, 1);
      if (index < queueIndex) queueIndex--;
      else if (index === queueIndex) queueIndex = -1;
      if (!queue.length) queueIndex = -1;
      renderQueuePopover(); if (activeView === 'queue') openView('queue', false); renderCurrentTrack();
    });
    copy.append(title, artist); row.append(number, copy, play, remove);
    row.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', String(index)); event.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
    row.addEventListener('drop', event => {
      event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')), to = index;
      if (!Number.isInteger(from) || from === to || from < 0 || from >= queue.length) return;
      const [moved] = queue.splice(from, 1); queue.splice(to, 0, moved);
      if (queueIndex === from) queueIndex = to; else if (from < queueIndex && to >= queueIndex) queueIndex--; else if (from > queueIndex && to <= queueIndex) queueIndex++;
      renderQueuePopover(); if (activeView === 'queue') openView('queue', false);
    });
    list.append(row);
  });
}
async function exportQueue() {
  if (!queue.length) { toast('A fila está vazia.'); return; }
  try {
    const result = await window.isotopus.exportPlaylist(queue.map(({ id, title, artist, duration }) => ({ id, title, artist, duration })));
    if (result?.cancelled) return;
    if (!result?.ok) { toast(result?.error || 'Não foi possível exportar a fila.'); return; }
    toast(`Playlist M3U8 salva · ${result.count} faixas.`);
  } catch (error) { toast(`Falha ao exportar: ${error.message}`); }
}
function renderCurrentTrack() {
  if (!currentTrack) {
    $('trackTitle').textContent = 'Escolha uma faixa'; $('trackArtist').textContent = 'Sua música, no seu ritmo';
    $('trackQuality').textContent = 'ÁUDIO LOCAL'; $('trackQuality').classList.remove('compressed');
    coverStyle({}, $('trackArt')); document.body.style.removeProperty('--cover-tone'); document.body.style.removeProperty('--cover-artwork'); $('likeButton').textContent = '♡';
    setPlayIcon($('playButton'), false); setPlayIcon($('lyricsPlay'), false);
    $('likeButton').classList.remove('active'); $('likeButton').setAttribute('aria-pressed', 'false');
    syncTransportStates(); updateMediaSession(); publishMiniPlayerState(); return;
  }
  $('trackTitle').textContent = currentTrack.title;
  $('trackArtist').textContent = `${currentTrack.artist} · ${currentTrack.album}`;
  const quality = $('trackQuality');
  quality.textContent = qualityText(currentTrack);
  quality.classList.toggle('compressed', !currentTrack.lossless);
  const art = $('trackArt'); coverStyle(currentTrack, art);
  refreshAcrylicArtwork(currentTrack);
  refreshCoverAmbient(currentTrack);
  const liked = safeArray('favorites').includes(currentTrack.id);
  $('likeButton').textContent = liked ? '♥' : '♡';
  $('likeButton').classList.toggle('active', liked); $('likeButton').setAttribute('aria-pressed', String(liked));
  syncTransportStates();
  updateMediaSession();
  publishMiniPlayerState();
}
function publishMiniPlayerState() {
  if (!miniPlayerVisible) return;
  window.isotopus.publishMiniPlayerState({ track: currentTrack ? { title: currentTrack.title, artist: currentTrack.artist, album: currentTrack.album, coverUrl: currentTrack.coverUrl || '' } : null, playing: Boolean(currentTrack && !audio.paused), currentTime: Number(audio.currentTime) || 0, duration: Number(audio.duration) || Number(currentTrack?.duration) || 0, volume: Math.round(baseVolume * 100), dark: document.body.classList.contains('dark-theme'), surfaceStyle: document.body.dataset.surfaceStyle || 'normal', dynamic: store.get('dynamicColors') === 'yes', tone: document.body.style.getPropertyValue('--cover-tone') || '' });
}
function updateCrossfadeVolumes(progress) {
  const angle = Math.max(0, Math.min(1, progress)) * Math.PI / 2;
  audio.volume = Math.max(0, Math.min(1, baseVolume * Math.cos(angle)));
  standbyAudio.volume = Math.max(0, Math.min(1, baseVolume * Math.sin(angle)));
}
function cancelCrossfade() {
  const rollback = crossfadeActive;
  if (crossfadeTimer) clearInterval(crossfadeTimer);
  crossfadeTimer = 0; crossfadeProgress = 0; crossfadeActive = false;
  standbyAudio.pause(); standbyAudio.removeAttribute('src'); standbyAudio.load(); standbyAudio.volume = 0;
  audio.volume = baseVolume;
  if (rollback) { currentTrack = crossfadeFromTrack; queueIndex = crossfadeFromIndex; }
  crossfadeFromTrack = null; crossfadeFromIndex = -1;
}
function beginCrossfade() {
  if (!crossfadeSeconds || crossfadeActive || audio.paused || !Number.isFinite(audio.duration) || !queue.length || repeatMode === 2) return;
  const remaining = audio.duration - audio.currentTime;
  if (remaining > crossfadeSeconds) return;
  const duration = Math.min(crossfadeSeconds, audio.duration * .25, remaining);
  if (duration < .5) return;
  const nextIndex = queueIndex + 1 < queue.length ? queueIndex + 1 : repeatMode === 1 ? 0 : -1;
  if (nextIndex < 0 || nextIndex === queueIndex) return;
  const outgoingTrack = currentTrack, outgoingIndex = queueIndex;
  const incomingTrack = queue[nextIndex], outgoing = audio, incoming = standbyAudio;
  crossfadeFromTrack = outgoingTrack; crossfadeFromIndex = outgoingIndex;
  crossfadeActive = true; crossfadeProgress = 0; queueIndex = nextIndex; currentTrack = incomingTrack;
  incoming.src = incomingTrack.streamUrl; incoming.load(); incoming.volume = 0;
  renderCurrentTrack(); rememberTrack(incomingTrack); renderQueuePopover();
  if (!$('lyricsScreen').hidden) loadCurrentLyrics();
  equalizer.play(incoming).then(() => {
    if (!crossfadeActive) return;
    const startedAt = performance.now(); const durationMs = duration * 1000;
    const step = () => {
      if (!crossfadeActive) return;
      crossfadeProgress = Math.min(1, (performance.now() - startedAt) / durationMs); updateCrossfadeVolumes(crossfadeProgress);
      if (crossfadeProgress < 1) return;
      clearInterval(crossfadeTimer); crossfadeTimer = 0; outgoing.pause(); outgoing.removeAttribute('src'); outgoing.load();
      audio = incoming; standbyAudio = outgoing; audio.volume = baseVolume; standbyAudio.volume = 0;
      crossfadeActive = false; crossfadeProgress = 0; crossfadeFromTrack = null; crossfadeFromIndex = -1; renderCurrentTrack(); updateTimeline();
      if (audio.ended) nextTrack();
    };
    crossfadeTimer = setInterval(step, 40); step();
  }).catch(() => {
    cancelCrossfade(); currentTrack = outgoingTrack; queueIndex = outgoingIndex; renderCurrentTrack();
    toast('Não foi possível misturar esta faixa; a reprodução continua normalmente.');
    if (outgoing.ended) nextTrack();
  });
}
function updateMediaSession() {
  const session = navigator.mediaSession;
  if (!session) return;
  try {
    const trackId = currentTrack?.id || null;
    if (trackId !== mediaSessionTrackId) {
      mediaSessionTrackId = trackId;
      if (currentTrack && typeof MediaMetadata !== 'undefined') {
        session.metadata = new MediaMetadata({ title: currentTrack.title, artist: currentTrack.artist, album: currentTrack.album, artwork: [{ src: currentTrack.coverUrl || '../assets/icons/512x512.png', sizes: '512x512', type: 'image/png' }] });
      } else session.metadata = null;
      lastMediaPositionUpdate = 0;
    }
    const playbackState = currentTrack ? (audio.paused ? 'paused' : 'playing') : 'none';
    if (playbackState !== mediaSessionPlaybackState) { session.playbackState = playbackState; mediaSessionPlaybackState = playbackState; }
    const now = performance.now();
    if (Number.isFinite(audio.duration) && audio.duration > 0 && typeof session.setPositionState === 'function' && now - lastMediaPositionUpdate >= 1000) {
      session.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime || 0, audio.duration) });
      lastMediaPositionUpdate = now;
    }
  } catch {}
}
function rememberTrack(track) {
  const recent = safeArray('recentIds').filter(id => id !== track.id);
  recent.unshift(track.id); store.set('recentIds', JSON.stringify(recent.slice(0, 50)));
}
async function playTrack(track, list = tracks, { keepQueue = false, recovery = false } = {}) {
  if (!track) return;
  if (currentTrack && currentTrack.id !== track.id) finishListeningSession();
  if (!recovery) failedTracks.clear();
  cancelCrossfade();
  const source = list.length ? list : [track];
  if (keepQueue) { queue = source; queueIndex = Math.max(0, queue.findIndex(item => item.id === track.id)); }
  else if (shuffled && source.length > 1) { queue = [track, ...shuffleTracks(source.filter(item => item.id !== track.id))]; queueIndex = 0; }
  else { queue = source; queueIndex = Math.max(0, queue.findIndex(item => item.id === track.id)); }
  renderQueuePopover();
  currentTrack = track;
  renderCurrentTrack();
  audio.src = track.streamUrl; audio.load();
  if (!$('lyricsScreen').hidden) loadCurrentLyrics();
  try {
    await equalizer.play(audio);
    rememberTrack(track); renderCurrentTrack();
  } catch (error) { if (currentTrack?.id === track.id) toast(`Não foi possível reproduzir ${track.codec}: ${error.message}`); }
}
function recoverAfterPlaybackError(track) {
  if (!track) return;
  failedTracks.add(track.id);
  toast(`Falha ao decodificar “${track.title}”. Tentando a próxima faixa…`);
  for (let step = 1; step < queue.length; step++) {
    let candidateIndex = queueIndex + step;
    if (candidateIndex >= queue.length) {
      if (repeatMode !== 1) break;
      candidateIndex %= queue.length;
    }
    const candidate = queue[candidateIndex];
    if (candidate && !failedTracks.has(candidate.id)) {
      queueIndex = candidateIndex;
      playTrack(candidate, queue, { keepQueue: true, recovery: true });
      return;
    }
  }
  currentTrack = null;
  audio.pause(); audio.removeAttribute('src'); audio.load();
  renderCurrentTrack();
  toast('Não há outras faixas reproduzíveis nesta fila.');
}
function playCollection(items, { shuffle = shuffled } = {}) {
  if (!items?.length) return;
  queue = shuffle ? shuffleTracks(items) : items.slice();
  if (shuffle) { shuffled = true; store.set('shuffle', 'yes'); syncTransportStates(); }
  else if (shuffled) { shuffled = false; store.set('shuffle', ''); syncTransportStates(); }
  queueIndex = 0; renderQueuePopover(); playTrack(queue[0], queue, { keepQueue: true });
}
async function nextTrack() {
  if (!queue.length) return;
  cancelCrossfade();
  if (repeatMode === 2 && currentTrack) { audio.currentTime = 0; await equalizer.play(audio); return; }
  if (queueIndex + 1 < queue.length) queueIndex++;
  else if (repeatMode === 1) queueIndex = 0;
  else { currentTrack = null; audio.pause(); audio.removeAttribute('src'); audio.load(); renderCurrentTrack(); return; }
  playTrack(queue[queueIndex], queue, { keepQueue: true });
}
function previousTrack() {
  if (!queue.length) return;
  cancelCrossfade();
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  queueIndex = Math.max(0, queueIndex - 1); playTrack(queue[queueIndex], queue, { keepQueue: true });
}
function pausePlayback() { if (crossfadeActive) cancelCrossfade(); audio.pause(); }
function updateTimeline() {
  const duration = Number(audio.duration) || 0;
  $('seek').max = duration || 100; $('seek').value = Math.min(audio.currentTime || 0, duration || 100);
  $('lyricsSeek').max = duration || 100; $('lyricsSeek').value = Math.min(audio.currentTime || 0, duration || 100);
  const progress = Number($('seek').value) / Math.max(1, Number($('seek').max)) * 100;
  const safeProgress = Math.max(0, Math.min(100, progress));
  for (const track of seekVisualizers) {
    track.style.setProperty('--seek-progress', safeProgress);
    track.style.setProperty('--seek-percent', `${safeProgress}%`);
  }
  $('elapsed').textContent = fmt(audio.currentTime); $('duration').textContent = fmt(duration);
  $('lyricsElapsed').textContent = fmt(audio.currentTime); $('lyricsDuration').textContent = fmt(duration);
  updateLyricsHighlight();
  publishMiniPlayerState();
}
function setLyricsStatus(message) { $('lyricsStatus').textContent = message; }
function updateAutomaticLyricsControls() {
  const available = Boolean(currentLyrics.lines.length) && !currentLyrics.synced;
  $('lyricsAutoSyncButton').hidden = !available;
  $('lyricsAutoSyncHelp').hidden = !available;
  $('autoSyncLyricsMenuButton').disabled = !available;
}
window.isotopus.onLyricsAlignProgress?.(progress => {
  if (progress?.id === lyricsTrackId && progress.message) setLyricsStatus(progress.message);
});
function showLyricsEmpty(message) {
  $('lyricsAutoSyncButton').hidden = true; $('lyricsAutoSyncHelp').hidden = true; $('autoSyncLyricsMenuButton').disabled = true;
  $('lyricsLines').replaceChildren(); const empty = document.createElement('div'); empty.className = 'lyrics-empty'; empty.textContent = message; $('lyricsLines').append(empty);
}
function showLyricsActions() {
  const actions = document.createElement('div'); actions.className = 'lyrics-empty-actions';
  const web = document.createElement('button'); web.type = 'button'; web.className = 'secondary-button'; web.textContent = 'Pesquisar letra na web'; web.addEventListener('click', () => { openLyricsPasteDialog(); searchLyricsWeb(); });
  const paste = document.createElement('button'); paste.type = 'button'; paste.className = 'secondary-button'; paste.textContent = 'Colar letra copiada'; paste.addEventListener('click', openLyricsPasteDialog);
  actions.append(web, paste); $('lyricsLines').append(actions);
}
function rebuildTimedLyricsIndex() {
  timedLyricsIndex = currentLyrics.lines
    .map((line, index) => ({ index, time: Number(line.time) }))
    .filter(item => Number.isFinite(item.time) && item.time >= 0)
    .sort((a, b) => a.time - b.time || a.index - b.index);
}
function applyLyricsText(raw, source = 'Letra adicionada') {
  const parsed = window.IsotopusLyrics.parseLyrics(raw);
  const origin = /arquivo local/i.test(source) ? 'local-lrc' : /whisper|automaticamente com o áudio/i.test(source) ? 'whisper' : /lrclib/i.test(source) ? 'lrclib' : parsed.synced ? 'lrc-imported' : 'unsynced';
  currentLyrics = { raw: String(raw || ''), synced: parsed.synced, lines: parsed.lines, source, origin };
  rebuildTimedLyricsIndex();
  manualLyricsMode = false; activeLyricIndex = -1;
  const savedOffset = Number(store.get(`lyricsOffset:${lyricsTrackId}`));
  $('lyricsOffset').value = Number.isFinite(savedOffset) ? Math.max(-10, Math.min(10, savedOffset)) : 0;
  $('lyricsOffsetValue').textContent = `${Number($('lyricsOffset').value).toFixed(1)} s`;
  $('markLyricsToggle').hidden = !parsed.lines.length;
  $('markLyricsToggle').textContent = parsed.synced ? 'Refazer sincronização manual' : 'Marcar linhas durante a reprodução';
  setLyricsStatus(parsed.lines.length ? `${source} · ${parsed.synced ? 'sincronizada' : 'sem tempos'}` : 'Nenhuma letra encontrada.');
  renderLyricsOrigin();
  renderLyricsLines();
  updateAutomaticLyricsControls();
  updateManualSyncProgress();
  persistLyricsState();
}
function persistLyricsState() {
  if (!lyricsTrackId || !currentLyrics.lines.length) return Promise.resolve();
  const state = { raw: currentLyrics.raw, synced: currentLyrics.synced, lines: currentLyrics.lines, offset: Number($('lyricsOffset').value) || 0, origin: currentLyrics.origin || 'unsynced' };
  return window.isotopus.saveLyricsState(lyricsTrackId, state).catch(() => {});
}
function renderLyricsOrigin() {
  const badge = $('lyricsOriginBadge'); if (!badge) return;
  const states = { 'local-lrc': ['lrc', 'LRC local', 'Letra sincronizada lida de um arquivo .lrc ao lado da música.'], whisper: ['whisper', 'Whisper', 'Tempos estimados localmente pelo modelo Whisper.'], manual: ['manual', 'Manual', 'Tempos marcados manualmente durante a reprodução.'], lrclib: ['lrclib', 'LRCLIB', 'Letra obtida do catálogo LRCLIB; não veio de um arquivo local.'], 'lrc-imported': ['imported', 'LRC importado', 'Letra sincronizada carregada de um texto ou arquivo importado.'], unsynced: ['unsynced', 'Sem sincronização', 'Letra disponível sem tempos sincronizados.'] };
  const [kind, label, description] = states[currentLyrics.origin || 'unsynced'] || states.unsynced;
  badge.className = `lyrics-origin ${kind}`; badge.textContent = label; badge.title = description; badge.setAttribute('aria-label', description);
}
function updateManualSyncProgress() {
  const marked = manualRedoPending ? 0 : currentLyrics.lines.filter(line => line.time != null).length;
  $('manualSyncProgress').textContent = `${marked} de ${currentLyrics.lines.length} linhas marcadas`;
  $('manualSyncNext').disabled = !currentLyrics.lines.length || (!manualRedoPending && marked >= currentLyrics.lines.length);
}
async function markLyricsLine(index) {
  const line = currentLyrics.lines[index]; if (!line) return;
  if (manualRedoPending) {
    currentLyrics.lines.forEach(item => { item.time = null; });
    currentLyrics.synced = false; manualRedoPending = false;
    $('lyricsOffset').value = '0'; $('lyricsOffset').dispatchEvent(new Event('input'));
  }
  line.time = Math.max(0, audio.currentTime || 0);
  rebuildTimedLyricsIndex();
  currentLyrics.origin = 'manual';
  renderLyricsOrigin();
  const marked = currentLyrics.lines.filter(item => item.time != null).length;
  if (marked === currentLyrics.lines.length) {
    currentLyrics.synced = true; currentLyrics.raw = window.IsotopusLyrics.formatLyrics(currentLyrics.lines);
    manualLyricsMode = false; $('markLyricsToggle').hidden = false;
    $('markLyricsToggle').textContent = 'Refazer sincronização manual';
    updateAutomaticLyricsControls();
    setLyricsStatus('Sincronização concluída. Letra salva automaticamente neste computador.');
  } else setLyricsStatus(`Marcada a linha ${marked} de ${currentLyrics.lines.length}. Continue no próximo verso.`);
  await persistLyricsState(); renderLyricsLines(); updateManualSyncProgress();
  const next = currentLyrics.lines.findIndex(item => item.time == null);
  if (next >= 0) $('lyricsLines').children[next]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function markNextLyricsLine() {
  if (!manualLyricsMode) {
    manualLyricsMode = true;
    $('markLyricsToggle').textContent = 'Concluir marcação manual';
  }
  const index = manualRedoPending ? 0 : currentLyrics.lines.findIndex(line => line.time == null);
  if (index >= 0) markLyricsLine(index);
}
function seekToLyricLine(index) {
  const line = currentLyrics.lines[index];
  if (!line || line.time == null || !Number.isFinite(Number(line.time))) return;
  const offset = Number($('lyricsOffset').value) || 0;
  const target = Math.max(0, Number(line.time) + offset);
  if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(target, Math.max(0, audio.duration - 0.05));
  else audio.currentTime = target;
}
function renderLyricsLines() {
  const container = $('lyricsLines'); container.replaceChildren(); activeLyricIndex = -1;
  if (!currentLyrics.lines.length) { showLyricsEmpty('Abra um arquivo LRC/TXT ou busque uma letra na web.'); return; }
  currentLyrics.lines.forEach((line, index) => {
    const canSeek = line.time != null && Number.isFinite(Number(line.time));
    const row = document.createElement(manualLyricsMode || canSeek ? 'button' : 'div');
    row.className = 'lyrics-line'; row.dataset.index = String(index);
    if (manualLyricsMode) {
      row.type = 'button'; row.title = 'Marcar esta linha no tempo atual';
      row.textContent = `${line.time == null ? '○' : fmt(line.time)}  ${line.text}`;
      row.addEventListener('click', () => markLyricsLine(index));
    } else {
      row.textContent = line.text;
      if (canSeek) {
        row.type = 'button';
        row.setAttribute('aria-label', `Pular para ${fmt(line.time)}: ${line.text}`);
        row.addEventListener('click', () => seekToLyricLine(index));
      }
    }
    container.append(row);
  });
  updateLyricsHighlight(true);
}
function updateLyricsHighlight(forceScroll = false) {
  if ($('lyricsScreen').hidden || !currentLyrics.lines.length) return;
  const offset = Number($('lyricsOffset').value) || 0;
  const position = Math.max(0, audio.currentTime - offset);
  let next = -1;
  let low = 0, high = timedLyricsIndex.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timedLyricsIndex[middle].time <= position) { next = timedLyricsIndex[middle].index; low = middle + 1; }
    else high = middle - 1;
  }
  if (!forceScroll && next === activeLyricIndex) return;
  const rows = $('lyricsLines').querySelectorAll('.lyrics-line');
  for (const index of [activeLyricIndex - 1, activeLyricIndex, activeLyricIndex + 1]) {
    if (index >= 0) rows[index]?.classList.remove('active', 'lyrics-neighbor');
  }
  if (next >= 0) {
    rows[next]?.classList.add('active');
    rows[next - 1]?.classList.add('lyrics-neighbor');
    rows[next + 1]?.classList.add('lyrics-neighbor');
    if (!forceScroll && next !== activeLyricIndex && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      rows[next]?.animate([
        { opacity: 0.78, transform: 'scale(1.015)', filter: 'blur(1px)' },
        { opacity: 1, transform: 'scale(1.065)', filter: 'blur(0)' }
      ], { duration: 360, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }
  if (next >= 0 && (forceScroll || next !== activeLyricIndex)) $('lyricsLines').children[next]?.scrollIntoView({ block: 'center', behavior: forceScroll ? 'auto' : 'smooth' });
  activeLyricIndex = next;
}
async function loadCurrentLyrics() {
  if (!currentTrack) return;
  lyricsTrackId = currentTrack.id;
  $('lyricsTrackTitle').textContent = currentTrack.title; $('lyricsTrackArtist').textContent = `${currentTrack.artist} · ${currentTrack.album}`;
  $('lyricsHeading').textContent = currentTrack.title; $('lyricsHeading').title = currentTrack.title; coverStyle(currentTrack, $('lyricsCover'));
  currentLyrics = { raw: '', synced: false, lines: [], source: '', origin: 'unsynced' }; manualLyricsMode = false; renderLyricsOrigin();
  rebuildTimedLyricsIndex();
  $('cancelLyricsAutoSyncButton').hidden = true;
  manualRedoPending = false;
  updateAutomaticLyricsControls();
  $('lyricsSyncPanel').hidden = true; $('lyricsMenu').hidden = true;
  const saved = await window.isotopus.getLyricsState(currentTrack.id);
  if (lyricsTrackId !== currentTrack.id) return;
  if (saved?.lines?.length) {
    currentLyrics = { raw: String(saved.raw || ''), synced: Boolean(saved.synced), lines: saved.lines, source: 'Salva no Isótopus', origin: saved.origin || (saved.synced ? 'lrc-imported' : 'unsynced') }; renderLyricsOrigin();
    rebuildTimedLyricsIndex();
    updateAutomaticLyricsControls();
    $('lyricsOffset').value = Math.max(-10, Math.min(10, Number(saved.offset) || 0));
    $('lyricsOffsetValue').textContent = `${Number($('lyricsOffset').value).toFixed(1)} s`;
    $('markLyricsToggle').hidden = !currentLyrics.lines.length;
    $('markLyricsToggle').textContent = currentLyrics.synced ? 'Refazer sincronização manual' : 'Marcar linhas durante a reprodução';
    setLyricsStatus(`Letra salva neste computador · ${currentLyrics.synced ? 'sincronizada' : 'sem tempos'}`);
    renderLyricsLines(); updateManualSyncProgress(); return;
  }
  showLyricsEmpty('Procurando uma letra local…'); setLyricsStatus('Verificando arquivo .lrc local');
  const result = await window.isotopus.getLocalLyrics(currentTrack.id);
  if (lyricsTrackId !== currentTrack.id) return;
  if (result?.content) {
    applyLyricsText(result.content, 'Arquivo local');
    if (!currentLyrics.synced) setLyricsStatus('Letra local sem tempos · você pode sincronizá-la automaticamente com o áudio.');
    return;
  }
  setLyricsStatus('Buscando automaticamente uma letra sincronizada…');
  const lookup = await window.isotopus.searchLyrics({ title: currentTrack.title, artist: currentTrack.artist, album: currentTrack.album, duration: currentTrack.duration });
  if (lyricsTrackId !== currentTrack.id) return;
  const best = lookup?.ok ? window.IsotopusLyrics.rankLyricsRecords(lookup.records, currentTrack)[0] : null;
  if (best && best.score >= 0.68) {
    const text = best.record.syncedLyrics || best.record.plainLyrics;
    applyLyricsText(text, 'LRCLIB · busca automática');
    if (currentLyrics.synced) setLyricsStatus('Letra sincronizada encontrada automaticamente no LRCLIB.');
    else setLyricsStatus('Letra encontrada sem tempos · sincronize-a com o áudio usando o botão ✦.');
    return;
  }
  showLyricsEmpty(lookup?.ok ? 'Não encontrei uma letra com correspondência segura para esta gravação.' : 'Não foi possível buscar a letra agora.');
  showLyricsActions(); setLyricsStatus(lookup?.error || 'Nenhuma letra correspondente encontrada');
}
async function openLyricsScreen() {
  if (!currentTrack) { toast('Reproduza ou selecione uma faixa primeiro.'); return; }
  window.getSelection?.()?.removeAllRanges();
  const screen = $('lyricsScreen'); screen.hidden = false; screen.classList.remove('closing');
  $('lyricsTrackTitle').textContent = currentTrack.title; $('lyricsTrackArtist').textContent = `${currentTrack.artist} · ${currentTrack.album}`;
  coverStyle(currentTrack, $('lyricsCover')); updateTimeline();
  requestAnimationFrame(() => { document.body.classList.add('lyrics-open'); screen.classList.add('visible'); });
  await loadCurrentLyrics();
}
function minimizeLyricsScreen() {
  const screen = $('lyricsScreen'); if (screen.hidden || screen.classList.contains('closing')) return;
  screen.classList.remove('visible'); screen.classList.add('closing'); document.body.classList.remove('lyrics-open');
  setTimeout(() => { screen.hidden = true; screen.classList.remove('closing'); }, 390);
}
async function searchLyricsOnline() {
  if (!currentTrack) return;
  $('lyricsMenu').hidden = true; setLyricsStatus('Buscando no LRCLIB…');
  const result = await window.isotopus.searchLyrics({ title: currentTrack.title, artist: currentTrack.artist, album: currentTrack.album, duration: currentTrack.duration });
  if (!result?.ok) { setLyricsStatus(result?.error || 'Busca indisponível.'); return; }
  const list = $('lyricsSearchResults'); list.replaceChildren();
  for (const record of result.records) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'lyrics-result';
    const title = document.createElement('b'); title.textContent = record.title || currentTrack.title;
    const meta = document.createElement('small'); meta.textContent = `${record.artist || 'Artista desconhecido'} · ${record.album || 'Álbum desconhecido'} · ${record.syncedLyrics ? 'Sincronizada' : record.plainLyrics ? 'Sem sincronização' : 'Instrumental'}`;
    button.append(title, meta);
    button.addEventListener('click', () => {
      const text = record.syncedLyrics || record.plainLyrics;
      if (text) applyLyricsText(text, 'LRCLIB');
      else { currentLyrics = { raw: '', synced: false, lines: [], source: 'LRCLIB' }; rebuildTimedLyricsIndex(); showLyricsEmpty('Esta faixa está marcada como instrumental.'); setLyricsStatus('Instrumental'); }
      $('lyricsSearchDialog').close();
    });
    list.append(button);
  }
  if (!result.records.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'Nenhuma letra encontrada para esta faixa.'; list.append(empty); }
  $('lyricsSearchDialog').showModal(); setLyricsStatus(`${result.records.length} resultados do LRCLIB`);
}
async function decodeCurrentTrackForAlignment(track) {
  if (!track?.streamUrl) throw new Error('Não encontrei o arquivo de áudio desta faixa.');
  if (Number(track.duration) > 600) throw new Error('A sincronização automática aceita faixas de até 10 minutos nesta versão de teste.');
  const response = await fetch(track.streamUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('Não consegui abrir o arquivo de áudio local.');
  const contentLength = Number(response.headers.get('content-length')) || 0;
  if (contentLength > 160 * 1024 * 1024) throw new Error('Este arquivo é grande demais para a sincronização automática nesta versão de teste.');
  let encodedAudio = await response.arrayBuffer();
  if (encodedAudio.byteLength > 160 * 1024 * 1024) throw new Error('Este arquivo é grande demais para a sincronização automática nesta versão de teste.');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let decoder;
  try { decoder = new AudioContextClass({ sampleRate: 16000 }); }
  catch { decoder = new AudioContextClass(); }
  let decoded;
  try { decoded = await decoder.decodeAudioData(encodedAudio); }
  catch { throw new Error('Este formato não pôde ser decodificado para análise neste computador.'); }
  finally { encodedAudio = null; await decoder.close().catch(() => {}); }
  if (decoded.duration > 600) throw new Error('A sincronização automática aceita faixas de até 10 minutos nesta versão de teste.');
  const sampleRate = 16000, sampleCount = Math.ceil(decoded.duration * sampleRate);
  const resampler = new OfflineAudioContext(1, sampleCount, sampleRate);
  const source = resampler.createBufferSource(); source.buffer = decoded; source.connect(resampler.destination); source.start();
  const mono = await resampler.startRendering();
  const duration = decoded.duration;
  decoded = null;
  return { samples: mono.getChannelData(0), duration };
}
function confirmAutomaticLyricsSync() {
  const dialog = $('lyricsAutoSyncConfirmDialog');
  return new Promise(resolve => {
    const finish = accepted => { if (dialog.open) dialog.close(); resolve(accepted); };
    const onClose = () => { cleanup(); resolve(dialog.returnValue === 'proceed'); };
    const cleanup = () => {
      dialog.removeEventListener('close', onClose);
      $('declineLyricsAutoSync').removeEventListener('click', decline);
      $('acceptLyricsAutoSync').removeEventListener('click', accept);
      $('closeLyricsAutoSyncConfirm').removeEventListener('click', decline);
    };
    const decline = () => { dialog.returnValue = 'cancel'; finish(false); };
    const accept = () => { dialog.returnValue = 'proceed'; finish(true); };
    dialog.addEventListener('close', onClose, { once: true });
    $('declineLyricsAutoSync').addEventListener('click', decline, { once: true });
    $('acceptLyricsAutoSync').addEventListener('click', accept, { once: true });
    $('closeLyricsAutoSyncConfirm').addEventListener('click', decline, { once: true });
    dialog.returnValue = 'cancel'; dialog.showModal();
  });
}
async function runAutomaticLyricsSync() {
  if (!currentTrack || !currentLyrics.lines.length || currentLyrics.synced) return;
  if (!await confirmAutomaticLyricsSync()) return;
  const trackId = currentTrack.id, button = $('lyricsAutoSyncButton');
  $('lyricsMenu').hidden = true; button.disabled = true; button.textContent = 'Preparando áudio…'; $('cancelLyricsAutoSyncButton').hidden = false;
  setLyricsStatus('Preparando o áudio local para análise…');
  try {
    const decoded = await decodeCurrentTrackForAlignment(currentTrack);
    if (lyricsTrackId !== trackId) return;
    setLyricsStatus('Iniciando análise em segundo plano. Você pode continuar usando o Isótopus.');
    const model = ['tiny', 'base', 'small'].includes(store.get('whisperModel')) ? store.get('whisperModel') : 'small';
    let samples = decoded.samples;
    decoded.samples = null;
    const alignment = window.isotopus.alignLyrics(trackId, samples, currentLyrics.lines.map(line => line.text), decoded.duration, model);
    samples = null;
    const result = await alignment;
    if (lyricsTrackId !== trackId) return;
    if (!result?.ok) { setLyricsStatus(result?.cancelled ? 'Análise cancelada.' : result?.error || 'Não foi possível sincronizar esta letra.'); return; }
    const formatted = window.IsotopusLyrics.formatLyrics(result.lines);
    applyLyricsText(formatted, 'Sincronizada automaticamente com o áudio local');
    currentLyrics.origin = 'whisper'; await persistLyricsState(); renderLyricsOrigin();
    setLyricsStatus(`Sincronização estimada · ${result.matchedWords} de ${result.totalWords} palavras coincidiram. Confira os tempos.`);
  } catch (error) {
    if (lyricsTrackId === trackId) setLyricsStatus(error?.message || 'Não consegui sincronizar esta letra.');
  } finally {
    if (lyricsTrackId === trackId) { button.disabled = false; button.textContent = '✦ Sincronizar com áudio'; $('cancelLyricsAutoSyncButton').hidden = true; }
  }
}
function openLyricsPasteDialog() {
  $('lyricsMenu').hidden = true;
  $('lyricsPasteDialog').showModal();
  $('lyricsPasteText').focus();
}
async function searchLyricsWeb() {
  if (!currentTrack) return;
  const result = await window.isotopus.searchLyricsWeb({ title: currentTrack.title, artist: currentTrack.artist });
  if (!result?.ok) setLyricsStatus(result?.error || 'Não foi possível abrir a busca na web.');
  else setLyricsStatus('Busca aberta no navegador. Copie a letra e cole no campo.');
}
function applyPastedLyrics() {
  const text = $('lyricsPasteText').value.trim();
  if (!text) { $('lyricsPasteText').focus(); setLyricsStatus('Cole uma letra antes de continuar.'); return; }
  applyLyricsText(text, 'Letra colada');
  $('lyricsPasteDialog').close();
  $('lyricsPasteText').value = '';
  if (!currentLyrics.synced) setLyricsStatus('Letra adicionada sem tempos. Use “Sincronizar linhas manualmente” para marcar cada linha.');
}
async function openLyricsFile() {
  $('lyricsMenu').hidden = true;
  const result = await window.isotopus.openLyricsFile();
  if (result?.cancelled) return;
  if (result?.error) { setLyricsStatus(result.error); return; }
  if (result?.content) applyLyricsText(result.content, `Arquivo: ${result.path.split(/[\\/]/).at(-1)}`);
}
async function saveCurrentLyrics() {
  if (!currentTrack || !currentLyrics.raw && !currentLyrics.lines.length) { setLyricsStatus('Adicione uma letra antes de salvar.'); return; }
  const hasManualTimes = currentLyrics.lines.some(line => line.time != null);
  if (hasManualTimes && currentLyrics.lines.some(line => line.time == null)) { setLyricsStatus('Marque todas as linhas ou limpe a marcação manual antes de salvar.'); return; }
  const offset = Number($('lyricsOffset').value) || 0;
  const content = currentLyrics.synced || hasManualTimes
    ? window.IsotopusLyrics.formatLyrics(currentLyrics.lines, currentLyrics.synced ? offset : 0)
    : currentLyrics.raw;
  const origin = currentLyrics.origin; const result = await window.isotopus.saveLyrics(currentTrack.id, content);
  if (result?.ok) {
    if (currentLyrics.synced && offset) { store.set(`lyricsOffset:${currentTrack.id}`, '0'); $('lyricsOffset').value = '0'; }
    applyLyricsText(content, 'Salva ao lado da música'); currentLyrics.origin = origin || currentLyrics.origin; await persistLyricsState(); renderLyricsOrigin(); setLyricsStatus(`Salva em ${result.path}`);
  }
  else if (result?.error) setLyricsStatus(result.error);
}
async function loadLibrary() {
  try { applyLibrary(await window.isotopus.getLibrary()); }
  catch (error) { toast(`Não consegui abrir sua biblioteca: ${error.message}`); }
}
function renderFolderDialog() { renderFolderList(); }
function openEqualizer() { $('equalizerEnabled').checked = equalizer.state.enabled; setStyledSelect('equalizerPreset', equalizer.state.preset); equalizer.render(); equalizer.summary(); $('equalizerDialog').showModal(); }
function showSettings() {
  renderFolderDialog();
  setStyledSelect('appScaleSelect', store.get('appScale') || '100');
  $('minimizeToTrayToggle').checked = store.get('minimizeToTray') === 'yes';
  $('crossfadeToggle').checked = crossfadeSeconds > 0;
  $('crossfadeSettings').hidden = crossfadeSeconds <= 0;
  $('crossfadeDuration').value = String(crossfadeSeconds || 4);
  $('crossfadeDurationLabel').textContent = `${crossfadeSeconds || 4} segundos`;
  refreshWhisperModelManager();
  $('settingsDialog').showModal();
}
async function refreshWhisperModelManager() {
  const select = $('whisperModelSelect'); if (!select) return;
  const model = ['tiny', 'base', 'small'].includes(store.get('whisperModel')) ? store.get('whisperModel') : 'small';
  setStyledSelect('whisperModelSelect', model);
  try {
    const models = await window.isotopus.listWhisperModels();
    const installed = models?.find(item => item.model === select.dataset.value)?.installed;
    $('whisperModelStatus').textContent = installed ? 'Modelo selecionado instalado neste computador.' : 'Ainda não instalado; será baixado quando uma sincronização for iniciada.';
    $('deleteWhisperModelButton').disabled = !installed;
  } catch { $('whisperModelStatus').textContent = 'Não consegui consultar o cache local dos modelos.'; $('deleteWhisperModelButton').disabled = true; }
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => openView(button.dataset.view)));
window.addEventListener('resize', () => requestAnimationFrame(syncNavIndicator));
document.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => openView(button.dataset.target)));
$('downloadStartButton').addEventListener('click', startAudioDownload);
$('downloadAddFolder').addEventListener('click', chooseFolders);
$('downloadUrl').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); startAudioDownload(); } });
window.isotopus.onDownloadProgress(data => {
  if (!currentDownloadJob) return;
  currentDownloadJob.message = data.message || currentDownloadJob.message;
  if (data.itemId) {
    let item = currentDownloadJob.tracks.find(trackJob => trackJob.id === data.itemId);
    if (!item) { item = { id: data.itemId, title: data.title || 'Faixa', status: 'running', percent: 0, message: 'Preparando…' }; currentDownloadJob.tracks.push(item); }
    if (data.title) item.title = data.title;
    if (data.itemCount) { item.itemCount = data.itemCount; item.position = `${data.itemIndex || currentDownloadJob.tracks.length}/${data.itemCount}`; }
    if (Number.isFinite(data.percent)) item.percent = data.percent;
    if (data.event === 'item-done') { item.status = 'done'; item.percent = 100; item.message = 'Salva na pasta monitorada'; }
    else if (data.event === 'item-error') { item.status = 'error'; item.message = data.message || 'Falha nesta faixa'; }
    else { item.status = 'running'; item.message = data.message || (item.position ? `Faixa ${item.position}` : 'Baixando…'); }
  }
  if (data.status === 'done') { currentDownloadJob.message = data.message || currentDownloadJob.message; }
  if (data.status === 'error') { currentDownloadJob.status = 'error'; for (const item of currentDownloadJob.tracks) if (item.status === 'running') item.status = 'error'; }
  renderDownloadJobs();
});
$('dismissUpdate').addEventListener('click', () => { $('updateBanner').hidden = true; if (updateRelease) store.set('dismissUpdate', updateRelease.latest); });
$('updateInstallButton').addEventListener('click', async () => {
  if (!updateRelease) return;
  if (updateRelease.installCommand) {
    const filename = updateRelease.installer;
    const command = updateRelease.osFamily === 'arch' ? `sudo pacman -U ~/Downloads/${filename}` : `sudo apt install ~/Downloads/${filename}`;
    toast(`Depois de baixar, rode: ${command}`);
  }
  else if (updateRelease.platform === 'win32') toast('Baixe e execute o instalador Windows; feche o app durante a atualização.');
  await window.isotopus.openExternal(updateRelease.downloadUrl);
});
$('heroConnect').addEventListener('click', chooseFolders); $('addFolder').addEventListener('click', chooseFolders);
$('playLibraryButton').addEventListener('click', () => playCollection(tracks.slice(), { shuffle: false }));
$('shuffleLibraryButton').addEventListener('click', () => playCollection(tracks.slice(), { shuffle: true }));
$('viewFavorites').addEventListener('click', () => openView('favorites'));
$('lyricsEqualizerButton').addEventListener('click', openEqualizer);
$('equalizerDone').addEventListener('click', () => $('equalizerDialog').close());
$('appearanceButton').addEventListener('click', () => { refreshAppearanceOptions(); $('appearanceDialog').showModal(); });
document.querySelectorAll('[data-appearance-key]').forEach(button => button.addEventListener('click', () => { store.set(button.dataset.appearanceKey, button.dataset.appearanceValue); applyTheme(button.dataset.appearanceKey === 'theme' ? button.dataset.appearanceValue : undefined); }));
$('dynamicColorsToggle').addEventListener('change', event => { store.set('dynamicColors', event.currentTarget.checked ? 'yes' : ''); applyTheme(); });
$('appearanceDone').addEventListener('click', () => $('appearanceDialog').close());
bindStyledSelect('appScaleSelect', value => { store.set('appScale', value); window.isotopus.setZoomFactor(Number(value) / 100); });
window.isotopus.setZoomFactor(Number(store.get('appScale') || 100) / 100);
bindStyledSelect('equalizerPreset', preset => {
  equalizer.setPreset(preset);
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.styled-select')) document.querySelectorAll('.styled-select.open').forEach(root => {
    root.classList.remove('open'); root.querySelector('.styled-select-trigger').setAttribute('aria-expanded', 'false'); root.querySelector('.styled-select-menu').hidden = true;
  });
});
$('cancelDeleteTrack').addEventListener('click', () => { $('deleteTrackDialog').close(); trackDeletePendingId = ''; });
$('confirmDeleteTrack').addEventListener('click', async () => {
  const id = trackDeletePendingId; const track = tracks.find(item => item.id === id);
  if (!track) { $('deleteTrackDialog').close(); trackDeletePendingId = ''; return; }
  const button = $('confirmDeleteTrack'); const cancelButton = $('cancelDeleteTrack'); const closeButton = $('deleteTrackDialog').querySelector('.close-button'); button.disabled = true; cancelButton.disabled = true; closeButton.disabled = true; $('deleteTrackStatus').textContent = 'Removendo arquivo da pasta monitorada…';
  const wasCurrentTrack = currentTrack?.id === id, wasPlaying = wasCurrentTrack && !audio.paused, previousTime = wasCurrentTrack ? audio.currentTime : 0;
  if (wasCurrentTrack) {
    cancelCrossfade(); audio.pause(); audio.removeAttribute('src'); audio.load(); standbyAudio.pause(); standbyAudio.removeAttribute('src'); standbyAudio.load(); currentTrack = null; renderCurrentTrack();
  }
  try {
    const result = await window.isotopus.deleteMusicTrack(id);
    if (!result?.ok) { $('deleteTrackStatus').textContent = result?.error || 'Não foi possível excluir o arquivo.'; if (wasCurrentTrack) { currentTrack = track; renderCurrentTrack(); audio.src = track.streamUrl; audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.min(previousTime, audio.duration || previousTime); if (wasPlaying) equalizer.play(audio).catch(() => {}); }, { once: true }); } return; }
    tracks = result.tracks || tracks.filter(item => item.id !== id);
    queue = queue.filter(item => item.id !== id); queueIndex = currentTrack ? Math.max(0, queue.findIndex(item => item.id === currentTrack.id)) : -1;
    store.set('favorites', JSON.stringify(safeArray('favorites').filter(favoriteId => favoriteId !== id)));
    store.set('recentIds', JSON.stringify(safeArray('recentIds').filter(recentId => recentId !== id)));
    let changedPlaylists = false;
    for (const playlist of playlists) { const next = playlist.trackIds.filter(trackId => trackId !== id); if (next.length !== playlist.trackIds.length) { playlist.trackIds = next; changedPlaylists = true; } }
    if (changedPlaylists) savePlaylists();
    applyLibrary({ tracks, folders }); renderQueuePopover(); $('deleteTrackDialog').close(); trackDeletePendingId = ''; toast(`“${track.title}” foi excluída do computador.`);
  } catch (error) { $('deleteTrackStatus').textContent = `Erro: ${String(error.message || error).slice(0, 180)}`; }
  finally { button.disabled = false; cancelButton.disabled = false; closeButton.disabled = false; }
});
$('settingsButton').addEventListener('click', showSettings);
$('downloadManagerButton').addEventListener('click', () => { const menu = $('downloadManagerMenu'), opening = menu.hidden; menu.hidden = !opening; $('downloadManagerButton').setAttribute('aria-expanded', String(opening)); });
$('clearDownloadHistoryButton').addEventListener('click', () => {
  for (let i = downloadJobs.length - 1; i >= 0; i--) {
    const job = downloadJobs[i];
    if (job.status !== 'running') downloadJobs.splice(i, 1);
    else job.tracks = job.tracks.filter(track => track.status !== 'done' && track.status !== 'error');
  }
  renderDownloadJobs();
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('.track-actions, .track-action-menu')) document.querySelectorAll('.track-action-menu:not([hidden])').forEach(closeTrackActionMenu); });
document.addEventListener('scroll', () => document.querySelectorAll('.track-action-menu:not([hidden])').forEach(closeTrackActionMenu), true);
document.addEventListener('pointerdown', event => { if (!event.target.closest('.download-manager-wrap')) { $('downloadManagerMenu').hidden = true; $('downloadManagerButton').setAttribute('aria-expanded', 'false'); } });
$('learnButton').addEventListener('click', () => $('infoDialog').showModal()); $('infoDone').addEventListener('click', () => $('infoDialog').close());
$('viewLibrary').addEventListener('click', () => openView('songs'));
$('rescanLibrary').addEventListener('click', async () => { applyLibrary(await window.isotopus.rescanLibrary()); toast(`${tracks.length} faixas verificadas.`); });
$('searchInput').addEventListener('input', event => { clearTimeout(searchTimer); const value = event.currentTarget.value; searchTimer = setTimeout(() => value.trim() ? searchLibrary(value.trim()) : openView(activeView), 120); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.track-action-menu:not([hidden])').forEach(closeTrackActionMenu);
  if (event.key === 'Escape' && $('appearanceDialog').open) $('appearanceDialog').close();
  if (event.key === 'Escape' && !$('downloadManagerMenu').hidden) { $('downloadManagerMenu').hidden = true; $('downloadManagerButton').setAttribute('aria-expanded', 'false'); }
  const target = event.target;
  const editing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('searchInput').focus(); return; }
  if (editing || $('settingsDialog').open || $('equalizerDialog').open || $('infoDialog').open || event.altKey || event.metaKey || event.ctrlKey) return;
  if (event.code === 'Space') { event.preventDefault(); $('playButton').click(); }
  else if (event.key === 'ArrowRight' && event.shiftKey) { event.preventDefault(); nextTrack(); }
  else if (event.key === 'ArrowLeft' && event.shiftKey) { event.preventDefault(); previousTrack(); }
  else if (event.key === 'ArrowRight' && Number.isFinite(audio.duration)) { event.preventDefault(); audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); }
  else if (event.key === 'ArrowLeft' && Number.isFinite(audio.duration)) { event.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); $('volume').value = Math.min(100, Number($('volume').value) + 5); $('volume').dispatchEvent(new Event('input')); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); $('volume').value = Math.max(0, Number($('volume').value) - 5); $('volume').dispatchEvent(new Event('input')); }
});
$('playButton').addEventListener('click', async () => {
  if (!currentTrack) { if (!folders.length) chooseFolders(); else openView('songs'); return; }
  try { if (audio.paused) await equalizer.play(audio); else pausePlayback(); renderCurrentTrack(); }
  catch (error) { toast(`Não foi possível reproduzir: ${error.message}`); }
});
$('nextButton').addEventListener('click', nextTrack); $('previousButton').addEventListener('click', previousTrack);
$('shuffleButton').addEventListener('click', async () => {
  if (shuffled && queue.length) {
    shuffled = false; store.set('shuffle', ''); syncTransportStates(); toast('Aleatório desativado'); return;
  }
  const source = activeView === 'queue' ? queue.slice() : (activeView === 'listen' || activeView === 'songs') && !$('searchInput').value.trim() ? tracks.slice() : collectTracks(visibleTracks);
  if (!source.length) { toast('Não há faixas nesta seção para embaralhar.'); return; }
  shuffled = true; store.set('shuffle', 'yes');
  queue = shuffleTracks(source); queueIndex = 0; syncTransportStates();
  await playTrack(queue[0], queue, { keepQueue: true });
  toast(`Aleatório · ${queue.length} faixas na fila`);
});
$('repeatButton').addEventListener('click', () => { repeatMode = (repeatMode + 1) % 3; store.set('repeat', String(repeatMode)); syncTransportStates(); toast(['Repetição desativada', 'Repetir fila', 'Repetir faixa'][repeatMode]); });
$('seek').addEventListener('input', event => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.currentTarget.value); });
function syncLyricsVolume(value = $('volume').value) { $('lyricsVolume').value = value; $('lyricsVolumeValue').textContent = `${value}%`; }
$('volume').addEventListener('input', event => {
  syncLyricsVolume(event.currentTarget.value);
  baseVolume = Number(event.currentTarget.value) / 100;
  if (crossfadeActive) updateCrossfadeVolumes(crossfadeProgress); else audio.volume = baseVolume;
  store.set('volume', event.currentTarget.value);
});
$('likeButton').addEventListener('click', () => { if (!currentTrack) return toast('Selecione uma faixa primeiro.'); toggleFavorite(currentTrack); });
function renderQueueActions() {
  if (!queue.length) return;
  const results = $('dynamicResults');
  if (!results) return;
  const toolbar = document.createElement('div'); toolbar.className = 'queue-toolbar';
  const label = document.createElement('span'); label.textContent = `${queue.length} faixas · exporte para ouvir em outro player`;
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'secondary-button'; exportButton.textContent = 'Exportar M3U8';
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    try {
      const result = await window.isotopus.exportPlaylist(queue.map(({ id, title, artist, duration }) => ({ id, title, artist, duration })));
      if (result?.cancelled) return;
      if (!result?.ok) { toast(result?.error || 'Não foi possível exportar a fila.'); return; }
      toast(`Playlist M3U8 salva · ${result.count} faixas.`);
    } catch (error) { toast(`Falha ao exportar: ${error.message}`); }
    finally { exportButton.disabled = false; }
  });
  toolbar.append(label, exportButton); results.prepend(toolbar);
}
$('saveSettings').addEventListener('click', () => { $('settingsDialog').close(); toast('Configurações salvas.'); });
const systemThemeMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
if (systemThemeMedia) {
  const onSystemThemeChange = () => { if ((store.get('theme') || 'system') === 'system') applyTheme('system'); };
  if (systemThemeMedia.addEventListener) systemThemeMedia.addEventListener('change', onSystemThemeChange);
  else systemThemeMedia.addListener?.(onSystemThemeChange);
}
$('equalizerEnabled').addEventListener('change', event => equalizer.setEnabled(event.currentTarget.checked));
$('minimizeToTrayToggle').addEventListener('change', event => {
  store.set('minimizeToTray', event.currentTarget.checked ? 'yes' : '');
  toast(event.currentTarget.checked ? 'Ao fechar, o Isótopus ficará na bandeja.' : 'O app será encerrado ao fechar a janela.');
});
$('crossfadeToggle').addEventListener('change', event => {
  $('crossfadeSettings').hidden = !event.currentTarget.checked;
  crossfadeSeconds = event.currentTarget.checked ? Number($('crossfadeDuration').value) || 4 : 0;
  store.set('crossfade', crossfadeSeconds ? String(crossfadeSeconds) : '');
});
$('crossfadeDuration').addEventListener('input', event => {
  const value = Math.max(2, Math.min(8, Number(event.currentTarget.value) || 4));
  $('crossfadeDurationLabel').textContent = `${value} segundos`;
  if ($('crossfadeToggle').checked) { crossfadeSeconds = value; store.set('crossfade', String(value)); }
});
window.isotopus.onTrayUnavailable?.(() => { $('minimizeToTrayToggle').checked = false; store.set('minimizeToTray', ''); toast('A bandeja do sistema não está disponível neste ambiente.'); });
$('queueToggle').addEventListener('click', () => {
  const open = $('queuePopover').hidden;
  $('queuePopover').hidden = !open; $('queueToggle').setAttribute('aria-expanded', String(open));
  if (open) renderQueuePopover();
});
$('clearQueueButton').addEventListener('click', () => {
  const playing = currentTrack && !audio.paused ? currentTrack : null;
  queue = playing ? [playing] : []; queueIndex = playing ? 0 : -1;
  renderQueuePopover(); if (activeView === 'queue') openView('queue', false);
  toast(playing ? 'A fila futura foi limpa; a faixa atual continua tocando.' : 'Fila limpa.');
});
$('saveSmartFolder').addEventListener('click', saveSmartFolder);
$('cancelSmartFolder').addEventListener('click', () => { smartFolderEditingId = ''; $('smartFolderDialog').close(); });
bindStyledSelect('whisperModelSelect', model => { store.set('whisperModel', model); refreshWhisperModelManager(); });
$('deleteWhisperModelButton').addEventListener('click', async () => {
  const model = $('whisperModelSelect').dataset.value;
  if (!window.confirm(`Excluir o cache local do Whisper ${model}? Ele será baixado novamente quando você usar esse modelo.`)) return;
  const result = await window.isotopus.deleteWhisperModel(model);
  if (result?.ok) toast(`Cache Whisper ${model} removido.`); else toast(result?.error || 'Não consegui excluir o modelo.');
  refreshWhisperModelManager();
});
$('cancelLyricsAutoSyncButton').addEventListener('click', async () => {
  const cancelled = await window.isotopus.cancelLyricsAlignment();
  if (!cancelled) setLyricsStatus('Não há análise ativa para cancelar.');
});
$('exportQueueButton').addEventListener('click', exportQueue);
$('visualizerStyle').dataset.value = ['spectrum', 'waveform', 'bars', 'circular', 'minimal'].includes(store.get('visualizerStyle')) ? store.get('visualizerStyle') : 'spectrum';
setStyledSelect('visualizerStyle', $('visualizerStyle').dataset.value);
bindStyledSelect('visualizerStyle', style => store.set('visualizerStyle', style));
let visualizerFrame = 0, visualizerLastPaint = 0, visualizerSpectrumLimit = 0;
let visualizerFrequency = null, visualizerWaveform = null;
function drawAudioVisualizer(timestamp = 0) {
  if (!$('visualizerDialog').open) { cancelAnimationFrame(visualizerFrame); visualizerFrame = 0; return; }
  const canvas = $('visualizerCanvas'), context = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.clearRect(0, 0, width, height);
  const analyser = equalizer.analyser(audio);
  if (!analyser || audio.paused) { $('visualizerStatus').textContent = analyser ? 'Reproduza uma faixa para visualizar o sinal.' : 'Inicie a reprodução para preparar a análise de áudio.'; cancelAnimationFrame(visualizerFrame); visualizerFrame = 0; return; }
  visualizerFrame = requestAnimationFrame(drawAudioVisualizer);
  if (timestamp - visualizerLastPaint < 33) return;
  visualizerLastPaint = timestamp;
  $('visualizerStatus').textContent = 'Sinal capturado do áudio que está tocando neste momento.';
  if (!visualizerFrequency || visualizerFrequency.length !== analyser.frequencyBinCount) visualizerFrequency = new Uint8Array(analyser.frequencyBinCount);
  if (!visualizerWaveform || visualizerWaveform.length !== analyser.fftSize) visualizerWaveform = new Uint8Array(analyser.fftSize);
  const frequency = visualizerFrequency, waveform = visualizerWaveform; analyser.getByteFrequencyData(frequency); analyser.getByteTimeDomainData(waveform);
  let lastActiveBin = 0;
  for (let i = frequency.length - 1; i >= 0; i--) {
    if (frequency[i] > 9) { lastActiveBin = i; break; }
  }
  const targetSpectrumLimit = Math.max(64, Math.min(frequency.length, lastActiveBin + 1));
  if (!visualizerSpectrumLimit) visualizerSpectrumLimit = targetSpectrumLimit;
  const spectrumEase = targetSpectrumLimit > visualizerSpectrumLimit ? .14 : .045;
  visualizerSpectrumLimit += (targetSpectrumLimit - visualizerSpectrumLimit) * spectrumEase;
  const spectrumLimit = Math.max(1, Math.min(frequency.length, Math.round(visualizerSpectrumLimit)));
  const style = $('visualizerStyle').dataset.value, color = getComputedStyle(document.body).getPropertyValue('--fresh-accent').trim() || '#ff6e4a';
  context.lineWidth = Math.max(2, dpr * 2); context.strokeStyle = color; context.fillStyle = color; context.lineCap = 'round'; context.lineJoin = 'round';
  if (style === 'bars') {
    const count = 48, gap = width / count * .28, barWidth = width / count - gap;
    for (let i = 0; i < count; i++) { const value = frequency[Math.min(spectrumLimit - 1, Math.floor(i / count * spectrumLimit))] / 255; const barHeight = Math.max(dpr * 2, value * height * .82); context.globalAlpha = .55 + value * .45; context.fillRect(i * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight); }
  } else if (style === 'circular') {
    const cx = width / 2, cy = height / 2, radius = Math.min(width, height) * .2;
    for (let i = 0; i < 180; i++) { const value = frequency[Math.floor(i / 180 * frequency.length)] / 255, angle = i / 180 * Math.PI * 2; const outer = radius + value * height * .22; context.globalAlpha = .4 + value * .6; context.beginPath(); context.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius); context.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer); context.stroke(); }
  } else {
    const source = style === 'waveform' || style === 'minimal' ? waveform : frequency;
    context.beginPath();
    const points = Math.min(style === 'spectrum' ? spectrumLimit : source.length, 512);
    for (let i = 0; i < points; i++) { const x = i / (points - 1) * width; const raw = source[Math.floor(i / points * (style === 'spectrum' ? spectrumLimit : source.length))]; const y = style === 'waveform' || style === 'minimal' ? height / 2 + (raw - 128) / 128 * height * (style === 'minimal' ? .17 : .4) : height * .86 - raw / 255 * height * .72; if (!i) context.moveTo(x, y); else context.lineTo(x, y); }
    context.stroke();
  }
  context.globalAlpha = 1;
}
$('visualizerButton').addEventListener('click', () => { $('visualizerDialog').showModal(); cancelAnimationFrame(visualizerFrame); visualizerFrame = requestAnimationFrame(drawAudioVisualizer); });
$('visualizerDialog').addEventListener('close', () => { cancelAnimationFrame(visualizerFrame); visualizerFrame = 0; });
$('miniPlayerButton').addEventListener('click', () => window.isotopus.openMiniPlayer().then(ok => { if (!ok) toast('Não consegui abrir o mini player.'); }).catch(() => toast('Não consegui abrir o mini player.')));
window.isotopus.onMiniPlayerCommand(command => {
  if (!command) return;
  if (command.type === 'playPause') { if (audio.paused) equalizer.play(audio).catch(error => toast(`Não foi possível reproduzir: ${error.message}`)); else pausePlayback(); }
  else if (command.type === 'next') nextTrack();
  else if (command.type === 'previous') previousTrack();
  else if (command.type === 'seek' && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, command.value));
  else if (command.type === 'volume') { $('volume').value = String(Math.round(command.value)); $('volume').dispatchEvent(new Event('input')); }
});
window.isotopus.onMiniPlayerRequestState(publishMiniPlayerState);
window.isotopus.onMiniPlayerVisibility?.(visible => { miniPlayerVisible = Boolean(visible); if (miniPlayerVisible) publishMiniPlayerState(); });
document.addEventListener('pointerdown', event => {
  if (!$('queuePopover').hidden && !event.target.closest('#queuePopover') && !event.target.closest('#queueToggle')) {
    $('queuePopover').hidden = true; $('queueToggle').setAttribute('aria-expanded', 'false');
  }
});
$('trackArt').addEventListener('click', openLyricsScreen);
$('lyricsMinimize').addEventListener('click', minimizeLyricsScreen);
$('lyricsMenuButton').addEventListener('click', () => { $('lyricsMenu').hidden = !$('lyricsMenu').hidden; });
$('searchLyricsButton').addEventListener('click', searchLyricsOnline);
$('lyricsAutoSyncButton').addEventListener('click', runAutomaticLyricsSync);
$('autoSyncLyricsMenuButton').addEventListener('click', runAutomaticLyricsSync);
$('pasteLyricsButton').addEventListener('click', openLyricsPasteDialog);
$('searchWebLyricsButton').addEventListener('click', searchLyricsWeb);
$('applyLyricsPaste').addEventListener('click', applyPastedLyrics);
$('cancelLyricsPaste').addEventListener('click', () => $('lyricsPasteDialog').close());
$('openLyricsButton').addEventListener('click', openLyricsFile);
$('saveLyricsButton').addEventListener('click', saveCurrentLyrics);
$('syncLyricsButton').addEventListener('click', () => { $('lyricsMenu').hidden = true; $('lyricsSyncPanel').hidden = !$('lyricsSyncPanel').hidden; });
$('markLyricsToggle').addEventListener('click', event => {
  if (!currentLyrics.lines.length) { setLyricsStatus('Adicione uma letra antes de marcar os tempos.'); return; }
  if (manualRedoPending && manualLyricsMode) manualRedoPending = false;
  manualLyricsMode = !manualLyricsMode;
  if (manualLyricsMode) {
    if (currentLyrics.synced) manualRedoPending = true;
    else { $('lyricsOffset').value = '0'; $('lyricsOffset').dispatchEvent(new Event('input')); }
  }
  event.currentTarget.textContent = manualLyricsMode ? 'Concluir marcação manual' : currentLyrics.synced ? 'Refazer sincronização manual' : 'Marcar linhas durante a reprodução';
  setLyricsStatus(manualLyricsMode
    ? manualRedoPending ? 'A marcação atual só será substituída quando você marcar a primeira linha.' : 'Clique em cada linha no instante em que ela é cantada.'
    : 'Marcação manual pausada.');
  renderLyricsLines(); updateManualSyncProgress();
});
$('lyricsOffset').addEventListener('input', event => {
  const value = Number(event.currentTarget.value); $('lyricsOffsetValue').textContent = `${value.toFixed(1)} s`;
  if (currentTrack) store.set(`lyricsOffset:${currentTrack.id}`, String(value));
  persistLyricsState();
  updateLyricsHighlight(true);
});
$('manualSyncNext').addEventListener('click', markNextLyricsLine);
function adjustLyricsOffset(delta) { $('lyricsOffset').value = Math.max(-10, Math.min(10, Number($('lyricsOffset').value) + delta)); $('lyricsOffset').dispatchEvent(new Event('input')); }
$('lyricsOffsetMinus').addEventListener('click', () => adjustLyricsOffset(-0.1));
$('lyricsOffsetPlus').addEventListener('click', () => adjustLyricsOffset(0.1));
$('lyricsSeek').addEventListener('input', event => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.currentTarget.value); });
$('lyricsVolumeToggle').addEventListener('click', () => { const panel = $('lyricsVolumeControl'), opening = panel.hidden; panel.hidden = !opening; $('lyricsVolumeToggle').setAttribute('aria-expanded', String(opening)); if (opening) $('lyricsVolume').focus(); });
$('lyricsVolume').addEventListener('input', event => { $('volume').value = event.currentTarget.value; $('volume').dispatchEvent(new Event('input')); });
$('lyricsPlay').addEventListener('click', () => $('playButton').click());
$('lyricsPrevious').addEventListener('click', previousTrack); $('lyricsNext').addEventListener('click', nextTrack);
$('lyricsShuffle').addEventListener('click', () => $('shuffleButton').click());
$('lyricsRepeat').addEventListener('click', () => $('repeatButton').click());
$('lyricsScreen').addEventListener('click', event => { if (event.target === $('lyricsScreen')) minimizeLyricsScreen(); });
$('playlistName').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('savePlaylist').click(); } });
$('newPlaylistButton').addEventListener('click', () => { playlistPendingTrackId = ''; openPlaylistDialog(); });
$('createPlaylistFromPicker').addEventListener('click', () => {
  $('playlistPickerDialog').close(); openPlaylistDialog(playlistPendingTrackId ? [playlistPendingTrackId] : []);
});
$('cancelPlaylist').addEventListener('click', () => $('playlistDialog').close());
$('savePlaylist').addEventListener('click', () => {
  const name = $('playlistName').value.trim();
  if (!name) { toast('Dê um nome para a playlist.'); $('playlistName').focus(); return; }
  if (playlists.some(item => item.id !== playlistEditingId && normalizeSearch(item.name) === normalizeSearch(name))) { toast('Já existe uma playlist com esse nome.'); return; }
  const editing = playlists.find(item => item.id === playlistEditingId);
  if (editing) {
    editing.name = name; savePlaylists(); $('playlistDialog').close(); playlistEditingId = '';
    openView(activeView === `playlist:${editing.id}` ? activeView : 'playlists', false); toast(`Playlist renomeada para “${name}”.`); return;
  }
  if (playlistPendingTrackId && !playlistDraftIds.includes(playlistPendingTrackId)) playlistDraftIds.push(playlistPendingTrackId);
  const id = globalThis.crypto?.randomUUID?.() || `playlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  playlists.unshift({ id, name, trackIds: [...playlistDraftIds] }); savePlaylists();
  $('playlistDialog').close(); playlistPendingTrackId = '';
  openView(`playlist:${id}`); toast(`Playlist “${name}” criada.`);
});
$('cancelDeletePlaylist').addEventListener('click', () => { $('deletePlaylistDialog').close(); playlistDeletePendingId = ''; });
$('confirmDeletePlaylist').addEventListener('click', () => {
  const deleted = playlists.find(item => item.id === playlistDeletePendingId);
  if (!deleted) { $('deletePlaylistDialog').close(); playlistDeletePendingId = ''; return; }
  playlists = playlists.filter(item => item.id !== deleted.id); savePlaylists(); $('deletePlaylistDialog').close(); playlistDeletePendingId = '';
  if (activeView === `playlist:${deleted.id}`) openView('playlists', false);
  else if (activeView === 'playlists') renderPlaylistCollection();
  $('playlistCount').textContent = `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`;
  toast(`Playlist “${deleted.name}” excluída. Os arquivos continuam na biblioteca.`);
});
function attachAudioDeck(deck) {
  deck.addEventListener('loadedmetadata', event => { if (event.currentTarget === audio) { lastMediaPositionUpdate = 0; updateTimeline(); updateMediaSession(); } });
  deck.addEventListener('seeked', event => { if (event.currentTarget === audio) { lastMediaPositionUpdate = 0; updateMediaSession(); } });
  deck.addEventListener('timeupdate', event => {
    if (event.currentTarget !== audio) return;
    updateTimeline(); updateMediaSession(); recordListeningProgress(); beginCrossfade();
  });
  deck.addEventListener('play', event => { if (event.currentTarget === audio) { renderCurrentTrack(); if ($('visualizerDialog').open && !visualizerFrame) visualizerFrame = requestAnimationFrame(drawAudioVisualizer); } });
  deck.addEventListener('pause', event => { if (event.currentTarget === audio) { finishListeningSession(); renderCurrentTrack(); if (audio.paused) { cancelAnimationFrame(visualizerFrame); visualizerFrame = 0; } } });
  deck.addEventListener('ended', event => { if (event.currentTarget === audio && !crossfadeActive) nextTrack(); });
  deck.addEventListener('error', event => { if (event.currentTarget === audio && currentTrack) recoverAfterPlaybackError(currentTrack); });
}
attachAudioDeck(audio); attachAudioDeck(standbyAudio);
if (navigator.mediaSession) {
  for (const [action, handler] of Object.entries({ play: () => equalizer.play(audio), pause: pausePlayback, previoustrack: previousTrack, nexttrack: nextTrack, seekbackward: details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); }, seekforward: details => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10)); }, seekto: details => { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, details.seekTime)); } })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  }
}
window.isotopus.onLibraryUpdated(data => { applyLibrary(data); if (activeView === 'downloads') updateDownloadFolderOptions(); });
playlists = safeArray('playlists').filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.trackIds));
applyTheme();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if ((store.get('theme') || 'system') === 'system') applyTheme('system'); });
requestAnimationFrame(() => requestAnimationFrame(syncNavIndicator));
window.addEventListener('load', () => requestAnimationFrame(() => requestAnimationFrame(syncNavIndicator)), { once: true });
document.fonts?.ready?.then(() => requestAnimationFrame(syncNavIndicator)).catch(() => {});
const navSidebar = document.querySelector('.sidebar');
navSidebar?.addEventListener('scroll', () => requestAnimationFrame(syncNavIndicator), { passive: true });
if (navSidebar && 'ResizeObserver' in window) new ResizeObserver(() => requestAnimationFrame(syncNavIndicator)).observe(navSidebar);
const savedVolume = Number(store.get('volume'));
baseVolume = Number.isFinite(savedVolume) && store.get('volume') !== '' ? Math.min(1, Math.max(0, savedVolume / 100)) : Number($('volume').value) / 100;
audio.volume = baseVolume; standbyAudio.volume = 0;
$('volume').value = Math.round(baseVolume * 100);
syncLyricsVolume($('volume').value);
crossfadeSeconds = Math.max(0, Math.min(8, Number(store.get('crossfade')) || 0));
shuffled = store.get('shuffle') === 'yes'; $('shuffleButton').classList.toggle('active', shuffled);
repeatMode = Number(store.get('repeat') || 0); if (![0, 1, 2].includes(repeatMode)) repeatMode = 0;
syncTransportStates();
renderQueuePopover();
loadLibrary();
checkForAppUpdate().catch(() => {});
