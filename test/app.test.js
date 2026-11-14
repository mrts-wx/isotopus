const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStaticServer } = require('../server');
const { createLibrary } = require('../library');
const { buildM3u } = require('../playlist');
const { shuffleTracks } = require('../shuffle');
const { parseLyrics, formatLyrics, rankLyricsRecords, alignLyricsToTranscript } = require('../lyrics');
const { repairFlacPictureMime } = require('../flac');

const root = path.resolve(__dirname, '..');
const read = name => fsSync.readFileSync(path.join(root, name), 'utf8');

function makeWav() {
  const sampleRate = 44100, samples = 4410, dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

test('local app serves its UI and blocks file path traversal', async () => {
  const html = read('index.html');
  const main = read('main.js');
  assert.match(html, /name="referrer" content="strict-origin"/);
  assert.match(html, /Escolher pasta de músicas/);
  assert.match(main, /server\.listen\(0, '127\.0\.0\.1'/);
  assert.doesNotMatch(html, /musickit\.js|developerToken|Apple Music/);
  const server = createStaticServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'strict-origin');
    assert.match(await page.text(), /Isótopus/);
    assert.equal((await fetch(`${origin}/local.css`)).headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal((await fetch(`${origin}/missing-file`)).status, 404);
    assert.equal((await fetch(`${origin}/%2e%2e%2fpackage.json`)).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('media server honors audio byte ranges', async () => {
  const buffer = Buffer.from('0123456789');
  const server = createStaticServer(root, id => id === 'fixture' ? { buffer, contentType: 'audio/flac' } : null);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}/media/fixture`, { headers: { Range: 'bytes=3-6' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 3-6/10');
    assert.equal(await response.text(), '3456');
    assert.equal((await fetch(`${origin}/media/unknown`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('library scan reads tags and identifies a local WAV as lossless', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'isotopus-test-'));
  try {
    const music = path.join(temp, 'music');
    const cache = path.join(temp, 'cache');
    await fs.mkdir(music);
    const file = path.join(music, 'Warm Signal.wav');
    await fs.writeFile(file, makeWav());
    const library = createLibrary(cache);
    const tracks = await library.scan([music], 'http://localhost:4321');
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].title, 'Warm Signal');
    assert.equal(tracks[0].lossless, true);
    assert.ok(tracks[0].duration > 0);
    assert.match(tracks[0].streamUrl, /^http:\/\/localhost:4321\/media\/a/);
    assert.equal(library.resolveAsset(`a${tracks[0].id}`).path, file);
    assert.equal((await library.scan([music], 'http://localhost:4321'))[0].id, tracks[0].id);
    const restored = createLibrary(cache);
    assert.equal((await restored.scan([music], 'http://localhost:4321'))[0].id, tracks[0].id);
    assert.equal(restored.resolveTrackPath(tracks[0].id), file);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('FLAC playback copy repairs an empty embedded-picture MIME without changing audio bytes', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'isotopus-flac-'));
  try {
    const file = path.join(temp, 'broken-cover.flac');
    const cache = path.join(temp, 'cache');
    const streamInfo = Buffer.alloc(34);
    const streamInfoHeader = Buffer.from([0, 0, 0, 34]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const picture = Buffer.alloc(36);
    picture.writeUInt32BE(3, 0);
    picture.writeUInt32BE(0, 4);
    picture.writeUInt32BE(0, 8);
    picture.writeUInt32BE(100, 12);
    picture.writeUInt32BE(100, 16);
    picture.writeUInt32BE(24, 20);
    picture.writeUInt32BE(0, 24);
    picture.writeUInt32BE(jpeg.length, 28);
    jpeg.copy(picture, 32);
    const pictureHeader = Buffer.alloc(4);
    pictureHeader[0] = 0x86;
    pictureHeader.writeUIntBE(picture.length, 1, 3);
    const frameBytes = Buffer.from([0xff, 0xf8, 0x10, 0x00, 1, 2, 3, 4]);
    const original = Buffer.concat([Buffer.from('fLaC'), streamInfoHeader, streamInfo, pictureHeader, picture, frameBytes]);
    await fs.writeFile(file, original);

    const repairedPath = await repairFlacPictureMime(file, cache, 'fixture-track', 'fixture-signature');
    const repaired = await fs.readFile(repairedPath);
    const pictureOffset = 4 + streamInfoHeader.length + streamInfo.length;
    assert.equal(repaired.readUIntBE(pictureOffset + 1, 3), picture.length + Buffer.byteLength('image/jpeg'));
    assert.equal(repaired.readUInt32BE(pictureOffset + 8), Buffer.byteLength('image/jpeg'));
    assert.equal(repaired.toString('ascii', pictureOffset + 12, pictureOffset + 22), 'image/jpeg');
    assert.deepEqual(repaired.subarray(-frameBytes.length), frameBytes);
    assert.deepEqual(await fs.readFile(file), original);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('M3U8 export preserves Unicode, absolute paths, and blocks injected lines', () => {
  const playlist = buildM3u([
    { path: '/home/user/Música/João.flac', title: 'Ao vivo\n#EXTINF:999,Hack', artist: 'João', duration: 125.9 },
    { title: 'Sem caminho' }
  ]);
  assert.equal(playlist, '#EXTM3U\n#EXTINF:125,João - Ao vivo #EXTINF:999,Hack\n/home/user/Música/João.flac\n');
});

test('shuffle creates a complete reordered copy without changing the source list', () => {
  const source = ['a', 'b', 'c', 'd'];
  const mixed = shuffleTracks(source, () => 0);
  assert.deepEqual([...mixed].sort(), [...source].sort());
  assert.notDeepEqual(mixed, source);
  assert.deepEqual(source, ['a', 'b', 'c', 'd']);
});

test('LRC parser handles multiple timestamps and applies manual timing offsets', () => {
  const parsed = parseLyrics('[00:01.20][00:02.30] Olá\n[00:03.4] mundo');
  assert.equal(parsed.synced, true);
  assert.deepEqual(parsed.lines.map(line => [line.time, line.text]), [[1.2, 'Olá'], [2.3, 'Olá'], [3.4, 'mundo']]);
  assert.equal(formatLyrics(parsed.lines.slice(0, 1), 0.5), '[00:01.70] Olá\n');
  const plain = parseLyrics('linha um\nlinha dois');
  assert.equal(plain.synced, false);
  assert.equal(plain.lines.length, 2);
});

test('automatic lyric search ranks close synced records above mismatched tracks', () => {
  const ranked = rankLyricsRecords([
    { title: 'Outro Som', artist: 'Artista B', duration: 210, syncedLyrics: '[00:01.00] X' },
    { title: 'Canção do Teste', artist: 'Artista A', duration: 201, plainLyrics: 'letra sem tempos' },
    { title: 'Canção do Teste', artist: 'Artista A', duration: 200, syncedLyrics: '[00:01.00] letra' }
  ], { title: 'Canção do Teste', artist: 'Artista A', duration: 200, album: '' });
  assert.equal(ranked[0].record.duration, 200);
  assert.ok(ranked[0].score >= 0.68);
  assert.equal(ranked[2].score < ranked[0].score, true);
});

test('automatic lyric alignment maps a local transcript to monotonic LRC line starts', () => {
  const lines = ['Olá, mundo', 'meu amigo', 'vamos cantar', 'mais uma vez', 'fim da noite'].map(text => ({ text }));
  const transcript = ['ola', 'mundo', 'meu', 'amigo', 'vamos', 'cantar', 'mais', 'uma', 'vez', 'fim', 'da', 'noite']
    .map((text, index) => ({ text: `${text} `, timestamp: [index * 0.7 + 1, index * 0.7 + 1.3] }));
  const result = alignLyricsToTranscript(lines, transcript, 12);
  assert.equal(result.ok, true);
  assert.equal(result.matchedLines, 5);
  assert.equal(result.coverage, 1);
  assert.deepEqual(result.lines.map(line => line.text), lines.map(line => line.text));
  assert.ok(result.lines.every((line, index, all) => line.time >= 0 && (index === 0 || line.time >= all[index - 1].time)));
  assert.equal(parseLyrics(formatLyrics(result.lines)).synced, true);
});

test('automatic lyric alignment refuses unrelated speech instead of inventing line timing', () => {
  const lines = ['letra correta aqui', 'mais uma linha conhecida', 'refrão da canção'].map(text => ({ text }));
  const transcript = ['janela', 'computador', 'teclado', 'cadeira', 'telefone', 'relógio']
    .map((text, index) => ({ text, timestamp: [index * 1.2, index * 1.2 + 0.4] }));
  assert.equal(alignLyricsToTranscript(lines, transcript, 10).ok, false);
});

test('Electron bridge stays isolated and exposes only required local actions', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  assert.match(main, /contextIsolation: true, nodeIntegration: false, sandbox: true/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('isotopus'/);
  assert.match(preload, /library:chooseFolder/);
  assert.match(preload, /exportPlaylist: tracks => ipcRenderer\.invoke\('playlist:export'/);
  assert.doesNotMatch(main, /nodeIntegration:\s*true/);
});

test('visual identity and motion preferences remain in place', () => {
  const theme = read('theme.css');
  for (const color of ['#eddbc4', '#a3c9a7', '#ffb353', '#ff6e4a', '#5c5259']) assert.ok(theme.includes(color), `missing ${color}`);
  const motion = read('motion.css');
  assert.match(motion, /cubic-bezier\(\.2,1\.35,\.35,1\)/);
  assert.doesNotMatch(motion, /quick-card-fade|\.quick-card\{animation:/);
  assert.match(read('home-player.css'), /\.quick-card,\.quick-card:hover,\.quick-card:active\{animation:none!important;opacity:1!important;transform:none!important/);
  assert.match(motion, /prefers-reduced-motion/);
  assert.doesNotMatch(read('styles.css'), /fonts\.googleapis\.com/);
});

test('floating docks keep their dimensions and center the player controls', () => {
  const polish = read('polish.css');
  assert.match(polish, /body\{height:100vh;display:flex;flex-direction:column\}/);
  assert.match(polish, /\.app-shell\{height:auto;min-height:0;flex:1 1 auto\}/);
  assert.match(polish, /\.sidebar\{margin:12px 0 12px 12px[^}]*border-radius:16px/);
  assert.match(polish, /\.player-bar\{height:92px;flex:0 0 92px;margin:0 12px 12px[^}]*border-radius:16px/);
  assert.doesNotMatch(polish.match(/\.player-bar\{[^}]+\}/)[0], /transform/);
  assert.match(polish, /\.play-button\{width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center/);
  assert.match(polish, /padding:0 0 0 2px/);
  assert.match(read('index.html'), /href="polish\.css"/);
});

test('large libraries render in batches and player supports desktop controls', () => {
  const app = read('app.js');
  assert.match(app, /const PAGE_SIZE = 120/);
  assert.match(app, /Mostrar mais ·/);
  assert.match(app, /navigator\.mediaSession\.setActionHandler/);
  assert.match(app, /event\.code === 'Space'/);
  assert.match(app, /store\.set\('volume'/);
  assert.match(app, /store\.set\('shuffle'/);
  assert.match(app, /store\.set\('repeat'/);
  assert.match(app, /normalize\('NFD'\)/);
  assert.match(app, /Exportar M3U8/);
  assert.match(app, /queue = shuffleTracks\(source\); queueIndex = 0/);
  assert.match(app, /playTrack\(queue\[0\], queue, \{ keepQueue: true \}\)/);
});

test('playlists, full-screen lyrics, and the Isótopus no-cover mark are included', () => {
  const html = read('index.html');
  const app = read('app.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(html, /data-view="playlists"/);
  assert.match(html, /id="lyricsScreen"/);
  assert.match(html, /id="lyricsMinimize"/);
  assert.match(app, /Pesquisar letra na web/);
  assert.match(app, /Buscando automaticamente uma letra sincronizada/);
  assert.match(app, /alignLyrics\(trackId, decoded\.samples/);
  assert.match(html, /id="lyricsAutoSyncButton"/);
  assert.match(html, /id="autoSyncLyricsMenuButton"/);
  assert.match(html, /id="lyricsPasteDialog"/);
  assert.match(html, /id="lyricsPasteText"/);
  assert.match(html, /id="searchWebLyricsButton"/);
  assert.match(html, /id="markLyricsToggle"/);
  assert.match(html, /id="manualSyncNext"/);
  assert.match(app, /function openPlaylistDialog/);
  assert.match(app, /function installDockMagnification/);
  assert.match(app, /dock-neighbor/);
  assert.match(app, /cover-fallback/);
  assert.ok(fsSync.existsSync(path.join(root, 'no-cover.svg')));
  for (const file of ['lyrics.js', 'shuffle.js', 'flac.js', 'lyrics.css', 'clarity.css', 'features.css', 'home-player.css', 'no-cover.svg', 'build/icons/**']) assert.ok(pkg.build.files.includes(file));
});

test('v0.2.0 preserves the player features and adds local automatic lyric alignment', () => {
  const html = read('index.html');
  const app = read('app.js');
  const main = read('main.js');
  const preload = read('preload.js');
  const lyricsCss = read('lyrics.css');
  assert.doesNotMatch(html, /data-view="(albums|recent|folders|queue)"/);
  assert.match(html, /id="queueToggle"/);
  assert.match(html, /id="queuePopover"/);
  assert.match(html, /id="themeSelect"/);
  assert.match(html, /data-option="system" aria-selected="true">Automático \(sistema\)/);
  assert.match(html, /id="equalizerEnabled"/);
  assert.match(html, /id="equalizerPreset"/);
  assert.match(html, /id="equalizerBands"/);
  assert.match(html, /id="equalizerDialog"/);
  assert.match(html, /id="editEqualizerButton"/);
  assert.match(html, /data-settings-tab="equalizer"/);
  assert.doesNotMatch(html, /id="viewRecent"|Ver histórico/);
  assert.match(html, /id="playLibraryButton"/);
  assert.match(html, /id="shuffleLibraryButton"/);
  assert.match(html, /id="favoritesHomeGrid"/);
  assert.match(html, /id="minimizeToTrayToggle"/);
  assert.match(html, /id="crossfadeToggle"/);
  assert.match(app, /getPersistentStore/);
  assert.match(app, /saveLyricsState/);
  assert.match(main, /lyrics:state:get/);
  assert.match(main, /lyrics:state:set/);
  assert.match(main, /new Tray/);
  assert.match(main, /minimizeToTray/);
  assert.match(preload, /sendSync\('store:get'\)/);
  assert.match(lyricsCss, /grid-template-rows:minmax\(0,1fr\)/);
  assert.match(app, /markNextLyricsLine/);
  assert.match(app, /function beginCrossfade/);
  assert.match(main, /backgroundThrottling: false/);
  assert.match(app, /crossfadeTimer = setInterval\(step, 40\)/);
  assert.doesNotMatch(app, /requestAnimationFrame\(step\)/);
  assert.match(app, /build\/icons\/512x512\.png/);
  assert.match(html, /class="recent-grid" id="recentGrid"/);
  assert.match(html, /id="losslessEmpty"/);
  assert.match(html, /id="losslessGrid"/);
  assert.match(html, /src="build\/icons\/128x128\.png"/);
  assert.doesNotMatch(html, /id="backButton"|id="forwardButton"/);
  assert.doesNotMatch(html, /O formato original importa|rescanButton/);
  assert.match(app, /function renderPlaylistPlaybackControls/);
  assert.match(app, /playlist-playback-toolbar/);
  assert.match(app, /renderCards\(items, 'Adicione músicas usando o botão \+ em qualquer faixa\.', 'playlist-track'\)/);
  assert.match(app, /function renderLosslessHome/);
  assert.match(lyricsCss, /\.lyrics-line\.active\{[^}]*scale\(1\.065\)[^}]*text-shadow/);
  assert.match(lyricsCss, /\.lyrics-line\.active\{[^}]*color:#fff[^}]*#ffffffdd/);
  assert.match(lyricsCss, /\.lyrics-line\.lyrics-neighbor\{[^}]*scale\(1\.025\)/);
  assert.match(lyricsCss, /\.lyrics-lines\{[^}]*gap:6px/);
  assert.match(lyricsCss, /\.lyrics-line\{[^}]*text-align:center/);
  assert.match(lyricsCss, /transform \.52s cubic-bezier\(\.22,1,\.36,1\)/);
  assert.doesNotMatch(lyricsCss, /\.lyrics-line\.active\{[^}]*background:/);
  assert.match(html, /skip-button/);
  assert.match(app, /setPersistentStore/);
  assert.doesNotMatch(app, /localStorage/);
  assert.match(app, /function setupAudioGraph/);
  assert.match(app, /createBiquadFilter/);
  assert.match(app, /async function playAudio/);
  assert.match(app, /function applyTheme/);
  assert.match(app, /equalizerState\.values/);
  assert.match(app, /Number\.parseFloat\(slider\.value\)/);
  assert.match(app, /function bindStyledSelect/);
  assert.match(app, /function setSettingsTab/);
  assert.match(app, /function renderHome/);
  assert.match(app, /playLibraryButton/);
  assert.match(app, /cover-fallback/);
  assert.match(app, /element\.classList\.toggle\('missing-cover', !source\)/);
  assert.match(app, /if \(!group\.coverUrl && track\.coverUrl\) group\.coverUrl = track\.coverUrl/);
  assert.match(read('home-player.css'), /\.quick-card,\.quick-card:hover,\.quick-card:active\{animation:none!important;opacity:1!important;transform:none!important/);
  assert.match(app, /function recoverAfterPlaybackError/);
  assert.match(app, /failedTracks\.has\(candidate\.id\)/);
});

test('Discord presence and redundant queue controls are removed', () => {
  assert.doesNotMatch(read('main.js'), /discord-rpc|discord:connect|discord:activity/);
  assert.doesNotMatch(read('preload.js'), /discordConnect|discordActivity|discordDisconnect/);
  assert.doesNotMatch(read('index.html'), /Rich Presence|discordToggle|discordId|queueButton|playerQueue/);
});

test('folder selection hides the welcome panel and routes library settings to folder management', () => {
  const app = read('app.js');
  const html = read('index.html');
  assert.match(app, /\$\('heroCard'\)\.hidden = folders\.length > 0/);
  assert.match(app, /\$\('accountButton'\)\.addEventListener\('click', \(\) => folders\.length \? showSettings\(\) : chooseFolders\(\)\)/);
  assert.match(html, /class="hero-card" id="heroCard"/);
  assert.match(app, /function showSettings\(\) \{[\s\S]*renderFolderDialog\(\);[\s\S]*\$\('settingsDialog'\)\.showModal\(\);/);
});

test('desktop identity, app clarity, and launcher icon are configured', () => {
  const pkg = JSON.parse(read('package.json'));
  const app = read('app.js');
  assert.equal(pkg.name, 'isotopus');
  assert.equal(pkg.version, '0.2.0');
  assert.equal(pkg.dependencies['@huggingface/transformers'], '^3.8.1');
  assert.equal(pkg.scripts['build:debian'], 'electron-builder --linux deb');
  assert.equal(pkg.scripts['build:arch'], 'electron-builder --linux pacman');
  assert.equal(pkg.scripts['build:windows'], 'electron-builder --win nsis');
  assert.match(pkg.description, /playlists e letras sincronizadas/);
  assert.equal(pkg.build.productName, 'Isótopus');
  assert.equal(pkg.build.linux.icon, 'build/icons');
  assert.equal(pkg.build.win.icon, 'build/icons/isotopus.ico');
  assert.ok(fsSync.existsSync(path.join(root, pkg.build.win.icon)));
  for (const size of [32, 64, 128, 256, 512]) assert.ok(fsSync.existsSync(path.join(root, `build/icons/${size}x${size}.png`)));
  assert.match(app, /aria-pressed/);
  assert.match(app, /lyrics-open/);
  assert.doesNotMatch(app, /syncPresence|lastPresenceSignature/);
  assert.match(read('Discord-description.txt'), /player local de música para Ubuntu/i);
});
