const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { repairFlacPictureMime } = require('./flac');

const AUDIO_EXTENSIONS = new Set(['.flac', '.wav', '.wave', '.aif', '.aiff', '.m4a', '.mp3', '.aac', '.ogg', '.oga', '.opus']);
const idFor = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
const asText = value => Array.isArray(value) ? value.join(', ') : (value == null ? '' : String(value));

async function findAudioFiles(folders) {
  const files = [];
  const pending = folders.map(folder => path.resolve(folder));
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
    }
  }
  return files;
}

function isLossless(codec, container, ext) {
  const label = `${codec || ''} ${container || ''} ${ext}`.toUpperCase();
  return /FLAC|ALAC|PCM|AIFF|WAVPACK|APE/.test(label);
}

function fallbackTrack(file, stat) {
  const ext = path.extname(file).slice(1).toUpperCase();
  return {
    id: idFor(file), title: path.basename(file, path.extname(file)), artist: 'Artista desconhecido', albumArtist: '', album: 'Álbum desconhecido',
    codec: ext || 'Áudio', lossless: isLossless(ext, ext, ext), duration: 0, sampleRate: 0, bitDepth: 0, bitrate: 0,
    trackNo: null, discNo: null, genre: '', year: null, size: stat.size, modified: stat.mtimeMs, pathLabel: path.basename(file)
  };
}

async function parseTrack(file, stat, parseFile) {
  try {
    const metadata = await parseFile(file, { duration: true });
    const common = metadata.common || {};
    const format = metadata.format || {};
    const ext = path.extname(file).toLowerCase();
    const codec = asText(format.codec || format.container || ext.slice(1)).toUpperCase();
    const pic = common.picture?.[0];
    const coverId = pic?.data ? `c${idFor(`${asText(common.albumArtist || common.artist)}|${asText(common.album)}`)}` : '';
    const coverVersion = pic?.data ? idFor(pic.data) : '';
    return {
      id: idFor(file), title: asText(common.title) || path.basename(file, ext),
      artist: asText(common.artist) || 'Artista desconhecido', albumArtist: asText(common.albumartist || common.albumArtist),
      album: asText(common.album) || 'Álbum desconhecido', codec,
      lossless: isLossless(codec, asText(format.container), ext), duration: Number(format.duration) || 0,
      sampleRate: Number(format.sampleRate) || 0, bitDepth: Number(format.bitsPerSample) || 0,
      bitrate: Number(format.bitrate) || 0, trackNo: common.track?.no || null, discNo: common.disk?.no || null,
      genre: asText(common.genre), year: common.year || null, size: stat.size, modified: stat.mtimeMs,
      pathLabel: path.basename(file), coverId, coverVersion,
      coverBuffer: pic?.data ? Buffer.from(pic.data) : null, coverType: pic?.format || 'image/jpeg'
    };
  } catch { return fallbackTrack(file, stat); }
}

function createLibrary(cacheDirectory) {
  const cache = new Map();
  const assets = new Map();
  const trackPaths = new Map();
  let cachedParser;
  let loaded = false;
  async function loadCache() {
    if (loaded) return;
    loaded = true;
    if (!cacheDirectory) return;
    try {
      const records = JSON.parse(await fs.readFile(path.join(cacheDirectory, 'index.json'), 'utf8'));
      for (const [file, record] of records) {
        cache.set(file, record);
        trackPaths.set(record.track.id, file);
        if (record.track.coverId) {
          assets.set(record.track.coverId, { path: path.join(cacheDirectory, `${record.track.coverId}.cover`), contentType: record.track.coverType || 'image/jpeg' });
        }
      }
    } catch {}
  }
  async function saveCache() {
    if (!cacheDirectory) return;
    await fs.mkdir(cacheDirectory, { recursive: true });
    const records = [...cache.entries()];
    await fs.writeFile(path.join(cacheDirectory, 'index.json.tmp'), JSON.stringify(records));
    await fs.rename(path.join(cacheDirectory, 'index.json.tmp'), path.join(cacheDirectory, 'index.json'));
  }
  async function scan(folders, origin) {
    await loadCache();
    if (cacheDirectory) await fs.mkdir(cacheDirectory, { recursive: true });
    if (!cachedParser) cachedParser = import('music-metadata').then(module => module.parseFile);
    const parseFile = await cachedParser;
    const files = await findAudioFiles(folders);
    const present = new Set(files);
    for (const [file, record] of cache) {
      if (!present.has(file)) {
        cache.delete(file); trackPaths.delete(record.track.id); assets.delete(`a${record.track.id}`);
        if (record.playbackPath) fs.rm(record.playbackPath, { force: true }).catch(() => {});
      }
    }
    const tracks = new Array(files.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const index = cursor++;
        const file = files[index];
        try {
          const stat = await fs.stat(file);
          const signature = `${stat.size}:${stat.mtimeMs}`;
          const prior = cache.get(file);
          let track = prior?.signature === signature ? prior.track : await parseTrack(file, stat, parseFile);
          if (prior?.signature === signature && track.coverId && cacheDirectory) {
            try { await fs.access(path.join(cacheDirectory, `${track.coverId}.cover`)); }
            catch { track = await parseTrack(file, stat, parseFile); }
          }
          let playbackPath = prior?.signature === signature ? prior.playbackPath || '' : '';
          if (playbackPath) {
            try { await fs.access(playbackPath); } catch { playbackPath = ''; }
          }
          if (!playbackPath && track.coverId) {
            playbackPath = await repairFlacPictureMime(file, cacheDirectory, track.id, signature)
              .catch(error => { console.warn(`Could not normalize FLAC picture metadata for ${path.basename(file)}:`, error.message); return ''; });
          }
          if (prior?.playbackPath && prior.signature !== signature && prior.playbackPath !== playbackPath) {
            fs.rm(prior.playbackPath, { force: true }).catch(() => {});
          }
          const audioId = `a${track.id}`;
          assets.set(audioId, { path: playbackPath || file });
          trackPaths.set(track.id, file);
          if (track.coverBuffer) {
            let coverAsset = { buffer: track.coverBuffer, contentType: track.coverType };
            if (cacheDirectory) {
              const coverPath = path.join(cacheDirectory, `${track.coverId}.cover`);
              try {
                await fs.writeFile(coverPath, track.coverBuffer);
                coverAsset = { path: coverPath, contentType: track.coverType };
              } catch {}
            }
            assets.set(track.coverId, coverAsset);
            delete track.coverBuffer;
            delete track.coverType;
          }
          track.streamUrl = `${origin}/media/${audioId}`;
      track.coverUrl = track.coverId ? `${origin}/media/${track.coverId}?v=${track.coverVersion || track.coverId}` : '';
          cache.set(file, { signature, track, playbackPath });
          tracks[index] = track;
        } catch { tracks[index] = null; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
    const coverIds = new Set(tracks.filter(Boolean).map(track => track.coverId).filter(Boolean));
    for (const id of assets.keys()) if (id.startsWith('c') && !coverIds.has(id)) assets.delete(id);
    await saveCache().catch(() => {});
    return tracks.filter(Boolean).sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || a.title.localeCompare(b.title));
  }
  return { scan, resolveAsset: id => assets.get(id) || null, resolveTrackPath: id => trackPaths.get(id) || null, clear: () => { cache.clear(); assets.clear(); trackPaths.clear(); loaded = true; } };
}

module.exports = { AUDIO_EXTENSIONS, createLibrary, findAudioFiles, isLossless, parseTrack };
