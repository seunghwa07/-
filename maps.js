(function (root) {
  const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

  // gen(x, p, q): 해당 x의 지면 높이(y). 값이 클수록 낮은 지형. p, q는 판마다 달라지는 랜덤 위상.
  const MAPS = [
    { name: '언덕', sky: ['#4a90d9', '#bfe3ff'], ground: '#6b4f2a', grass: '#4c9a3a',
      gen: (x, p, q) => 400 + Math.sin(x / 120 + p) * 50 + Math.sin(x / 47 + q) * 20 },
    { name: '평원', sky: ['#6ab0e8', '#fff3c4'], ground: '#8a6a3a', grass: '#7bbf4a',
      gen: (x, p, q) => 440 + Math.sin(x / 90 + p) * 10 + Math.sin(x / 33 + q) * 5 },
    { name: '계곡', sky: ['#7a5aa8', '#f4b183'], ground: '#5a4036', grass: '#a08050',
      gen: (x, p, q) => 320 + 170 * bell(x, 500, 220) + Math.sin(x / 60 + p) * 10 },
    { name: '중앙 산', sky: ['#2c3e66', '#9fb4d8'], ground: '#555a63', grass: '#e6eef5',
      gen: (x, p, q) => 480 - 230 * bell(x, 500, 130) + Math.sin(x / 50 + p) * 8 },
  ];

  function terrain(id) {
    const m = MAPS[id], p = Math.random() * 6, q = Math.random() * 6;
    return Array.from({ length: 1000 }, (_, x) => Math.round(Math.min(540, Math.max(120, m.gen(x, p, q)))));
  }

  const api = { MAPS, terrain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMAP = api;
})(this);
