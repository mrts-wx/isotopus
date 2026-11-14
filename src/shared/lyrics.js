(function (root) {
  const TIME = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  function parseLyrics(raw) {
    const timed = [];
    for (const line of String(raw || '').split(/\r?\n/)) {
      const matches = [...line.matchAll(TIME)];
      const text = line.replace(TIME, '').trim();
      if (!text) continue;
      for (const match of matches) {
        const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
        timed.push({ time: Number(match[1]) * 60 + Number(match[2]) + fraction, text });
      }
    }
    if (timed.length) return { synced: true, lines: timed.sort((a, b) => a.time - b.time) };
    return { synced: false, lines: String(raw || '').split(/\r?\n/).map(text => text.trim()).filter(Boolean).map(text => ({ time: null, text })) };
  }

  function formatLyrics(lines, offset = 0) {
    return lines.filter(line => line.time !== null && Number.isFinite(line.time))
      .sort((a, b) => a.time - b.time)
      .map(line => {
        const centiseconds = Math.max(0, Math.round((line.time + offset) * 100));
        const minutes = Math.floor(centiseconds / 6000);
        const seconds = Math.floor((centiseconds % 6000) / 100);
        const fraction = String(centiseconds % 100).padStart(2, '0');
        return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${fraction}] ${line.text}`;
      }).join('\n') + '\n';
  }

  function normalizeMatchText(value) {
    return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
      .replace(/\b(feat\.?|ft\.?)\b.*$/u, '').replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }

  function textSimilarity(left, right) {
    const a = normalizeMatchText(left), b = normalizeMatchText(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.86;
    const aWords = new Set(a.split(' ')), bWords = new Set(b.split(' '));
    const overlap = [...aWords].filter(word => bWords.has(word)).length;
    return overlap / Math.max(aWords.size, bWords.size);
  }

  function rankLyricsRecords(records, track = {}) {
    return (Array.isArray(records) ? records : []).filter(record => record && (record.syncedLyrics || record.plainLyrics) && !record.instrumental)
      .map(record => {
        const title = textSimilarity(record.title, track.title);
        const artist = textSimilarity(record.artist, track.artist);
        const album = track.album ? textSimilarity(record.album, track.album) : 0.5;
        const duration = Number(track.duration) > 0 && Number(record.duration) > 0
          ? Math.max(0, 1 - Math.abs(Number(track.duration) - Number(record.duration)) / 12)
          : 0.5;
        const score = title * 0.48 + artist * 0.32 + duration * 0.16 + album * 0.04 + (record.syncedLyrics ? 0.05 : 0);
        return { record, score, title, artist, duration };
      }).sort((a, b) => b.score - a.score);
  }

  function lyricTokens(lines) {
    const tokens = [];
    lines.forEach((line, lineIndex) => {
      const words = String(line.text || '').match(/[\p{Letter}\p{Number}]+(?:['’][\p{Letter}\p{Number}]+)*/gu) || [];
      for (const word of words) {
        const normalized = normalizeMatchText(word).replace(/\s/g, '');
        if (normalized) tokens.push({ word: normalized, lineIndex });
      }
    });
    return tokens;
  }

  function transcriptTokens(chunks) {
    const tokens = [];
    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      const words = String(chunk?.text || '').match(/[\p{Letter}\p{Number}]+(?:['’][\p{Letter}\p{Number}]+)*/gu) || [];
      const start = Number(chunk?.timestamp?.[0]), end = Number(chunk?.timestamp?.[1]);
      if (!words.length || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      const span = (end - start) / words.length;
      words.forEach((word, index) => {
        const normalized = normalizeMatchText(word).replace(/\s/g, '');
        if (normalized) tokens.push({ word: normalized, time: start + span * index });
      });
    }
    return tokens;
  }

  function wordDistance(a, b) {
    if (a === b) return 0;
    if (Math.min(a.length, b.length) < 4) return 1;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
    return previous[b.length] / Math.max(a.length, b.length);
  }

  function alignLyricsToTranscript(lines, chunks, duration = 0) {
    if (!Array.isArray(lines) || !lines.length) return { ok: false, error: 'A letra não tem linhas para sincronizar.' };
    const lyrics = lyricTokens(lines), transcript = transcriptTokens(chunks);
    if (lyrics.length < 4 || transcript.length < 4) return { ok: false, error: 'Não reconheci fala cantada suficiente para alinhar esta letra.' };
    const rows = transcript.length + 1, cols = lyrics.length + 1;
    const costs = Array.from({ length: rows }, () => new Float32Array(cols));
    const moves = Array.from({ length: rows }, () => new Uint8Array(cols));
    for (let i = 1; i < rows; i++) { costs[i][0] = i * 0.76; moves[i][0] = 1; }
    for (let j = 1; j < cols; j++) { costs[0][j] = j * 0.76; moves[0][j] = 2; }
    for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) {
      const similarity = wordDistance(transcript[i - 1].word, lyrics[j - 1].word);
      const diagonal = costs[i - 1][j - 1] + (similarity === 0 ? 0 : similarity <= 0.25 ? 0.62 : 1.18);
      const skipTranscript = costs[i - 1][j] + 0.76;
      const skipLyric = costs[i][j - 1] + 0.76;
      if (diagonal <= skipTranscript && diagonal <= skipLyric) { costs[i][j] = diagonal; moves[i][j] = 0; }
      else if (skipTranscript <= skipLyric) { costs[i][j] = skipTranscript; moves[i][j] = 1; }
      else { costs[i][j] = skipLyric; moves[i][j] = 2; }
    }
    const matched = new Map();
    let i = transcript.length, j = lyrics.length;
    while (i > 0 || j > 0) {
      const move = moves[i][j];
      if (i > 0 && j > 0 && move === 0) {
        if (wordDistance(transcript[i - 1].word, lyrics[j - 1].word) <= 0.25) matched.set(j - 1, transcript[i - 1].time);
        i--; j--;
      } else if (i > 0 && (j === 0 || move === 1)) i--;
      else if (j > 0) j--;
      else break;
    }
    const linePositions = [];
    let tokenIndex = 0;
    const tokensByLine = lines.map(() => []);
    lyrics.forEach((token, index) => { tokensByLine[token.lineIndex].push(index); });
    let matchedLines = 0;
    const anchors = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const indexes = tokensByLine[lineIndex];
      linePositions[lineIndex] = tokenIndex;
      tokenIndex += indexes.length;
      const times = indexes.map(index => matched.get(index)).filter(Number.isFinite);
      if (times.length) { matchedLines++; anchors.push({ position: linePositions[lineIndex], time: Math.min(...times), lineIndex }); }
    }
    const coverage = matched.size / Math.max(1, lyrics.length);
    if (matchedLines < 2 || coverage < 0.18) return { ok: false, error: 'A letra não coincidiu o suficiente com o áudio para criar uma sincronização confiável.', coverage, matchedLines };
    const maxDuration = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : Math.max(...transcript.map(token => token.time));
    const timed = lines.map((line, lineIndex) => {
      const exact = tokensByLine[lineIndex].map(index => matched.get(index)).filter(Number.isFinite);
      let time;
      if (exact.length) time = Math.min(...exact);
      else {
        let before = [...anchors].reverse().find(anchor => anchor.lineIndex < lineIndex);
        let after = anchors.find(anchor => anchor.lineIndex > lineIndex);
        if (before && after) {
          const span = after.position - before.position || 1;
          time = before.time + (after.time - before.time) * ((linePositions[lineIndex] - before.position) / span);
        } else if (after) time = Math.max(0, after.time - (after.lineIndex - lineIndex) * 2.2);
        else if (before) time = before.time + (lineIndex - before.lineIndex) * 2.2;
        else time = 0;
      }
      return { text: String(line.text || '').trim(), time: Math.min(Math.max(0, time), Math.max(0, maxDuration - 0.05)) };
    }).filter(line => line.text);
    let last = 0;
    for (const line of timed) { line.time = Math.max(last, line.time); last = line.time; }
    return { ok: true, lines: timed, coverage, matchedLines, matchedWords: matched.size, totalWords: lyrics.length };
  }

  if (typeof module === 'object' && module.exports) module.exports = { parseLyrics, formatLyrics, rankLyricsRecords, alignLyricsToTranscript };
  else root.IsotopusLyrics = { parseLyrics, formatLyrics, rankLyricsRecords, alignLyricsToTranscript };
})(globalThis);
