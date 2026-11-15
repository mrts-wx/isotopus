const $ = id => document.getElementById(id);
let compact = false;
let renderedCoverUrl = null;

function fmt(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function update(state) {
  if (!state) return;
  document.body.classList.toggle('dark', Boolean(state.dark));
  document.body.dataset.surfaceStyle = state.surfaceStyle || 'normal';
  document.body.classList.toggle('dynamic', Boolean(state.dynamic));
  if (state.tone) document.body.style.setProperty('--cover-tone', state.tone);
  else document.body.style.removeProperty('--cover-tone');

  $('miniTitle').textContent = state.track?.title || 'Isótopus';
  $('miniArtist').textContent = state.track
    ? `${state.track.artist || ''}${state.track.album ? ` · ${state.track.album}` : ''}`
    : 'Abra uma música no player principal';
  const cover = $('miniCover');
  const coverUrl = state.track?.coverUrl || '';
  if (coverUrl !== renderedCoverUrl) {
    renderedCoverUrl = coverUrl;
    if (coverUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = coverUrl;
      cover.replaceChildren(image);
    } else {
      cover.replaceChildren();
    }
  }

  $('miniPlay').textContent = state.playing ? 'Ⅱ' : '▶';
  $('miniPlay').setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproduzir');
  $('miniElapsed').textContent = fmt(state.currentTime);
  $('miniDuration').textContent = fmt(state.duration);
  $('miniSeek').max = String(Math.max(1, Number(state.duration) || 1));
  $('miniSeek').value = String(Math.min(Number(state.currentTime) || 0, Number(state.duration) || 1));
  $('miniVolume').value = String(Math.max(0, Math.min(100, Number(state.volume) || 0)));
}

function setCompact(value) {
  compact = Boolean(value);
  document.body.classList.toggle('compact', compact);
  const button = $('miniSize');
  button.textContent = compact ? '⌃' : '⌄';
  button.title = compact ? 'Expandir mini player' : 'Recolher mini player';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-expanded', String(!compact));
  window.isotopus.setMiniPlayerCompact(compact);
}

window.isotopus.onMiniPlayerState(update);
window.isotopus.requestMiniPlayerState();
$('miniPlay').addEventListener('click', () => window.isotopus.sendMiniPlayerCommand({ type: 'playPause' }));
$('miniPrevious').addEventListener('click', () => window.isotopus.sendMiniPlayerCommand({ type: 'previous' }));
$('miniNext').addEventListener('click', () => window.isotopus.sendMiniPlayerCommand({ type: 'next' }));
$('miniSeek').addEventListener('change', event => window.isotopus.sendMiniPlayerCommand({ type: 'seek', value: Number(event.currentTarget.value) }));
$('miniVolume').addEventListener('input', event => window.isotopus.sendMiniPlayerCommand({ type: 'volume', value: Number(event.currentTarget.value) }));
$('miniVolumeToggle').addEventListener('click', event => {
  const button = event.currentTarget;
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? 'Fechar controle de volume' : 'Abrir controle de volume');
  $('miniVolumePopover').hidden = !open;
});
$('miniSize').addEventListener('click', () => setCompact(!compact));
$('miniPin').addEventListener('click', event => {
  const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
  window.isotopus.setMiniPlayerAlwaysOnTop(enabled);
});
$('miniClose').addEventListener('click', () => window.isotopus.closeMiniPlayer());
document.addEventListener('pointerdown', event => {
  if (event.target.closest('.mini-volume-control')) return;
  $('miniVolumePopover').hidden = true;
  $('miniVolumeToggle').setAttribute('aria-expanded', 'false');
  $('miniVolumeToggle').setAttribute('aria-label', 'Abrir controle de volume');
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  $('miniVolumePopover').hidden = true;
  $('miniVolumeToggle').setAttribute('aria-expanded', 'false');
  $('miniVolumeToggle').setAttribute('aria-label', 'Abrir controle de volume');
});
