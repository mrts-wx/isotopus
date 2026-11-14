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

  if (typeof module === 'object' && module.exports) module.exports = { parseLyrics, formatLyrics };
  else root.IsotopusLyrics = { parseLyrics, formatLyrics };
})(globalThis);
