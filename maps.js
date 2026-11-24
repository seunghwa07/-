(function (root) {
  const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

  // 월드 크기: 지형/배경은 2000×600 "설계 좌표"에서 만들고 K배 확대해요 (월드 = 5000×1500).
  // 화면(카메라)은 이 월드의 일부(2000×1200)만 비춰요.
  const K = 2.5, DW = 2000, W = DW * K, H = 600 * K;
  const TS = 1.3;                      // 탱크 그리기/충돌 배율
  const SHOT_SPEED = 0.8;              // 탄이 날아가는 속도 배율 (1 = 원래 속도). 서버 타이밍과 화면 연출이 같이 써요
  const FUEL = 500, STEP = 6;          // 턴마다 이동 가능한 거리(px), 한 번에 움직이는 거리

  // neon: 땅 테두리에서 빛나는 네온 색, sky: 어두운 밤하늘 그라데이션
  // gen(x, p, q): 설계 좌표 x(0~2000)의 지면 높이(y). 값이 클수록 낮은 지형. p, q는 판마다 달라지는 랜덤 위상.
  const MAPS = [
    { name: '언덕', neon: '#39ff88', sky: ['#050a1f', '#111a48'],
      gen: (x, p, q) => 400 + Math.sin(x / 120 + p) * 50 + Math.sin(x / 47 + q) * 20 + Math.sin(x / 330 + q * 1.7) * 40 },
    { name: '평원', neon: '#2ef2ff', sky: ['#04101e', '#0a2c52'],
      gen: (x, p, q) => 440 + Math.sin(x / 90 + p) * 10 + Math.sin(x / 33 + q) * 5 + Math.sin(x / 300 + q) * 14 },
    { name: '계곡', neon: '#ff3df2', sky: ['#12041f', '#3a1052'],
      gen: (x, p, q) => 320 + 170 * bell(x, DW / 2, 380) + Math.sin(x / 60 + p) * 10 + Math.sin(x / 260 + q) * 25 },
    { name: '중앙 산', neon: '#ffae2e', sky: ['#090613', '#2d1238'],
      gen: (x, p, q) => 480 - 230 * bell(x, DW / 2, 230) + Math.sin(x / 50 + p) * 8 + Math.sin(x / 300 + q) * 25 },
  ];

  function terrain(id) {
    const m = MAPS[id], p = Math.random() * 6, q = Math.random() * 6;
    return Array.from({ length: W }, (_, x) =>
      Math.round(Math.min(540 * K, Math.max(120 * K, m.gen(x / K, p, q) * K))));
  }

  const api = { MAPS, terrain, K, W, H, TS, FUEL, STEP, SHOT_SPEED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMAP = api;
})(this);
