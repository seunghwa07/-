(function (root) {
  const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

  // pal: 2D 카툰 팔레트(하늘·해·먼 산·잔디·흙·외곽선). neon/sky는 예전 값(호환용)
  // gen(x, p, q): 해당 x의 지면 높이(y). 값이 클수록 낮은 지형. p, q는 판마다 달라지는 랜덤 위상.
  const MAPS = [
    { name: '언덕', neon: '#39ff88', pal: { sky: ['#7ec8ff', '#d6f1ff'], sun: '#fff3a0', far: '#a9dcc9', near: '#8ed39c', grass: '#5ed05a', grassDark: '#3ea546', dirt: '#c68a55', dirt2: '#b87a47', dark: '#9a6238', line: '#4a2f1b' }, sky: ['#050a1f', '#111a48'],
      gen: (x, p, q) => 400 + Math.sin(x / 120 + p) * 50 + Math.sin(x / 47 + q) * 20 },
    { name: '평원', neon: '#2ef2ff', pal: { sky: ['#ffb68a', '#ffeccc'], sun: '#fff7cf', far: '#f4b79d', near: '#e9a28b', grass: '#9bd648', grassDark: '#74b032', dirt: '#c9945a', dirt2: '#bb844b', dark: '#9f6a3a', line: '#4d3320' }, sky: ['#04101e', '#0a2c52'],
      gen: (x, p, q) => 440 + Math.sin(x / 90 + p) * 10 + Math.sin(x / 33 + q) * 5 },
    { name: '계곡', neon: '#ff3df2', pal: { sky: ['#a98bff', '#ffd6f2'], sun: '#fff0fb', far: '#c6aaf0', near: '#ab8ddb', grass: '#42d1a0', grassDark: '#2aa57d', dirt: '#8d6bb5', dirt2: '#7f5ea8', dark: '#6a4a92', line: '#33204f' }, sky: ['#12041f', '#3a1052'],
      gen: (x, p, q) => 320 + 170 * bell(x, 500, 220) + Math.sin(x / 60 + p) * 10 },
    { name: '중앙 산', neon: '#ffae2e', pal: { sky: ['#ff9d6e', '#ffe0a0'], sun: '#fffbd0', far: '#eb9c7e', near: '#d4856a', grass: '#e0b840', grassDark: '#b88f25', dirt: '#a9694a', dirt2: '#9a5c3f', dark: '#824a30', line: '#3d2217' }, sky: ['#090613', '#2d1238'],
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
