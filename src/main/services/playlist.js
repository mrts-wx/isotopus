const path = require('node:path');

function safeLine(value) { return String(value ?? '').replace(/[\r\n]+/g, ' ').trim(); }

function buildM3u(tracks) {
  const lines = ['#EXTM3U'];
  for (const track of tracks) {
    if (!track?.path) continue;
    const duration = Math.max(0, Math.floor(Number(track.duration) || 0));
    const title = safeLine(track.title) || path.basename(track.path);
    const artist = safeLine(track.artist) || 'Artista desconhecido';
    lines.push(`#EXTINF:${duration},${artist} - ${title}`, track.path);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { buildM3u };
