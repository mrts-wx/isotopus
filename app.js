const $ = id => document.getElementById(id);
const store = {
  get: key => localStorage.getItem(`isotopus.${key}`) || '',
  set: (key, value) => value ? localStorage.setItem(`isotopus.${key}`, value) : localStorage.removeItem(`isotopus.${key}`)
};
const audio = new Audio();
audio.preload = 'metadata';
const shuffleTracks = window.IsotopusShuffle.shuffleTracks;
let tracks = [];
let folders = [];
let activeView = 'listen';
let visibleTracks = [];
let queue = [];
let queueIndex = -1;
let currentTrack = null;
let playlists = [];
let playlistDraftIds = [];
let playlistPendingTrackId = '';
let currentLyrics = { raw: '', synced: false, lines: [], source: '' };
let lyricsTrackId = '';
let manualLyricsMode = false;
let activeLyricIndex = -1;
let shuffled = false;
let repeatMode = 0;
let toastTimer;
let searchTimer;
const PAGE_SIZE = 120;
const titles = { listen: 'Ouvir agora', songs: 'Faixas', albums: 'Álbuns', artists: 'Artistas', favorites: 'Favoritas', recent: 'Tocadas recentemente', folders: 'Pastas', queue: 'Fila de reprodução', playlists: 'Playlists' };
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
  const source = track.coverUrl || 'no-cover.svg';
  element.style.backgroundImage = `url("${source}")`;
  element.style.backgroundSize = 'cover'; element.style.backgroundPosition = 'center';
  element.classList.toggle('missing-cover', !track.coverUrl);
  element.textContent = '';
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
function collectTracks(items) {
  const seen = new Set(), result = [];
  for (const item of items || []) for (const track of item.tracks || [item]) {
    if (track?.id && track.streamUrl && !seen.has(track.id)) { seen.add(track.id); result.push(track); }
  }
  return result;
}
function createTrackCard(item, items, kind) {
  const card = document.createElement('article'); card.className = 'result-card';
  const main = document.createElement('button'); main.className = 'result-main'; main.type = 'button';
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
  main.append(art, copy);
  if (item.id === currentTrack?.id || item.tracks?.some(track => track.id === currentTrack?.id)) card.classList.add('playing-card');
  main.addEventListener('click', () => {
    if (item.kind === 'playlist') openView(`playlist:${item.id}`);
    else if (item.kind === 'album' || item.kind === 'artist') playCollection(item.tracks);
    else if (item.kind === 'folder') { renderFolderDialog(); $('settingsDialog').showModal(); }
    else playTrack(item, items);
  });
  card.append(main);
  if (kind === 'track' && item.id) {
    const inPlaylist = activeView.startsWith('playlist:');
    const action = document.createElement('button'); action.type = 'button'; action.className = `playlist-add${inPlaylist ? ' remove-from-playlist' : ''}`; action.textContent = inPlaylist ? '−' : '＋';
    action.title = inPlaylist ? 'Remover desta playlist' : 'Adicionar a uma playlist';
    action.setAttribute('aria-label', `${inPlaylist ? 'Remover' : 'Adicionar'} ${item.title} ${inPlaylist ? 'desta' : 'a uma'} playlist`);
    action.addEventListener('click', () => {
      if (!inPlaylist) { openPlaylistPicker(item); return; }
      const playlist = playlists.find(entry => entry.id === activeView.slice('playlist:'.length));
      if (playlist) { playlist.trackIds = playlist.trackIds.filter(id => id !== item.id); savePlaylists(); openView(activeView, false); }
    });
    card.append(action);
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
  if (playlistTracks.length && kind !== 'queue' && kind !== 'playlist' && activeView !== 'folders') {
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
function openPlaylistDialog(trackIds = []) {
  playlistDraftIds = [...new Set(trackIds)];
  $('playlistName').value = '';
  $('playlistDraftCount').textContent = playlistDraftIds.length ? `${playlistDraftIds.length} faixas serão adicionadas à playlist.` : 'Playlist vazia. Você poderá adicionar faixas depois.';
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
  const label = document.createElement('span'); label.textContent = `${playlists.length} playlists`;
  const create = document.createElement('button'); create.type = 'button'; create.className = 'secondary-button'; create.textContent = 'Nova playlist';
  create.addEventListener('click', () => openPlaylistDialog());
  toolbar.append(label, create); results.prepend(toolbar);
}
function removeDynamic() { $('dynamicResults')?.remove(); }
function setPageHeading(view) {
  const playlist = view.startsWith('playlist:') ? playlists.find(item => item.id === view.slice('playlist:'.length)) : null;
  const title = playlist?.name || titles[view] || 'Sua biblioteca';
  $('pageTitle').textContent = `${title}.`;
  $('pageSubtitle').textContent = playlist ? `${playlist.trackIds.length} faixas nesta playlist.` : view === 'listen' ? 'Um espaço feito para ouvir com atenção.' : `${tracks.length} faixas disponíveis na sua coleção.`;
}
function openView(view, setSelected = true) {
  activeView = view;
  const navView = view.startsWith('playlist:') ? 'playlists' : view;
  if (setSelected) document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('selected', el.dataset.view === navView));
  syncTransportStates();
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
  if (view === 'playlists') { renderPlaylistCollection(); return; }
  if (view.startsWith('playlist:')) {
    const playlist = playlists.find(item => item.id === view.slice('playlist:'.length));
    if (!playlist) { openView('playlists'); return; }
    renderCards(playlistTracks(playlist), 'Adicione músicas usando o botão + em qualquer faixa.', 'track'); return;
  }
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
function syncTransportStates() {
  const playing = Boolean(currentTrack && !audio.paused);
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
function renderCurrentTrack() {
  if (!currentTrack) {
    $('trackTitle').textContent = 'Escolha uma faixa'; $('trackArtist').textContent = 'Sua música, no seu ritmo';
    $('trackQuality').textContent = 'ÁUDIO LOCAL'; $('trackQuality').classList.remove('compressed');
    coverStyle({}, $('trackArt')); $('likeButton').textContent = '♡';
    $('playButton').textContent = '▶'; $('playButton').title = 'Reproduzir';
    $('likeButton').classList.remove('active'); $('likeButton').setAttribute('aria-pressed', 'false');
    syncTransportStates(); updateMediaSession(); return;
  }
  $('trackTitle').textContent = currentTrack.title;
  $('trackArtist').textContent = `${currentTrack.artist} · ${currentTrack.album}`;
  const quality = $('trackQuality');
  quality.textContent = qualityText(currentTrack);
  quality.classList.toggle('compressed', !currentTrack.lossless);
  const art = $('trackArt'); coverStyle(currentTrack, art);
  const liked = safeArray('favorites').includes(currentTrack.id);
  $('likeButton').textContent = liked ? '♥' : '♡';
  $('likeButton').classList.toggle('active', liked); $('likeButton').setAttribute('aria-pressed', String(liked));
  $('playButton').textContent = audio.paused ? '▶' : 'Ⅱ';
  $('playButton').title = audio.paused ? 'Reproduzir' : 'Pausar';
  syncTransportStates();
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
async function playTrack(track, list = tracks, { keepQueue = false } = {}) {
  if (!track) return;
  const source = list.length ? list : [track];
  if (keepQueue) { queue = source; queueIndex = Math.max(0, queue.findIndex(item => item.id === track.id)); }
  else if (shuffled && source.length > 1) { queue = [track, ...shuffleTracks(source.filter(item => item.id !== track.id))]; queueIndex = 0; }
  else { queue = source; queueIndex = Math.max(0, queue.findIndex(item => item.id === track.id)); }
  currentTrack = track;
  renderCurrentTrack();
  audio.src = track.streamUrl; audio.load();
  if (!$('lyricsScreen').hidden) loadCurrentLyrics();
  try {
    await audio.play();
    rememberTrack(track); renderCurrentTrack();
  } catch (error) { toast(`Não foi possível reproduzir ${track.codec}: ${error.message}`); }
}
function playCollection(items) {
  if (!items?.length) return;
  queue = items; queueIndex = 0; playTrack(queue[0], queue);
}
async function nextTrack() {
  if (!queue.length) return;
  if (repeatMode === 2 && currentTrack) { audio.currentTime = 0; await audio.play(); return; }
  if (queueIndex + 1 < queue.length) queueIndex++;
  else if (repeatMode === 1) queueIndex = 0;
  else { currentTrack = null; audio.pause(); audio.removeAttribute('src'); audio.load(); renderCurrentTrack(); return; }
  playTrack(queue[queueIndex], queue, { keepQueue: true });
}
function previousTrack() {
  if (!queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  queueIndex = Math.max(0, queueIndex - 1); playTrack(queue[queueIndex], queue, { keepQueue: true });
}
function updateTimeline() {
  const duration = Number(audio.duration) || 0;
  $('seek').max = duration || 100; $('seek').value = Math.min(audio.currentTime || 0, duration || 100);
  $('elapsed').textContent = fmt(audio.currentTime); $('duration').textContent = fmt(duration);
  $('lyricsSeek').max = duration || 100; $('lyricsSeek').value = Math.min(audio.currentTime || 0, duration || 100);
  $('lyricsElapsed').textContent = fmt(audio.currentTime); $('lyricsDuration').textContent = fmt(duration);
  updateLyricsHighlight();
}
function setLyricsStatus(message) { $('lyricsStatus').textContent = message; }
function showLyricsEmpty(message) {
  $('lyricsLines').replaceChildren(); const empty = document.createElement('div'); empty.className = 'lyrics-empty'; empty.textContent = message; $('lyricsLines').append(empty);
}
function applyLyricsText(raw, source = 'Letra adicionada') {
  const parsed = window.IsotopusLyrics.parseLyrics(raw);
  currentLyrics = { raw: String(raw || ''), synced: parsed.synced, lines: parsed.lines, source };
  manualLyricsMode = false; activeLyricIndex = -1;
  const savedOffset = Number(store.get(`lyricsOffset:${lyricsTrackId}`));
  $('lyricsOffset').value = Number.isFinite(savedOffset) ? Math.max(-10, Math.min(10, savedOffset)) : 0;
  $('lyricsOffsetValue').textContent = `${Number($('lyricsOffset').value).toFixed(1)} s`;
  $('markLyricsToggle').hidden = parsed.synced || !parsed.lines.length;
  setLyricsStatus(parsed.lines.length ? `${source} · ${parsed.synced ? 'sincronizada' : 'sem tempos'}` : 'Nenhuma letra encontrada.');
  renderLyricsLines();
}
function renderLyricsLines() {
  const container = $('lyricsLines'); container.replaceChildren(); activeLyricIndex = -1;
  if (!currentLyrics.lines.length) { showLyricsEmpty('Abra um arquivo LRC/TXT ou busque uma letra na web.'); return; }
  currentLyrics.lines.forEach((line, index) => {
    const row = document.createElement(manualLyricsMode ? 'button' : 'div');
    row.className = 'lyrics-line'; row.dataset.index = String(index);
    if (manualLyricsMode) {
      row.type = 'button'; row.title = 'Marcar esta linha no tempo atual';
      row.textContent = `${line.time == null ? '○' : fmt(line.time)}  ${line.text}`;
      row.addEventListener('click', () => { line.time = audio.currentTime || 0; row.textContent = `${fmt(line.time)}  ${line.text}`; setLyricsStatus(`Linha marcada em ${fmt(line.time)}.`); updateLyricsHighlight(true); });
    } else row.textContent = line.text;
    container.append(row);
  });
  updateLyricsHighlight(true);
}
function updateLyricsHighlight(forceScroll = false) {
  if ($('lyricsScreen').hidden || !currentLyrics.lines.length) return;
  const offset = Number($('lyricsOffset').value) || 0;
  const position = Math.max(0, audio.currentTime - offset);
  let next = -1;
  for (let i = 0; i < currentLyrics.lines.length; i++) if (currentLyrics.lines[i].time != null && currentLyrics.lines[i].time <= position) next = i;
  if (next < 0) next = currentLyrics.lines.findIndex(line => line.time != null);
  $('lyricsLines').querySelectorAll('.lyrics-line').forEach((row, index) => row.classList.toggle('active', index === next));
  if (next >= 0 && (forceScroll || next !== activeLyricIndex)) $('lyricsLines').children[next]?.scrollIntoView({ block: 'center', behavior: forceScroll ? 'auto' : 'smooth' });
  activeLyricIndex = next;
}
async function loadCurrentLyrics() {
  if (!currentTrack) return;
  lyricsTrackId = currentTrack.id;
  $('lyricsTrackTitle').textContent = currentTrack.title; $('lyricsTrackArtist').textContent = `${currentTrack.artist} · ${currentTrack.album}`;
  $('lyricsHeading').textContent = currentTrack.title; coverStyle(currentTrack, $('lyricsCover'));
  currentLyrics = { raw: '', synced: false, lines: [], source: '' }; manualLyricsMode = false;
  $('lyricsSyncPanel').hidden = true; $('lyricsMenu').hidden = true;
  showLyricsEmpty('Procurando uma letra local…'); setLyricsStatus('Verificando arquivo .lrc local');
  const result = await window.isotopus.getLocalLyrics(currentTrack.id);
  if (lyricsTrackId !== currentTrack.id) return;
  if (result?.content) applyLyricsText(result.content, 'Arquivo local');
  else { showLyricsEmpty('Nenhuma letra local. Abra o menu para buscar na web ou importar um arquivo.'); setLyricsStatus('Sem letra para esta faixa'); }
}
async function openLyricsScreen() {
  if (!currentTrack) { toast('Reproduza ou selecione uma faixa primeiro.'); return; }
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
      else { currentLyrics = { raw: '', synced: false, lines: [], source: 'LRCLIB' }; showLyricsEmpty('Esta faixa está marcada como instrumental.'); setLyricsStatus('Instrumental'); }
      $('lyricsSearchDialog').close();
    });
    list.append(button);
  }
  if (!result.records.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'Nenhuma letra encontrada para esta faixa.'; list.append(empty); }
  $('lyricsSearchDialog').showModal(); setLyricsStatus(`${result.records.length} resultados do LRCLIB`);
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
  const result = await window.isotopus.saveLyrics(currentTrack.id, content);
  if (result?.ok) {
    if (currentLyrics.synced && offset) { store.set(`lyricsOffset:${currentTrack.id}`, '0'); $('lyricsOffset').value = '0'; }
    applyLyricsText(content, 'Salva ao lado da música'); setLyricsStatus(`Salva em ${result.path}`);
  }
  else if (result?.error) setLyricsStatus(result.error);
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
  try { if (audio.paused) await audio.play(); else audio.pause(); renderCurrentTrack(); }
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
$('volume').addEventListener('input', event => { audio.volume = Number(event.currentTarget.value) / 100; store.set('volume', event.currentTarget.value); });
$('likeButton').addEventListener('click', () => {
  if (!currentTrack) return toast('Selecione uma faixa primeiro.');
  const favorites = new Set(safeArray('favorites'));
  favorites.has(currentTrack.id) ? favorites.delete(currentTrack.id) : favorites.add(currentTrack.id);
  store.set('favorites', JSON.stringify([...favorites])); renderCurrentTrack();
  if (activeView === 'favorites') openView('favorites');
});
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
$('trackArt').addEventListener('click', openLyricsScreen);
$('lyricsMinimize').addEventListener('click', minimizeLyricsScreen);
$('lyricsMenuButton').addEventListener('click', () => { $('lyricsMenu').hidden = !$('lyricsMenu').hidden; });
$('searchLyricsButton').addEventListener('click', searchLyricsOnline);
$('openLyricsButton').addEventListener('click', openLyricsFile);
$('saveLyricsButton').addEventListener('click', saveCurrentLyrics);
$('syncLyricsButton').addEventListener('click', () => { $('lyricsMenu').hidden = true; $('lyricsSyncPanel').hidden = !$('lyricsSyncPanel').hidden; });
$('markLyricsToggle').addEventListener('click', event => {
  if (!currentLyrics.lines.length) { setLyricsStatus('Adicione uma letra antes de marcar os tempos.'); return; }
  manualLyricsMode = !manualLyricsMode;
  if (manualLyricsMode) { $('lyricsOffset').value = '0'; $('lyricsOffset').dispatchEvent(new Event('input')); }
  event.currentTarget.textContent = manualLyricsMode ? 'Concluir marcação manual' : 'Marcar linhas durante a reprodução';
  setLyricsStatus(manualLyricsMode ? 'Clique em cada linha no instante em que ela é cantada.' : 'Marcação manual pausada.');
  renderLyricsLines();
});
$('lyricsOffset').addEventListener('input', event => {
  const value = Number(event.currentTarget.value); $('lyricsOffsetValue').textContent = `${value.toFixed(1)} s`;
  if (currentTrack) store.set(`lyricsOffset:${currentTrack.id}`, String(value));
  updateLyricsHighlight(true);
});
function adjustLyricsOffset(delta) { $('lyricsOffset').value = Math.max(-10, Math.min(10, Number($('lyricsOffset').value) + delta)); $('lyricsOffset').dispatchEvent(new Event('input')); }
$('lyricsOffsetMinus').addEventListener('click', () => adjustLyricsOffset(-0.1));
$('lyricsOffsetPlus').addEventListener('click', () => adjustLyricsOffset(0.1));
$('lyricsSeek').addEventListener('input', event => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.currentTarget.value); });
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
  if (playlists.some(item => normalizeSearch(item.name) === normalizeSearch(name))) { toast('Já existe uma playlist com esse nome.'); return; }
  if (playlistPendingTrackId && !playlistDraftIds.includes(playlistPendingTrackId)) playlistDraftIds.push(playlistPendingTrackId);
  const id = globalThis.crypto?.randomUUID?.() || `playlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  playlists.unshift({ id, name, trackIds: [...playlistDraftIds] }); savePlaylists();
  $('playlistDialog').close(); playlistPendingTrackId = '';
  openView(`playlist:${id}`); toast(`Playlist “${name}” criada.`);
});
audio.addEventListener('loadedmetadata', updateTimeline); audio.addEventListener('timeupdate', updateTimeline);
audio.addEventListener('play', renderCurrentTrack);
audio.addEventListener('pause', renderCurrentTrack);
audio.addEventListener('ended', nextTrack);
audio.addEventListener('timeupdate', updateMediaSession);
audio.addEventListener('error', () => { if (currentTrack) toast(`Este arquivo não pôde ser decodificado (${currentTrack.codec}).`); });
if (navigator.mediaSession) {
  for (const [action, handler] of Object.entries({ play: () => audio.play(), pause: () => audio.pause(), previoustrack: previousTrack, nexttrack: nextTrack, seekbackward: details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); }, seekforward: details => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10)); }, seekto: details => { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, details.seekTime)); } })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  }
}
window.isotopus.onLibraryUpdated(applyLibrary);
playlists = safeArray('playlists').filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.trackIds));
const savedVolume = Number(store.get('volume'));
audio.volume = Number.isFinite(savedVolume) && store.get('volume') !== '' ? Math.min(1, Math.max(0, savedVolume / 100)) : Number($('volume').value) / 100;
$('volume').value = Math.round(audio.volume * 100);
shuffled = store.get('shuffle') === 'yes'; $('shuffleButton').classList.toggle('active', shuffled);
repeatMode = Number(store.get('repeat') || 0); if (![0, 1, 2].includes(repeatMode)) repeatMode = 0;
syncTransportStates();
loadLibrary();
