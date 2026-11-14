(function (root) {
  const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const PRESETS = { flat: [0,0,0,0,0,0,0,0,0,0], rock: [5,4,3,1,-1,-1,2,3,4,5], pop: [-1,1,3,4,2,0,-1,-1,1,2], jazz: [3,2,1,2,-1,-1,0,1,2,3], classical: [4,3,2,1,-1,-1,0,2,3,4], electronic: [5,4,1,-1,-2,1,2,1,3,4], vocal: [-2,-1,0,2,4,4,3,1,0,-1] };
  const LABELS = { flat: 'Flat', rock: 'Rock', pop: 'Pop', jazz: 'Jazz', classical: 'Clássico', electronic: 'Eletrônico', vocal: 'Voz', custom: 'Personalizado' };

  function create({ store, getElement, setStyledSelect, decks }) {
    let state = { enabled: store.get('equalizerEnabled') !== 'no', preset: 'flat', values: [...PRESETS.flat] };
    try { const saved = JSON.parse(store.get('equalizer') || 'null'); if (saved && Array.isArray(saved.values) && saved.values.length === FREQUENCIES.length) state = { enabled: store.get('equalizerEnabled') !== 'no', preset: saved.preset || 'custom', values: saved.values.map(value => Math.max(-12, Math.min(12, Number(value) || 0))) }; } catch {}
    let audioContext = null;
    const graphs = new WeakMap();
    function applyGraph(graph) {
      if (!graph) return;
      graph.filters.forEach((filter, index) => {
        const gain = state.enabled ? state.values[index] : 0;
        if (audioContext && filter.gain) filter.gain.setTargetAtTime(gain, audioContext.currentTime, .035);
      });
    }
    function setup(deck) {
      if (graphs.has(deck)) return graphs.get(deck);
      try {
        const Context = root.AudioContext || root.webkitAudioContext;
        if (!Context) return null;
        audioContext ||= new Context();
        const source = audioContext.createMediaElementSource(deck);
        const filters = FREQUENCIES.map((frequency, index) => {
          const filter = audioContext.createBiquadFilter();
          filter.type = index === 0 ? 'lowshelf' : index === FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
          filter.frequency.value = frequency;
          if (filter.type === 'peaking') filter.Q.value = 1.1;
          return filter;
        });
        source.connect(filters[0]); filters.slice(1).forEach((filter, index) => filters[index].connect(filter));
        filters.at(-1).connect(audioContext.destination);
        const graph = { source, filters }; graphs.set(deck, graph); applyGraph(graph); return graph;
      } catch { return null; }
    }
    async function play(deck) { setup(deck); if (audioContext?.state === 'suspended') await audioContext.resume().catch(() => {}); await deck.play(); }
    function apply() { for (const deck of decks()) applyGraph(graphs.get(deck)); }
    function save() { store.set('equalizer', JSON.stringify({ preset: state.preset, values: state.values })); store.set('equalizerEnabled', state.enabled ? 'yes' : 'no'); }
    function summary() { const element = getElement('equalizerSummary'); if (element) element.textContent = `${state.enabled ? 'Equalizador ativado' : 'Equalizador desativado'} · ${LABELS[state.preset] || LABELS.custom}`; }
    function render() {
      const container = getElement('equalizerBands'); if (!container) return;
      container.replaceChildren();
      FREQUENCIES.forEach((frequency, index) => {
        const label = document.createElement('label'); label.className = 'eq-band'; label.htmlFor = `eqBand${index}`;
        const name = document.createElement('span'); name.textContent = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
        const slider = document.createElement('input'); slider.type = 'range'; slider.id = `eqBand${index}`; slider.min = '-12'; slider.max = '12'; slider.step = '0.5'; slider.value = String(state.values[index]); slider.setAttribute('aria-label', `${frequency} Hz`);
        const value = document.createElement('small'); value.textContent = `${state.values[index] > 0 ? '+' : ''}${state.values[index]} dB`;
        slider.addEventListener('input', () => {
          const next = Number.parseFloat(slider.value); if (!Number.isFinite(next)) return;
          state.values[index] = Math.max(-12, Math.min(12, next)); state.preset = 'custom'; setStyledSelect('equalizerPreset', 'custom');
          value.textContent = `${next > 0 ? '+' : ''}${next} dB`; summary(); apply(); save();
        });
        const control = document.createElement('div'); control.className = 'eq-band-control'; control.append(slider); label.append(name, control, value); container.append(label);
      });
    }
    function setEnabled(enabled) { state.enabled = Boolean(enabled); apply(); save(); summary(); }
    function setPreset(preset) {
      if (preset === 'custom') { state.preset = 'custom'; save(); summary(); return; }
      if (!PRESETS[preset]) return;
      state.preset = preset; state.values = [...PRESETS[preset]]; render(); apply(); save(); summary();
    }
    return { get state() { return state; }, play, apply, save, render, summary, setEnabled, setPreset, setStyledSelect };
  }
  root.IsotopusEqualizer = { create };
})(window);
