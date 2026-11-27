(function (root) {
  const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
  const step = (x, c) => .5 * (1 + Math.tanh((x - c) / 22));   // 부드러운 계단 (c 를 기준으로 0 → 1)

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
    { name: '쌍봉', neon: '#ff5a5a', sky: ['#14050a', '#431224'],
      gen: (x, p, q) => 500 - 200 * bell(x, 560, 190) - 200 * bell(x, 1440, 190) + Math.sin(x / 55 + p) * 8 + Math.sin(x / 280 + q) * 18 },
    { name: '분화구', neon: '#c8ff3d', sky: ['#0a1005', '#26380f'],
      gen: (x, p, q) => 470 - 130 * bell(x, DW / 2, 360) + 200 * bell(x, DW / 2, 120) + Math.sin(x / 70 + p) * 8 + Math.sin(x / 250 + q) * 14 },
    { name: '피라미드', neon: '#ffd23d', sky: ['#0d0a05', '#3a2a0f'],
      gen: (x, p, q) => 520 - 55 * step(x, 480) - 55 * step(x, 780) + 55 * step(x, 1220) + 55 * step(x, 1520) + Math.sin(x / 90 + p) * 5 + Math.sin(x / 320 + q) * 10 },
    { name: '파도', neon: '#4d9bff', sky: ['#040a1f', '#0b2a63'],
      gen: (x, p, q) => 430 + Math.sin(x / 70 + p) * 45 + Math.sin(x / 190 + q) * 35 },
    { name: '절벽', neon: '#b36bff', sky: ['#0b0618', '#2a1458'],
      gen: (x, p, q) => 340 + 190 * step(p > 3 ? DW - x : x, 1000) + Math.sin(x / 60 + p) * 8 + Math.sin(x / 260 + q) * 16 },
    { name: '섬들', neon: '#2effc4', sky: ['#03121a', '#0a3d4a'],
      gen: (x, p, q) => 545 - 215 * (bell(x, 360, 170) + bell(x, 1000, 200) + bell(x, 1640, 170)) + Math.sin(x / 55 + p) * 6 },
    { name: '톱니 능선', neon: '#ff4d9a', sky: ['#14040f', '#4a1034'],
      gen: (x, p, q) => 480 - 95 * Math.abs(Math.sin(x / 130 + p)) + Math.sin(x / 400 + q) * 30 },
    { name: '롤러코스터', neon: '#ff8a3d', sky: ['#120805', '#40200c'],
      gen: (x, p, q) => 410 + Math.sin(x / 160 + p) * 85 + Math.sin(x / 70 + q) * 22 },
    // ----- 전용 맵 (맵 선택 목록에는 안 나오고, 해당 모드에서 자동으로 쓰여요) -----
    // 탱크마다 사이에 높은 벽이 서 있어서, 시작하자마자 수평으로 쏴서 한 방에 끝나는 일이 없어요. 지형은 duelTerrain 이 탱크 위치에 맞춰 만들어요.
    { name: '저격 협곡', neon: '#7dffb0', sky: ['#04100c', '#0d3a2c'], duel: 'sniper', wall: 775, minY: 395,   // 벽 높이 775 → 꼭대기 y≈400: 낮게 쏴서는 절대 못 넘고, 높이 쏘아 올려야 넘어가요
      gen: () => 470 },
    { name: '레이저 미로', neon: '#ff6b6b', sky: ['#14050a', '#3d1030'], duel: 'laser', wall: 1055, minY: 115,   // 벽 꼭대기 y≈120: 천장 바로 아래라서 반사 경로로도 넘어가기 어려워요
      gen: () => 470 },
  ];
  const PUBLIC = 12;                                 // 맵 선택 목록에 나오는 일반 맵 개수 (뒤의 전용 맵은 제외)
  const DUEL = { sniper: 12, laser: 13 };            // 모드 → 전용 맵 번호

  // 전용 맵: 탱크(xs)들 사이마다 높고 얇은 벽을 세워요. (m.wall = 벽 높이, m.minY = 벽 꼭대기 y 한계)
  // 반환하는 배열에 walls = [[왼쪽 끝, 오른쪽 끝], ...] 도 같이 붙여요 (탱크는 이 안으로 들어갈 수 없어요).
  const WALL_SLOPE = 40, WALL_TOP = 30;              // 벽 옆면 경사(가로 1에 세로 40 = 거의 수직) / 벽 꼭대기 평평한 폭 · 벽이 얇아야 탱크 칸이 넓고, 완만한 벽은 빔을 탱크 쪽으로 모아주는 깔때기가 돼요
  function duelTerrain(id, xs) {
    const m = MAPS[id], p = Math.random() * 6, q = Math.random() * 6, hgt = m.wall, base = 470 * K, SL = m.slope || WALL_SLOPE, TOP = m.top || WALL_TOP;
    const sorted = (xs || []).slice().sort((a, b) => a - b);
    const mids = sorted.slice(1).map((x, k) => Math.round((sorted[k] + x) / 2));
    const half = hgt / SL + TOP / 2;
    const T = Array.from({ length: W }, (_, x) => {
      let h = 0;
      for (const c of mids) h = Math.max(h, Math.min(hgt, (hgt + TOP / 2 * SL) - Math.abs(x - c) * SL));   // 사다리꼴 벽 높이
      const floor = base + Math.sin(x / 220 + p) * 14 + Math.sin(x / 90 + q) * 5;                                           // 바닥은 완만하게 울퉁불퉁
      return Math.round(Math.min(540 * K, Math.max(m.minY || 120 * K, floor - Math.max(0, h))));
    });
    T.walls = mids.map(c => [Math.round(c - half - 12), Math.round(c + half + 12)]);
    T.wallMids = mids;
    return T;
  }

  function terrain(id, xs, p0, q0) {   // p0, q0: 지형 위상을 직접 정하면(순서 정하기의 개인 맵) 서버와 화면이 똑같은 지형을 만들어요
    if (MAPS[id].duel) return duelTerrain(id, xs);
    const m = MAPS[id], p = p0 !== undefined ? p0 : Math.random() * 6, q = q0 !== undefined ? q0 : Math.random() * 6;
    return Array.from({ length: W }, (_, x) =>
      Math.round(Math.min(540 * K, Math.max(120 * K, m.gen(x / K, p, q) * K))));
  }

  // ----- 튕김 링: 하얀 네온 링. 어떤 탄이든 링의 선에 닿으면 반사돼요 -----
  // 탱크(xs)에서 멀고, 다른 링(keep 포함)과 겹치지 않는 자리에 want개를 랜덤으로 세워요. (want 생략 시 2~3개)
  // 링은 땅에 반쯤 박혀도 되지만, 위쪽 절반 이상은 항상 땅 위로 드러나 있어야 해요 (다 묻혀서 아무 영향도 못 주면 안 되니까요).
  // 탱크를 가두는 자리는 피해요: 탱크가 링 안쪽에 들어가거나 링에 너무 가까우면 다시 뽑아요.
  function makeRings(T, xs, want, keep) {
    if (want === undefined) want = 2 + Math.floor(Math.random() * 2);
    const rings = [], all = keep || [];
    for (let tries = 0; tries < 600 && rings.length < want; tries++) {
      const r = Math.round(70 + Math.random() * 50), x = Math.round(W * (.1 + Math.random() * .8));   // r 은 정수 (아래에서 T[i] 인덱스로 쓰여요)
      let top = Infinity; for (let i = Math.max(0, x - r - 20); i <= Math.min(W - 1, x + r + 20); i += 5) top = Math.min(top, T[i]);   // top = 링 폭 안에서 가장 높은 땅(값이 작을수록 높아요)
      const y = Math.round(Math.random() < .45 ? top + r * (.1 - Math.random() * .9) : T[x] - (150 + Math.random() * 650));   // 45%는 땅에 박힌 링(중심이 땅 근처), 나머지는 하늘에 떠 있는 링
      if (y - r < 90) continue;                                                      // 하늘 끝에 너무 붙지 않게
      if (y > top + r * .1) continue;                                                // 중심이 가장 높은 땅보다 낮게 내려가면(절반 넘게 묻히면) 안 돼요
      if (xs.some((tx, k) => Math.abs(tx - x) < r + 220 || Math.hypot(tx - x, T[Math.round(tx)] - y) < r + 260)) continue;   // 탱크 바로 위·옆은 피해요 (가두는 링 방지)
      if (rings.concat(all).some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 160)) continue;  // 링끼리 겹치지 않게
      rings.push({ x, y, r: Math.round(r) });
    }
    return rings;
  }
  // 점 (x0,y0)→(x1,y1) 이동 중 링의 선을 가로지르면 그 자리에서 반사해요. 속도 크기는 그대로(탱탱볼처럼).
  // 반환: { x, y, vx, vy, cx, cy } (x,y = 반사 후 이번 걸음이 끝나는 자리, cx,cy = 부딪힌 자리) / 안 닿으면 null
  function ringBounce(rings, x0, y0, x1, y1, vx, vy) {
    if (!rings || !rings.length) return null;
    let best = null;
    for (const g of rings) {
      const d0 = Math.hypot(x0 - g.x, y0 - g.y), d1 = Math.hypot(x1 - g.x, y1 - g.y);
      if ((d0 - g.r) * (d1 - g.r) >= 0 || d0 === d1) continue;                      // 선을 가로지르지 않음
      const f = (d0 - g.r) / (d0 - d1);
      if (!best || f < best.f) best = { f, g, side: d0 > g.r ? 1 : -1 };
    }
    if (!best) return null;
    const { f, g, side } = best, cx = x0 + (x1 - x0) * f, cy = y0 + (y1 - y0) * f;
    const nl = Math.hypot(cx - g.x, cy - g.y) || 1, nx = (cx - g.x) / nl * side, ny = (cy - g.y) / nl * side;   // 부딪힌 쪽을 향한 법선
    const dot = vx * nx + vy * ny;
    if (dot >= 0) return null;                                                      // 이미 링에서 멀어지는 중
    const rvx = vx - 2 * dot * nx, rvy = vy - 2 * dot * ny, rest = Math.hypot(x1 - x0, y1 - y0) * (1 - f), vl = Math.hypot(rvx, rvy) || 1;
    return { x: cx + nx * .5 + rvx / vl * rest, y: cy + ny * .5 + rvy / vl * rest, vx: rvx, vy: rvy, cx, cy };
  }

  const api = { MAPS, PUBLIC, DUEL, terrain, K, W, H, TS, FUEL, STEP, SHOT_SPEED, makeRings, ringBounce };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMAP = api;
})(this);
