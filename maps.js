(function (root) {
  const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

  // 월드 크기: 기존 1000×600 기준 좌표계를 K배 키운 값. 지형 식(gen)은 기존 좌표계 그대로 쓰고 결과만 K배 해요.
  const K = 2.5, W = 1000 * K, H = 600 * K;
  const TS = 1.3;                      // 탱크 그리기/충돌 배율 (월드가 커진 만큼 상대적으로 작아져요)
  const FUEL = 500, STEP = 6;          // 턴마다 이동 가능한 거리(px), 한 번에 움직이는 거리

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
    return Array.from({ length: W }, (_, x) =>
      Math.round(Math.min(540 * K, Math.max(120 * K, m.gen(x / K, p, q) * K))));
  }

  const api = { MAPS, terrain, K, W, H, TS, FUEL, STEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMAP = api;
})(this);
