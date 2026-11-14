const $ = id => document.getElementById(id);
const store = {
  get: key => localStorage.getItem(`isotopus.${key}`) || '',
  set: (key, value) => value ? localStorage.setItem(`isotopus.${key}`, value) : localStorage.removeItem(`isotopus.${key}`)
};
const audio = new Audio();
audio.preload = 'metadata';
let tracks = [];
let folders = [];
let activeView = 'listen';
let visibleTracks = [];
let queue = [];
let queueIndex = -1;
let currentTrack = null;
let shuffled = false;
let repeatMode = 0;
let toastTimer;
let lastPresenceSignature = '';
let searchTimer;
const PAGE_SIZE = 120;
const titles = { listen: 'Ouvir agora', songs: 'Faixas', albums: 'Álbuns', artists: 'Artistas', favorites: 'Favoritas', recent: 'Tocadas recentemente', folders: 'Pastas' };
const safeArray = key => { try { return JSON.parse(store.get(key) || '[]'); } catch { return []; } };
const normalizeSearch = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();

function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
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
function setLibraryState() {
  const count = tracks.length;
  $('heroCard').hidden = folders.length > 0;
  $('accountTitle').textContent = folders.length ? `${folders.length} pasta${folders.length > 1 ? 's' : ''} monitorada${folders.length > 1 ? 's' : ''}` : 'Escolher pasta de música';
  $('accountSubtitle').textContent = count ? `${count} faixa${count === 1 ? '' : 's'} local${count === 1 ? '' : 'is'}` : 'Sua biblioteca fica no seu PC';
  $('connectionLabel').textContent = folders.length ? `${count} faixas · monitorando` : 'Nenhuma pasta monitorada';
  $('connectionLabel').previousElementSibling.classList.toggle('connected', Boolean(folders.length));
  $('libraryStatus').textContent = folders.length ? `${count} FAIXAS LOCAIS` : 'BIBLIOTECA LOCAL';
  $('trackCount').textContent = `${count} faixa${count === 1 ? '' : 's'}`;
  const albums = new Set(tracks.map(t => `${t.albumArtist || t.artist}|${t.album}`));
  $('albumCount').textContent = `${albums.size} ${albums.size === 1 ? 'álbum' : 'álbuns'}`;
  $('folderCount').textContent = `${folders.length} ${folders.length === 1 ? 'pasta' : 'pastas'}`;
}
function coverStyle(track, element) {
  if (track.coverUrl) {
    element.style.backgroundImage = `url("${track.coverUrl}")`;
    element.style.backgroundSize = 'cover'; element.style.backgroundPosition = 'center';
    element.textContent = '';
  } else { element.style.backgroundImage = ''; element.textContent = '♫'; }
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
  renderCards(items, folders.length ? 'Adicione arquivos de áudio às pastas monitoradas para vê-los aqui.' : 'Escolha uma pasta para começar a ouvir sua coleção.');
}
function groupsForAlbums(items) {
  const groups = new Map();
  for (const track of items) {
    const key = `${track.albumArtist || track.artist}|${track.album}`;
    if (!groups.has(key)) groups.set(key, { title: track.album, artist: track.albumArtist || track.artist, tracks: [], coverUrl: track.coverUrl, kind: 'album' });
    groups.get(key).tracks.push(track);
  }
  return [...groups.values()].map(group => ({ ...group, tracks: group.tracks.sort((a, b) => (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 0) - (b.trackNo || 0)), count: group.tracks.length }));
}
function groupsForArtists(items) {
  const groups = new Map();
  for (const track of items) {
    const name = track.artist || 'Artista desconhecido';
    if (!groups.has(name)) groups.set(name, { title: name, artist: '', coverUrl: track.coverUrl, kind: 'artist', tracks: [] });
    groups.get(name).tracks.push(track);
  }
  return [...groups.values()].map(group => ({ ...group, artist: `${group.tracks.length} faixas` })).sort((a, b) => a.title.localeCompare(b.title));
}
function createTrackCard(item, items, kind) {
  const card = document.createElement('button'); card.className = 'result-card'; card.type = 'button';
  const art = document.createElement('span'); art.className = 'result-art'; coverStyle(item, art);
  const copy = document.createElement('span'); copy.className = 'result-copy';
  const title = document.createElement('b'); title.textContent = item.title;
  const subtitle = document.createElement('small'); subtitle.textContent = item.artist || item.album || '';
  copy.append(title, subtitle);
  if (kind === 'track') {
    const meta = document.createElement('span'); meta.className = 'track-info';
    const quality = document.createElement('span'); quality.className = `quality-badge${item.lossless ? '' : ' compressed'}`; quality.textContent = item.lossless ? 'LOSSLESS' : 'COMPRESSED';
    const duration = document.createElement('small'); duration.textContent = fmt(item.duration);
    meta.append(quality, duration); copy.append(meta);
  } else {
    const extra = document.createElement('small'); extra.textContent = item.kind === 'album' ? `${item.count} faixas` : `${item.tracks?.length || 0} faixas`; extra.className = 'folder-count'; copy.append(extra);
  }
  card.append(art, copy);
  if (item.id === currentTrack?.id || item.tracks?.some(track => track.id === currentTrack?.id)) card.classList.add('playing-card');
  card.addEventListener('click', () => {
    if (item.kind === 'album' || item.kind === 'artist') playCollection(item.tracks);
    else if (item.kind === 'folder') { renderFolderDialog(); $('settingsDialog').showModal(); }
    else playTrack(item, items);
  });
  return card;
}
function renderCards(items, emptyMessage, kind = 'track') {
  let results = $('dynamicResults');
  if (!results) { results = document.createElement('section'); results.id = 'dynamicResults'; results.className = 'section-block'; $('content').append(results); }
  results.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    const strong = document.createElement('strong'); strong.textContent = folders.length ? 'Nada por aqui ainda' : 'Sua biblioteca começa aqui';
    const copy = document.createElement('div'); copy.textContent = emptyMessage;
    empty.append(strong, copy);
    if (!folders.length) { const button = document.createElement('button'); button.className = 'primary-button'; button.textContent = 'Escolher pasta'; button.addEventListener('click', chooseFolders); empty.append(button); }
    results.append(empty); return;
  }
  const grid = document.createElement('div'); grid.className = kind === 'queue' ? 'results-grid queue-list' : 'results-grid';
  let offset = 0;
  results.append(grid);
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
function removeDynamic() { $('dynamicResults')?.remove(); }
function setPageHeading(view) {
  $('pageTitle').innerHTML = `${titles[view] || 'Sua biblioteca'}<span class="gold-dot">.</span>`;
  $('pageSubtitle').textContent = view === 'listen' ? 'Um espaço feito para ouvir com atenção.' : `${tracks.length} faixas disponíveis na sua coleção.`;
}
function openView(view, setSelected = true) {
  activeView = view;
  if (setSelected) document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('selected', el.dataset.view === view));
  setPageHeading(view);
  $('quickSection').hidden = view !== 'listen'; $('catalogSection').hidden = view !== 'listen';
  removeDynamic();
  if (view === 'listen') { renderHome(); return; }
  if (view === 'folders') {
    const items = folders.map(folder => ({ title: folder.split('/').filter(Boolean).at(-1) || folder, artist: folder, kind: 'folder', tracks: tracks.filter(track => track.pathLabel) }));
    renderCards(items, 'Adicione uma pasta para monitorá-la.'); return;
  }
  if (view === 'albums') { renderCards(groupsForAlbums(tracks), 'Os álbuns encontrados aparecerão aqui.', 'album'); return; }
  if (view === 'artists') { renderCards(groupsForArtists(tracks), 'Os artistas encontrados aparecerão aqui.', 'artist'); return; }
  if (view === 'favorites') {
    const ids = new Set(safeArray('favorites'));
    renderCards(tracks.filter(track => ids.has(track.id)), 'Marque uma faixa com o coração para guardá-la aqui.'); return;
  }
  if (view === 'recent') {
    const recent = safeArray('recentIds').map(id => tracks.find(track => track.id === id)).filter(Boolean);
    renderCards(recent, 'As faixas tocadas aparecerão aqui.'); return;
  }
  if (view === 'queue') { renderCards(queue, 'Adicione uma faixa à fila.', 'queue'); renderQueueActions(); return; }
  renderCards(tracks, folders.length ? 'Adicione músicas às pastas monitoradas.' : 'Escolha uma pasta com arquivos de áudio.');
}
function searchLibrary(query) {
  if (!query) { openView(activeView); return; }
  $('quickSection').hidden = true; $('catalogSection').hidden = true;
  $('pageTitle').innerHTML = 'Resultados<span class="gold-dot">.</span>';
  $('pageSubtitle').textContent = `Busca local por “${query}”`;
  const lower = normalizeSearch(query);
  const results = tracks.filter(track => normalizeSearch(`${track.title} ${track.artist} ${track.album} ${track.codec} ${track.genre}`).includes(lower));
  renderCards(results, 'Nenhuma faixa corresponde à busca.');
}
function presenceSignature(track, playing) { return `${track?.id || ''}|${playing}`; }
async function syncPresence(playing = !audio.paused) {
  if (store.get('discordEnabled') !== 'yes') return;
  const signature = presenceSignature(currentTrack, playing);
  if (signature === lastPresenceSignature) return;
  lastPresenceSignature = signature;
  await window.isotopus.discordActivity(currentTrack ? { title: currentTrack.title, artist: currentTrack.artist, playing } : {});
}
function renderCurrentTrack() {
  if (!currentTrack) {
    $('trackTitle').textContent = 'Escolha uma faixa'; $('trackArtist').textContent = 'Sua música, no seu ritmo';
    $('trackQuality').textContent = 'ÁUDIO LOCAL'; $('trackQuality').classList.remove('compressed');
    coverStyle({}, $('trackArt')); $('likeButton').textContent = '♡';
    $('playButton').textContent = '▶'; $('playButton').title = 'Reproduzir'; updateMediaSession(); return;
  }
  $('trackTitle').textContent = currentTrack.title;
  $('trackArtist').textContent = `${currentTrack.artist} · ${currentTrack.album}`;
  const quality = $('trackQuality');
  quality.textContent = qualityText(currentTrack);
  quality.classList.toggle('compressed', !currentTrack.lossless);
  const art = $('trackArt'); coverStyle(currentTrack, art);
  $('likeButton').textContent = safeArray('favorites').includes(currentTrack.id) ? '♥' : '♡';
  $('playButton').textContent = audio.paused ? '▶' : 'Ⅱ';
  $('playButton').title = audio.paused ? 'Reproduzir' : 'Pausar';
  updateMediaSession();
}
function updateMediaSession() {
  const session = navigator.mediaSession;
  if (!session) return;
  try {
    if (currentTrack && typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({ title: currentTrack.title, artist: currentTrack.artist, album: currentTrack.album, artwork: currentTrack.coverUrl ? [{ src: currentTrack.coverUrl, sizes: '512x512' }] : [] });
    } else session.metadata = null;
    session.playbackState = currentTrack ? (audio.paused ? 'paused' : 'playing') : 'none';
    if (Number.isFinite(audio.duration) && audio.duration > 0 && typeof session.setPositionState === 'function') session.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime || 0, audio.duration) });
  } catch {}
}
function rememberTrack(track) {
  const recent = safeArray('recentIds').filter(id => id !== track.id);
  recent.unshift(track.id); store.set('recentIds', JSON.stringify(recent.slice(0, 50)));
}
async function playTrack(track, list = tracks) {
  if (!track) return;
  queue = list.length ? list : [track]; queueIndex = Math.max(0, queue.findIndex(item => item.id === track.id));
  currentTrack = track;
  renderCurrentTrack();
  audio.src = track.streamUrl; audio.load();
  try {
    await audio.play();
    rememberTrack(track); renderCurrentTrack(); await syncPresence(true);
  } catch (error) { toast(`Não foi possível reproduzir ${track.codec}: ${error.message}`); }
}
function playCollection(items) {
  if (!items?.length) return;
  queue = items; queueIndex = 0; playTrack(queue[0], queue);
}
async function nextTrack() {
  if (!queue.length) return;
  if (repeatMode === 2 && currentTrack) { audio.currentTime = 0; await audio.play(); return; }
  if (shuffled && queue.length > 1) {
    let next = queueIndex; while (next === queueIndex) next = Math.floor(Math.random() * queue.length);
    queueIndex = next;
  } else if (queueIndex + 1 < queue.length) queueIndex++;
  else if (repeatMode === 1) queueIndex = 0;
  else { currentTrack = null; audio.pause(); audio.removeAttribute('src'); audio.load(); renderCurrentTrack(); await syncPresence(false); return; }
  playTrack(queue[queueIndex], queue);
}
function previousTrack() {
  if (!queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  queueIndex = Math.max(0, queueIndex - 1); playTrack(queue[queueIndex], queue);
}
function updateTimeline() {
  const duration = Number(audio.duration) || 0;
  $('seek').max = duration || 100; $('seek').value = Math.min(audio.currentTime || 0, duration || 100);
  $('elapsed').textContent = fmt(audio.currentTime); $('duration').textContent = fmt(duration);
}
async function loadLibrary() {
  try { applyLibrary(await window.isotopus.getLibrary()); }
  catch (error) { toast(`Não consegui abrir sua biblioteca: ${error.message}`); }
}
function renderFolderDialog() { renderFolderList(); }
function showSettings() { renderFolderDialog(); $('settingsDialog').showModal(); }

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => openView(button.dataset.view)));
document.querySelectorAll('.quick-card').forEach(button => button.addEventListener('click', () => openView(button.dataset.target)));
$('heroConnect').addEventListener('click', chooseFolders); $('addFolder').addEventListener('click', chooseFolders);
$('accountButton').addEventListener('click', () => folders.length ? showSettings() : chooseFolders());
$('settingsButton').addEventListener('click', showSettings);
$('learnButton').addEventListener('click', () => $('infoDialog').showModal()); $('infoDone').addEventListener('click', () => $('infoDialog').close());
$('viewLibrary').addEventListener('click', () => openView('songs'));
$('rescanButton').addEventListener('click', async () => { toast('Verificando as pastas…'); applyLibrary(await window.isotopus.rescanLibrary()); });
$('rescanLibrary').addEventListener('click', async () => { applyLibrary(await window.isotopus.rescanLibrary()); toast(`${tracks.length} faixas verificadas.`); });
$('backButton').addEventListener('click', () => openView('listen')); $('forwardButton').addEventListener('click', () => toast('Selecione uma seção da biblioteca.'));
$('searchInput').addEventListener('input', event => { clearTimeout(searchTimer); const value = event.currentTarget.value; searchTimer = setTimeout(() => value.trim() ? searchLibrary(value.trim()) : openView(activeView), 120); });
document.addEventListener('keydown', event => {
  const target = event.target;
  const editing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('searchInput').focus(); return; }
  if (editing || $('settingsDialog').open || $('infoDialog').open || event.altKey || event.metaKey || event.ctrlKey) return;
  if (event.code === 'Space') { event.preventDefault(); $('playButton').click(); }
  else if (event.key === 'ArrowRight' && event.shiftKey) { event.preventDefault(); nextTrack(); }
  else if (event.key === 'ArrowLeft' && event.shiftKey) { event.preventDefault(); previousTrack(); }
  else if (event.key === 'ArrowRight' && Number.isFinite(audio.duration)) { event.preventDefault(); audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); }
  else if (event.key === 'ArrowLeft' && Number.isFinite(audio.duration)) { event.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); audio.volume = Math.min(1, audio.volume + 0.05); $('volume').value = Math.round(audio.volume * 100); store.set('volume', String($('volume').value)); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); audio.volume = Math.max(0, audio.volume - 0.05); $('volume').value = Math.round(audio.volume * 100); store.set('volume', String($('volume').value)); }
});
$('playButton').addEventListener('click', async () => {
  if (!currentTrack) { if (!folders.length) chooseFolders(); else openView('songs'); return; }
  try { if (audio.paused) await audio.play(); else audio.pause(); renderCurrentTrack(); await syncPresence(!audio.paused); }
  catch (error) { toast(`Não foi possível reproduzir: ${error.message}`); }
});
$('nextButton').addEventListener('click', nextTrack); $('previousButton').addEventListener('click', previousTrack);
$('shuffleButton').addEventListener('click', event => { shuffled = !shuffled; store.set('shuffle', shuffled ? 'yes' : ''); event.currentTarget.classList.toggle('active', shuffled); toast(shuffled ? 'Aleatório ativado' : 'Aleatório desativado'); });
$('repeatButton').addEventListener('click', event => { repeatMode = (repeatMode + 1) % 3; store.set('repeat', String(repeatMode)); event.currentTarget.classList.toggle('active', repeatMode > 0); toast(['Repetição desativada', 'Repetir fila', 'Repetir faixa'][repeatMode]); });
$('seek').addEventListener('input', event => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.currentTarget.value); });
$('volume').addEventListener('input', event => { audio.volume = Number(event.currentTarget.value) / 100; store.set('volume', event.currentTarget.value); });
$('likeButton').addEventListener('click', () => {
  if (!currentTrack) return toast('Selecione uma faixa primeiro.');
  const favorites = new Set(safeArray('favorites'));
  favorites.has(currentTrack.id) ? favorites.delete(currentTrack.id) : favorites.add(currentTrack.id);
  store.set('favorites', JSON.stringify([...favorites])); renderCurrentTrack();
  if (activeView === 'favorites') openView('favorites');
});
function showQueue() {
  $('quickSection').hidden = true; $('catalogSection').hidden = true;
  $('pageTitle').innerHTML = 'Fila<span class="gold-dot">.</span>';
  $('pageSubtitle').textContent = `${queue.length} faixas na fila de reprodução.`;
  renderCards(queue, 'Selecione uma faixa para montar a fila.', 'queue');
  renderQueueActions();
}
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
$('queueButton').addEventListener('click', showQueue); $('playerQueue').addEventListener('click', showQueue);
$('saveSettings').addEventListener('click', async () => {
  const clientId = $('discordId').value.trim(); store.set('discordId', clientId);
  const enabled = $('discordToggle').checked;
  store.set('discordEnabled', enabled ? 'yes' : '');
  $('settingsDialog').close();
  if (enabled) {
    const result = await window.isotopus.discordConnect({ clientId, track: currentTrack ? { title: currentTrack.title, artist: currentTrack.artist, playing: !audio.paused } : {} });
    if (!result?.ok) { store.set('discordEnabled', ''); $('discordToggle').checked = false; toast(result?.error || 'Não foi possível conectar ao Discord.'); }
    else { lastPresenceSignature = ''; await syncPresence(!audio.paused); toast('Rich Presence ativado.'); }
  } else { lastPresenceSignature = ''; await window.isotopus.discordDisconnect(); toast('Configurações salvas.'); }
});
$('discordToggle').addEventListener('change', event => {
  if (event.currentTarget.checked && !$('discordId').value.trim()) { event.currentTarget.checked = false; toast('Informe o Application ID do Discord primeiro.'); }
});
audio.addEventListener('loadedmetadata', updateTimeline); audio.addEventListener('timeupdate', updateTimeline);
audio.addEventListener('play', () => { renderCurrentTrack(); syncPresence(true); });
audio.addEventListener('pause', () => { renderCurrentTrack(); syncPresence(false); });
audio.addEventListener('ended', nextTrack);
audio.addEventListener('timeupdate', updateMediaSession);
audio.addEventListener('error', () => { if (currentTrack) toast(`Este arquivo não pôde ser decodificado (${currentTrack.codec}).`); });
if (navigator.mediaSession) {
  for (const [action, handler] of Object.entries({ play: () => audio.play(), pause: () => audio.pause(), previoustrack: previousTrack, nexttrack: nextTrack, seekbackward: details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); }, seekforward: details => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10)); }, seekto: details => { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, details.seekTime)); } })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  }
}
window.isotopus.onLibraryUpdated(applyLibrary);
$('discordId').value = store.get('discordId'); $('discordToggle').checked = store.get('discordEnabled') === 'yes';
const savedVolume = Number(store.get('volume'));
audio.volume = Number.isFinite(savedVolume) && store.get('volume') !== '' ? Math.min(1, Math.max(0, savedVolume / 100)) : Number($('volume').value) / 100;
$('volume').value = Math.round(audio.volume * 100);
shuffled = store.get('shuffle') === 'yes'; $('shuffleButton').classList.toggle('active', shuffled);
repeatMode = Number(store.get('repeat') || 0); if (![0, 1, 2].includes(repeatMode)) repeatMode = 0;
$('repeatButton').classList.toggle('active', repeatMode > 0);
loadLibrary();
