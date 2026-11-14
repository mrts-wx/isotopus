(function (root) {
  function shuffleTracks(items, random = Math.random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  if (typeof module === 'object' && module.exports) module.exports = { shuffleTracks };
  else root.IsotopusShuffle = { shuffleTracks };
})(globalThis);
