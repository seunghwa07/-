(function (root) {
  const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

  // neon: 땅 테두리에서 빛나는 네온 색, sky: 어두운 밤하늘 그라데이션
  // gen(x, p, q): 해당 x의 지면 높이(y). 값이 클수록 낮은 지형. p, q는 판마다 달라지는 랜덤 위상.
  const MAPS = [
    { name: '언덕', neon: '#39ff88', sky: ['#050a1f', '#111a48'],
      gen: (x, p, q) => 400 + Math.sin(x / 120 + p) * 50 + Math.sin(x / 47 + q) * 20 },
    { name: '평원', neon: '#2ef2ff', sky: ['#04101e', '#0a2c52'],
      gen: (x, p, q) => 440 + Math.sin(x / 90 + p) * 10 + Math.sin(x / 33 + q) * 5 },
    { name: '계곡', neon: '#ff3df2', sky: ['#12041f', '#3a1052'],
      gen: (x, p, q) => 320 + 170 * bell(x, 500, 220) + Math.sin(x / 60 + p) * 10 },
    { name: '중앙 산', neon: '#ffae2e', sky: ['#090613', '#2d1238'],
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
