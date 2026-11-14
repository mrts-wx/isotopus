const $ = id => document.getElementById(id);
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
const titles = { listen: 'Ouvir agora', songs: 'Faixas', artists: 'Artistas', favorites: 'Favoritas', playlists: 'Playlists' };
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
  $('accountTitle').textContent = folders.length ? `${folders.length} pasta${folders.length > 1 ? 's' : ''} monitorada${folders.length > 1 ? 's' : ''}` : 'Escolher pasta de música';
  $('accountSubtitle').textContent = count ? `${count} faixa${count === 1 ? '' : 's'} local${count === 1 ? '' : 'is'}` : 'Sua biblioteca fica no seu PC';
  $('connectionLabel').textContent = folders.length ? `${count} faixas · monitorando` : 'Nenhuma pasta monitorada';
  $('connectionLabel').previousElementSibling.classList.toggle('connected', Boolean(folders.length));
  $('libraryStatus').textContent = folders.length ? `${count} FAIXAS LOCAIS` : 'BIBLIOTECA LOCAL';
  $('trackCount').textContent = `${count} faixa${count === 1 ? '' : 's'}`;
  $('playlistCount').textContent = `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`;
  const favoriteCount = safeArray('favorites').length;
  $('favoriteCount').textContent = `${favoriteCount} favorita${favoriteCount === 1 ? '' : 's'}`;
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
  const grid = $('recentGrid'); grid.replaceChildren();
  renderLosslessHome();
  $('recentHeading').textContent = recents.length ? 'Tocadas recentemente' : 'Adicionadas recentemente';
  $('viewRecent').hidden = !recents.length;
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'home-empty';
    empty.innerHTML = '<span class="home-empty-mark">♫</span><div><b>Seu próximo som começa aqui</b><small>Escolha uma pasta de músicas e suas capas aparecerão neste espaço.</small></div>';
    const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = 'Escolher pasta'; button.addEventListener('click', chooseFolders); empty.append(button); grid.append(empty); return;
  }
  items.forEach(track => grid.append(createTrackCard(track, items, 'track')));
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
    else if (item.kind === 'folder') { renderFolderDialog(); $('settingsDialog').showModal(); }
    else playTrack(item, items);
  });
  card.append(main);
  if ((kind === 'track' || kind === 'playlist-track') && item.id) {
    const inPlaylist = kind === 'playlist-track' || activeView.startsWith('playlist:');
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
  $('quickSection').hidden = view !== 'listen'; $('catalogSection').hidden = view !== 'listen'; $('recentSection').hidden = view !== 'listen';
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
    const row = document.createElement('button'); row.type = 'button'; row.className = 'queue-popover-row';
    if (index === queueIndex) row.classList.add('current');
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('span'); copy.className = 'queue-popover-copy';
    const title = document.createElement('b'); title.textContent = track.title;
    const artist = document.createElement('small'); artist.textContent = track.artist;
    copy.append(title, artist); row.append(number, copy);
    row.addEventListener('click', () => { queueIndex = index; $('queuePopover').hidden = true; $('queueToggle').setAttribute('aria-expanded', 'false'); playTrack(track, queue, { keepQueue: true }); });
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
    coverStyle({}, $('trackArt')); $('likeButton').textContent = '♡';
    setPlayIcon($('playButton'), false); setPlayIcon($('lyricsPlay'), false);
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
  syncTransportStates();
  updateMediaSession();
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
  incoming.play().then(() => {
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
    if (currentTrack && typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({ title: currentTrack.title, artist: currentTrack.artist, album: currentTrack.album, artwork: [{ src: currentTrack.coverUrl || 'build/icons/512x512.png', sizes: '512x512', type: 'image/png' }] });
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
    await audio.play();
    rememberTrack(track); renderCurrentTrack();
  } catch (error) { toast(`Não foi possível reproduzir ${track.codec}: ${error.message}`); }
}
function playCollection(items, { shuffle = shuffled } = {}) {
  if (!items?.length) return;
  queue = shuffle ? shuffleTracks(items) : items.slice();
  if (shuffle) { shuffled = true; store.set('shuffle', 'yes'); syncTransportStates(); }
  queueIndex = 0; renderQueuePopover(); playTrack(queue[0], queue, { keepQueue: true });
}
async function nextTrack() {
  if (!queue.length) return;
  cancelCrossfade();
  if (repeatMode === 2 && currentTrack) { audio.currentTime = 0; await audio.play(); return; }
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
  $('elapsed').textContent = fmt(audio.currentTime); $('duration').textContent = fmt(duration);
  $('lyricsSeek').max = duration || 100; $('lyricsSeek').value = Math.min(audio.currentTime || 0, duration || 100);
  $('lyricsElapsed').textContent = fmt(audio.currentTime); $('lyricsDuration').textContent = fmt(duration);
  updateLyricsHighlight();
}
function setLyricsStatus(message) { $('lyricsStatus').textContent = message; }
function showLyricsEmpty(message) {
  $('lyricsLines').replaceChildren(); const empty = document.createElement('div'); empty.className = 'lyrics-empty'; empty.textContent = message; $('lyricsLines').append(empty);
}
function showLyricsActions() {
  const actions = document.createElement('div'); actions.className = 'lyrics-empty-actions';
  const web = document.createElement('button'); web.type = 'button'; web.className = 'secondary-button'; web.textContent = 'Pesquisar letra na web'; web.addEventListener('click', () => { openLyricsPasteDialog(); searchLyricsWeb(); });
  const paste = document.createElement('button'); paste.type = 'button'; paste.className = 'secondary-button'; paste.textContent = 'Colar letra copiada'; paste.addEventListener('click', openLyricsPasteDialog);
  actions.append(web, paste); $('lyricsLines').append(actions);
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
  updateManualSyncProgress();
  persistLyricsState();
}
function persistLyricsState() {
  if (!lyricsTrackId || !currentLyrics.lines.length) return Promise.resolve();
  const state = { raw: currentLyrics.raw, synced: currentLyrics.synced, lines: currentLyrics.lines, offset: Number($('lyricsOffset').value) || 0 };
  return window.isotopus.saveLyricsState(lyricsTrackId, state).catch(() => {});
}
function updateManualSyncProgress() {
  const marked = currentLyrics.lines.filter(line => line.time != null).length;
  $('manualSyncProgress').textContent = `${marked} de ${currentLyrics.lines.length} linhas marcadas`;
  $('manualSyncNext').disabled = !currentLyrics.lines.length || marked >= currentLyrics.lines.length;
}
async function markLyricsLine(index) {
  const line = currentLyrics.lines[index]; if (!line) return;
  line.time = Math.max(0, audio.currentTime || 0);
  const marked = currentLyrics.lines.filter(item => item.time != null).length;
  if (marked === currentLyrics.lines.length) {
    currentLyrics.synced = true; currentLyrics.raw = window.IsotopusLyrics.formatLyrics(currentLyrics.lines);
    manualLyricsMode = false; $('markLyricsToggle').hidden = true;
    $('markLyricsToggle').textContent = 'Marcar linhas durante a reprodução';
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
  const index = currentLyrics.lines.findIndex(line => line.time == null);
  if (index >= 0) markLyricsLine(index);
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
      row.addEventListener('click', () => markLyricsLine(index));
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
  const rows = $('lyricsLines').querySelectorAll('.lyrics-line');
  rows.forEach(row => row.classList.remove('active', 'lyrics-neighbor'));
  if (next >= 0) {
    rows[next]?.classList.add('active');
    rows[next - 1]?.classList.add('lyrics-neighbor');
    rows[next + 1]?.classList.add('lyrics-neighbor');
  }
  if (next >= 0 && (forceScroll || next !== activeLyricIndex)) $('lyricsLines').children[next]?.scrollIntoView({ block: 'center', behavior: forceScroll ? 'auto' : 'smooth' });
  activeLyricIndex = next;
}
async function loadCurrentLyrics() {
  if (!currentTrack) return;
  lyricsTrackId = currentTrack.id;
  $('lyricsTrackTitle').textContent = currentTrack.title; $('lyricsTrackArtist').textContent = `${currentTrack.artist} · ${currentTrack.album}`;
  $('lyricsHeading').textContent = currentTrack.title; $('lyricsHeading').title = currentTrack.title; coverStyle(currentTrack, $('lyricsCover'));
  currentLyrics = { raw: '', synced: false, lines: [], source: '' }; manualLyricsMode = false;
  $('lyricsSyncPanel').hidden = true; $('lyricsMenu').hidden = true;
  const saved = await window.isotopus.getLyricsState(currentTrack.id);
  if (lyricsTrackId !== currentTrack.id) return;
  if (saved?.lines?.length) {
    currentLyrics = { raw: String(saved.raw || ''), synced: Boolean(saved.synced), lines: saved.lines, source: 'Salva no Isótopus' };
    $('lyricsOffset').value = Math.max(-10, Math.min(10, Number(saved.offset) || 0));
    $('lyricsOffsetValue').textContent = `${Number($('lyricsOffset').value).toFixed(1)} s`;
    $('markLyricsToggle').hidden = currentLyrics.synced;
    setLyricsStatus(`Letra salva neste computador · ${currentLyrics.synced ? 'sincronizada' : 'sem tempos'}`);
    renderLyricsLines(); updateManualSyncProgress(); return;
  }
  showLyricsEmpty('Procurando uma letra local…'); setLyricsStatus('Verificando arquivo .lrc local');
  const result = await window.isotopus.getLocalLyrics(currentTrack.id);
  if (lyricsTrackId !== currentTrack.id) return;
  if (result?.content) applyLyricsText(result.content, 'Arquivo local');
  else { showLyricsEmpty('Nenhuma letra encontrada para esta faixa.'); showLyricsActions(); setLyricsStatus('Sem letra para esta faixa'); }
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
      else { currentLyrics = { raw: '', synced: false, lines: [], source: 'LRCLIB' }; showLyricsEmpty('Esta faixa está marcada como instrumental.'); setLyricsStatus('Instrumental'); }
      $('lyricsSearchDialog').close();
    });
    list.append(button);
  }
  if (!result.records.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'Nenhuma letra encontrada para esta faixa.'; list.append(empty); }
  $('lyricsSearchDialog').showModal(); setLyricsStatus(`${result.records.length} resultados do LRCLIB`);
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
function showSettings() {
  renderFolderDialog();
  $('darkThemeToggle').checked = store.get('theme') === 'dark';
  $('minimizeToTrayToggle').checked = store.get('minimizeToTray') === 'yes';
  $('crossfadeToggle').checked = crossfadeSeconds > 0;
  $('crossfadeSettings').hidden = crossfadeSeconds <= 0;
  $('crossfadeDuration').value = String(crossfadeSeconds || 4);
  $('crossfadeDurationLabel').textContent = `${crossfadeSeconds || 4} segundos`;
  $('settingsDialog').showModal();
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => openView(button.dataset.view)));
document.querySelectorAll('.quick-card').forEach(button => button.addEventListener('click', () => openView(button.dataset.target)));
$('heroConnect').addEventListener('click', chooseFolders); $('addFolder').addEventListener('click', chooseFolders);
$('accountButton').addEventListener('click', () => folders.length ? showSettings() : chooseFolders());
$('settingsButton').addEventListener('click', showSettings);
$('learnButton').addEventListener('click', () => $('infoDialog').showModal()); $('infoDone').addEventListener('click', () => $('infoDialog').close());
$('viewLibrary').addEventListener('click', () => openView('songs'));
$('rescanLibrary').addEventListener('click', async () => { applyLibrary(await window.isotopus.rescanLibrary()); toast(`${tracks.length} faixas verificadas.`); });
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
  else if (event.key === 'ArrowUp') { event.preventDefault(); $('volume').value = Math.min(100, Number($('volume').value) + 5); $('volume').dispatchEvent(new Event('input')); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); $('volume').value = Math.max(0, Number($('volume').value) - 5); $('volume').dispatchEvent(new Event('input')); }
});
$('playButton').addEventListener('click', async () => {
  if (!currentTrack) { if (!folders.length) chooseFolders(); else openView('songs'); return; }
  try { if (audio.paused) await audio.play(); else pausePlayback(); renderCurrentTrack(); }
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
$('volume').addEventListener('input', event => {
  baseVolume = Number(event.currentTarget.value) / 100;
  if (crossfadeActive) updateCrossfadeVolumes(crossfadeProgress); else audio.volume = baseVolume;
  store.set('volume', event.currentTarget.value);
});
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
$('darkThemeToggle').addEventListener('change', event => {
  const theme = event.currentTarget.checked ? 'dark' : 'light';
  document.body.classList.toggle('dark-theme', theme === 'dark'); store.set('theme', theme);
});
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
$('exportQueueButton').addEventListener('click', exportQueue);
document.addEventListener('pointerdown', event => {
  if (!$('queuePopover').hidden && !event.target.closest('#queuePopover') && !event.target.closest('#queueToggle')) {
    $('queuePopover').hidden = true; $('queueToggle').setAttribute('aria-expanded', 'false');
  }
});
$('trackArt').addEventListener('click', openLyricsScreen);
$('lyricsMinimize').addEventListener('click', minimizeLyricsScreen);
$('lyricsMenuButton').addEventListener('click', () => { $('lyricsMenu').hidden = !$('lyricsMenu').hidden; });
$('searchLyricsButton').addEventListener('click', searchLyricsOnline);
$('pasteLyricsButton').addEventListener('click', openLyricsPasteDialog);
$('searchWebLyricsButton').addEventListener('click', searchLyricsWeb);
$('applyLyricsPaste').addEventListener('click', applyPastedLyrics);
$('cancelLyricsPaste').addEventListener('click', () => $('lyricsPasteDialog').close());
$('openLyricsButton').addEventListener('click', openLyricsFile);
$('saveLyricsButton').addEventListener('click', saveCurrentLyrics);
$('syncLyricsButton').addEventListener('click', () => { $('lyricsMenu').hidden = true; $('lyricsSyncPanel').hidden = !$('lyricsSyncPanel').hidden; });
$('markLyricsToggle').addEventListener('click', event => {
  if (!currentLyrics.lines.length) { setLyricsStatus('Adicione uma letra antes de marcar os tempos.'); return; }
  manualLyricsMode = !manualLyricsMode;
  if (manualLyricsMode) { $('lyricsOffset').value = '0'; $('lyricsOffset').dispatchEvent(new Event('input')); }
  event.currentTarget.textContent = manualLyricsMode ? 'Concluir marcação manual' : 'Marcar linhas durante a reprodução';
  setLyricsStatus(manualLyricsMode ? 'Clique em cada linha no instante em que ela é cantada.' : 'Marcação manual pausada.');
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
function attachAudioDeck(deck) {
  deck.addEventListener('loadedmetadata', event => { if (event.currentTarget === audio) updateTimeline(); });
  deck.addEventListener('timeupdate', event => {
    if (event.currentTarget !== audio) return;
    updateTimeline(); updateMediaSession(); beginCrossfade();
  });
  deck.addEventListener('play', event => { if (event.currentTarget === audio) renderCurrentTrack(); });
  deck.addEventListener('pause', event => { if (event.currentTarget === audio) renderCurrentTrack(); });
  deck.addEventListener('ended', event => { if (event.currentTarget === audio && !crossfadeActive) nextTrack(); });
  deck.addEventListener('error', event => { if (event.currentTarget === audio && currentTrack) toast(`Este arquivo não pôde ser decodificado (${currentTrack.codec}).`); });
}
attachAudioDeck(audio); attachAudioDeck(standbyAudio);
if (navigator.mediaSession) {
  for (const [action, handler] of Object.entries({ play: () => audio.play(), pause: pausePlayback, previoustrack: previousTrack, nexttrack: nextTrack, seekbackward: details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); }, seekforward: details => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10)); }, seekto: details => { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, details.seekTime)); } })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  }
}
window.isotopus.onLibraryUpdated(applyLibrary);
playlists = safeArray('playlists').filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.trackIds));
document.body.classList.toggle('dark-theme', store.get('theme') === 'dark');
const savedVolume = Number(store.get('volume'));
baseVolume = Number.isFinite(savedVolume) && store.get('volume') !== '' ? Math.min(1, Math.max(0, savedVolume / 100)) : Number($('volume').value) / 100;
audio.volume = baseVolume; standbyAudio.volume = 0;
$('volume').value = Math.round(baseVolume * 100);
crossfadeSeconds = Math.max(0, Math.min(8, Number(store.get('crossfade')) || 0));
shuffled = store.get('shuffle') === 'yes'; $('shuffleButton').classList.toggle('active', shuffled);
repeatMode = Number(store.get('repeat') || 0); if (![0, 1, 2].includes(repeatMode)) repeatMode = 0;
syncTransportStates();
renderQueuePopover();
loadLibrary();
