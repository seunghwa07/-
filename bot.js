// ===== 솔로 모드 AI (쉬움 · 보통 · 어려움) =====
// AI는 사람과 똑같은 규칙으로 움직여요: 이동(doMove) · 충전(doCharge) · 발사(doFire) · 순서 정하기(ofire) · 증강 선택을 서버 함수 그대로 호출해요.
// 조준은 서버의 비행 계산(flight · laserFlight · bumperFlight · zoneRun)을 그대로 돌려 보는 '시뮬레이션 탐색'이고,
// 난이도는 (1) 조준 오차 (2) 바람을 얼마나 정확히 읽는지 (3) 생각하는 시간 (4) 위치 잡기 (5) 증강 고르는 안목 으로 나뉘어요.
module.exports = function (X) {
  const { FMAP, FAUG, SHELL, flight, laserFlight, plasmaCone, echoCone, bumperFlight, splitFlight, zoneRun, dmgAt, tankY, isAlly, onIce, RAIL_LV, RAIL_MAX, RAIL_AIM_MIN,
    W, STEP, MAX_CLIMB, HIT_R, DIRECT, GRAV_R, GRAV_DMG, SNIPER_HIT, PIERCE_HIT, FIRE_R, FROST_R, WATER_R, CARPET_SPREAD, CARPET_GRAZE, ICE_FUEL, ICE_GAP,
    doMove, doCharge, doFire, orderFire, pickAug, isBot, orderCtx } = X;

  const LEVELS = {
    easy:   { label: '쉬움',   sa: 2.6,  sp: .05,  wind: .25, wn: 3, think: [2300, 4300], aug: 0, spots: 0, kill: 0,  human: 1,    moveP: .5 },
    normal: { label: '보통',   sa: 1.1,  sp: .02,  wind: .85, wn: 1, think: [1600, 3200], aug: 1, spots: 2, kill: 0,  human: 1.15, moveP: .8 },
    hard:   { label: '어려움', sa: .28,  sp: .005, wind: 1,   wn: 0, think: [1000, 2200], aug: 2, spots: 5, kill: 14, human: 1.3,  moveP: 1 },
    // 엑스퍼트: 어려움 + (1) 조준 오차 거의 0 (2) 촘촘한 0.25° 탐색 (3) 이동 후보 10곳 이상 비교 (4) 체력 낮은 적 집중 공격 (5) 내 자리의 '반격 위험'까지 계산 (6) 내 탱크에 맞는 증강만 고름
    expert: { label: '엑스퍼트', sa: .03, sp: .0005, wind: 1,   wn: 0, think: [600, 1300],   aug: 3, spots: 10, kill: 30, human: 1.5,  moveP: 1, fine: true, focus: .6, danger: .5 },
    // 임파서블: 엑스퍼트와 똑같은 실력 · 대신 탱크는 스나이퍼나 레이저만 써요 (서버 IMPOSSIBLE_TANKS)
    impossible: { label: '임파서블', sa: .03, sp: .0005, wind: 1, wn: 0, think: [600, 1300], aug: 3, spots: 10, kill: 30, human: 1.5, moveP: 1, fine: true, focus: .6, danger: .5, sharp: true },
  };
  const lvOf = k => LEVELS[k] || LEVELS.normal;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => { let u = 0; for (let k = 0; k < 4; k++) u += Math.random(); return (u - 2) * 1.73; };   // 평균 0, 표준편차 ≈ 1
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const later = (g, ms, fn) => { const t = setTimeout(() => { g.bt.delete(t); fn(); }, ms); g.bt.add(t); return t; };
  const clearBots = g => { if (g.bt) { g.bt.forEach(clearTimeout); g.bt.clear(); } };
  const live = (r, g) => !r.dead && r.game === g && g.winner === -1;

  // ---------- 평가: 이 조준으로 쐈을 때의 '기대 가치' ----------
  // 적에게 준 피해는 +, 나 자신이 입는 피해는 −. (사람 플레이어는 조금 더 노려요 / 어려움은 쓰러뜨리는 샷에 보너스)
  const foesOf = (g, i) => g.players.map((q, k) => k).filter(k => k !== i && g.players[k].hp > 0 && !isAlly(g, i, k));
  function val(ctx, k, dmg) {
    const { g, i, lv, r } = ctx, q = g.players[k];
    if (dmg <= 0) return 0;
    const d = dmg * q.mods.taken;
    if (k === i) return -d * (lv.focus ? 1.25 : 1);   // 엑스퍼트는 자폭 피해를 더 크게 봐요
    const focus = lv.focus ? 1 + lv.focus * (1 - Math.max(0, q.hp) / q.maxHp) : 1;   // 이미 다친 적일수록 더 높은 가치
    return d * focus * (isBot(r, k) ? 1 : lv.human) + (lv.kill && d >= q.hp ? lv.kill : 0);
  }
  // 폭발 한 번: impact 에서 (dmg, rad) 폭발 → 모든 탱크에 대한 가치 합 / near = 가장 가까운 적까지 거리
  function blast(ctx, imp, dmg, rad, direct = DIRECT, reach = rad + 25) {
    const { g, i } = ctx;
    let s = 0, near = Infinity;
    g.players.forEach((q, k) => {
      if (q.hp <= 0 || isAlly(g, i, k)) return;
      const d = Math.hypot(q.x - imp[0], tankY(g, q) - imp[1]);
      if (k !== i) near = Math.min(near, d);
      s += val(ctx, k, dmgAt(dmg, d, reach, direct));
    });
    return { s, near };
  }
  const shaped = (s, near) => s + (isFinite(near) ? 7 * Math.exp(-near / 260) : 0);   // 아직 못 맞히는 후보도 '가까울수록' 높게 쳐서 탐색이 길을 잃지 않게 해요

  function evalShot(ctx, a, pw) {
    const { g, i } = ctx, p = g.players[i], m = p.mods, kind = p.tank === 'escalation' ? 'basic' : p.tank === 'element' ? 'efire' : p.tank;
    const dm = kind === 'bumper' ? 1 : (SHELL[kind] ? SHELL[kind].dmg : 0) * m.dmg * (m.kindDmg[kind] || 1);
    const rad = SHELL[kind] ? SHELL[kind].rad * m.rad : 0;
    if (kind === 'bumper') {
      let s = 0, near = Infinity;
      bumperFlight(g, i, a, pw).forEach(sh => {
        if (!sh.impact) return;
        const key = 'bumper' + Math.min(2, sh.gen), e = blast(ctx, sh.impact, SHELL[key].dmg * m.dmg * (m.kindDmg.bumper || 1), SHELL[key].rad * m.rad);
        s += e.s; near = Math.min(near, e.near);
      });
      return { s, near };
    }
    if (kind === 'splitter') {   // 분열탄: 3초 뒤 터지는 자리 + 작은 탄들이 떨어지는 자리를 모두 계산해요
      let s = 0, near = Infinity;
      splitFlight(g, i, a, pw).forEach(sh => {
        if (!sh.impact) return;
        const key = sh.sub ? 'splitter2' : 'splitter', e = blast(ctx, sh.impact, SHELL[key].dmg * m.dmg * (m.kindDmg.splitter || 1), SHELL[key].rad * m.rad);
        s += e.s; near = Math.min(near, e.near);
      });
      return { s, near };
    }
    if (kind === 'carpet') {
      const f = flight(g, i, a, pw, 'carpet', true);
      if (!f.impact) return { s: 0, near: Infinity };
      const dir = f.vx >= 0 ? 1 : -1, rest = f.impact[0] + dir * Math.min(200, Math.abs(f.vx) * .1) * .85, nm = 3 + m.missiles;
      let s = 0, near = Infinity;
      for (let j = 0; j < nm; j++) {
        const k = j - (nm - 1) / 2, mx = rest + k * CARPET_SPREAD * m.spread, cmul = nm > 3 ? [1, .75, .5][Math.round(Math.abs(k))] || .5 : 1, base = SHELL.carpet.dmg * m.dmg * (m.kindDmg.carpet || 1) * cmul;
        const reach = Math.max(SHELL.carpet.rad * m.rad + 25, DIRECT + 20), gy = g.terrain[clamp(Math.round(mx), 0, W - 1)];
        g.players.forEach((q, t) => {
          if (q.hp <= 0 || isAlly(g, i, t)) return;
          const dx = Math.abs(q.x - mx), d = dx < HIT_R ? 0 : Math.hypot(dx, tankY(g, q) - gy);
          if (t !== i) near = Math.min(near, dx);
          s += val(ctx, t, d <= DIRECT ? base : d < reach ? CARPET_GRAZE * cmul * m.dmg : 0);
        });
      }
      return { s, near };
    }
    const f = flight(g, i, a, pw, kind);
    if (!f.impact) return { s: 0, near: Infinity };
    const imp = f.impact;
    if (kind === 'sniper') {
      const direct = SNIPER_HIT * m.hitr + 8;
      return blast(ctx, imp, dm, rad, direct, direct + 16);
    }
    if (kind === 'pierce') {
      const direct = PIERCE_HIT + 8, e = blast(ctx, imp, dm, rad, direct, Math.max(rad + 25, direct + 20));
      const bonus = foesOf(g, i).reduce((acc, k) => acc + (Math.hypot(g.players[k].x - imp[0], tankY(g, g.players[k]) - imp[1]) < PIERCE_HIT + 2 ? val(ctx, k, 6 * m.dmg * (m.kindDmg.pierce || 1)) : 0), 0);   // 드릴 추가 피해
      return { s: e.s + bonus, near: e.near };
    }
    if (kind === 'gravity') {
      const R = GRAV_R * m.rad, cy = imp[1], cx = imp[0];
      let s = 0, near = Infinity;
      g.players.forEach((q, k) => {
        if (q.hp <= 0) return;
        const d = Math.hypot(q.x - cx, tankY(g, q) - cy);
        if (k !== i && !isAlly(g, i, k)) near = Math.min(near, d);
        if (d <= R && !isAlly(g, i, k)) s += val(ctx, k, GRAV_DMG * m.dmg * (m.kindDmg.gravity || 1));
      });
      return { s, near };
    }
    if (kind === 'electro' || kind === 'grinder') {
      const hp = g.players.map(q => q.hp);
      let z = null;
      try { z = zoneRun(g, i, imp, f.vx, kind); } finally { g.players.forEach((q, k) => { q.hp = hp[k]; }); }   // 시뮬레이션이 체력을 건드리지 않게 되돌려요
      let s = 0;
      z.hits.forEach(h => { s += val(ctx, h.i, h.d / g.players[h.i].mods.taken); });
      const near = Math.min(Infinity, ...foesOf(g, i).map(k => Math.abs(g.players[k].x - imp[0])));
      return { s, near: near + (z.dir === Math.sign(g.players[foesOf(g, i)[0] || 0].x - imp[0]) ? 0 : 250) };
    }
    if (kind === 'cluster') {   // 소탄 8발이 흩어져요: 중심 가까이 떨어지면 점수가 부드럽게 오르는 커널로 평가
      let s = 0, near = Infinity;
      foesOf(g, i).forEach(k => { const q = g.players[k], d = Math.hypot(q.x - imp[0], tankY(g, q) - imp[1]); near = Math.min(near, d); s += val(ctx, k, 28 * m.dmg * (m.kindDmg.cluster || 1) * Math.max(0, 1 - d / (230 * m.rad))); });
      return { s, near };
    }
    const e = blast(ctx, imp, dm, rad);
    let s = e.s;
    // 상태 효과: 불길 · 얼음 · 물
    const gy = g.terrain[clamp(Math.round(imp[0]), 0, W - 1)];
    g.players.forEach((q, k) => {
      if (q.hp <= 0 || isAlly(g, i, k)) return;
      const d = Math.hypot(q.x - imp[0], tankY(g, q) - gy);
      if (kind === 'incendiary' && d < FIRE_R * m.area) s += val(ctx, k, 10 * m.fireMs * m.dmg * (m.kindDmg.incendiary || 1));
      if (kind === 'frost' && d < FROST_R * m.area && k !== i) s += val(ctx, k, 7);
      if (kind === 'water' && d < WATER_R * m.area && k !== i) s += val(ctx, k, 4);
    });
    return { s, near: e.near };
  }

  // ---------- 탐색: 거친 격자 → 가장 유망한 몇 곳을 촘촘하게 ----------
  function search(ev, o = {}) {
    const aS = o.aStep || 3, pS = o.pStep || 4, tops = [], cands = [], fs = o.fine ? .25 : .5;
    for (let a = o.lo ?? 8; a <= (o.hi ?? 172); a += aS) for (let pw = 12; pw <= 100; pw += pS) cands.push(ev(a, pw));   // lo/hi: 저주 '강제 고각'이면 70°~110°만
    cands.sort((x, y) => y.key - x.key);
    for (const c of cands) {
      if (tops.length >= (o.tops || (o.fine ? 8 : 5))) break;
      if (tops.every(t => Math.abs(t.a - c.a) >= aS * 3 || Math.abs(t.pw - c.pw) >= pS * 3)) tops.push(c);
    }
    let best = cands[0];
    if (!o.fast) for (const t of tops) for (let a = t.a - aS; a <= t.a + aS; a += fs) for (let pw = Math.max(10, t.pw - pS); pw <= Math.min(100, t.pw + pS); pw += fs) {
      if (a < 0 || a > 180) continue;
      const c = ev(a, pw); if (c.key > best.key) best = c;
    }
    if (o.fine && !o.fast) for (let a = best.a - .3; a <= best.a + .3; a += .05) for (let pw = Math.max(10, best.pw - .4); pw <= Math.min(100, best.pw + .4); pw += .05) {   // 최종 미세 조정
      if (a < 0 || a > 180) continue;
      const c = ev(a, pw); if (c.key > best.key) best = c;
    }
    return best;
  }
  const perceived = (g, lv, fn) => {   // 난이도에 따라 바람을 덜 정확하게 읽어요 (시뮬레이션하는 동안만 바꿔 두고 바로 되돌려요)
    const w0 = g.wind; g.wind = w0 * lv.wind + (lv.wn ? rnd(-lv.wn, lv.wn) : 0);
    try { return fn(); } finally { g.wind = w0; }
  };

  // 한 자리에서의 최선의 포격 계획
  function planAt(r, g, i, lv, fast) {
    const ctx = { r, g, i, lv, fast }, p = g.players[i], kind = p.tank === 'escalation' ? 'basic' : p.tank === 'element' ? 'efire' : p.tank;
    if (kind === 'laser') return planLaser(ctx);
    if (kind === 'plasma' || kind === 'echo') return planPlasma(ctx, kind);
    return perceived(g, lv, () => {
      const best = search((a, pw) => { const e = evalShot(ctx, a, pw); return { a, pw, s: e.s, key: shaped(e.s, e.near) }; }, Object.assign(fast ? { aStep: 4, pStep: 6, tops: 3, fast: false, fine: false } : { fine: !!lv.fine }, p.mods.hiAngle ? { lo: 70, hi: 110 } : {}));
      return { angle: best.a, power: best.pw, score: best.s };
    });
  }
  function planPlasma(ctx, kind = 'plasma') {   // 부채꼴(플라즈마 15° · 에코 30° + 벽 통과): 각도를 훑어서 맞는 적 가치(거리 감쇠 반영)가 가장 큰 방향을 골라요
    const { g, i } = ctx, m = g.players[i].mods, mul = m.dmg * (m.kindDmg[kind] || 1), cone = kind === 'echo' ? echoCone : plasmaCone;
    const ev = a => {
      const c = cone(g, i, a); let s = 0, near = Infinity;
      c.hits.forEach(h => { s += val(ctx, h.i, h.dmg * mul); });
      if (!s) foesOf(g, i).forEach(k => { const q = g.players[k]; near = Math.min(near, Math.abs(Math.atan2(-(tankY(g, q) - c.y0), q.x - c.x0) * 180 / Math.PI - a) * Math.PI / 180 * Math.hypot(q.x - c.x0, tankY(g, q) - c.y0)); });
      return { a, s, key: shaped(s, near) };
    };
    const all = []; for (let a = RAIL_AIM_MIN; a <= 180 - RAIL_AIM_MIN; a += 3) all.push(ev(a));
    all.sort((x, y) => y.key - x.key); let best = all[0];
    for (const t of all.slice(0, 3)) for (let a = t.a - 3; a <= t.a + 3; a += .5) { if (a < RAIL_AIM_MIN || a > 180 - RAIL_AIM_MIN) continue; const c = ev(a); if (c.key > best.key) best = c; }
    return { angle: best.a, power: 100, score: best.s, wide: true };
  }
  function planLaser(ctx) {
    const { g, i } = ctx, m = g.players[i].mods, dmg = SHELL.laser.dmg * m.dmg * (m.kindDmg.laser || 1);
    const ev = a => {
      const f = laserFlight(g, i, a);
      const s = f.hit != null && !isAlly(g, i, f.hit) ? val(ctx, f.hit, dmg) : 0;
      let near = Infinity;
      if (!s) foesOf(g, i).forEach(k => f.path.forEach(pt => { near = Math.min(near, Math.hypot(pt[0] - g.players[k].x, pt[1] - tankY(g, g.players[k]))); }));
      return { a, s, key: shaped(s, near) };
    };
    const sharp = !!ctx.lv.sharp && !ctx.fast;   // 임파서블(실제로 쏠 때만 · 자리를 비교하는 동안은 가볍게): 더 촘촘히 훑고(1° → ±1° 를 0.05° 간격으로) 조준 오차도 0 — 반사를 거쳐도 빗나가지 않게
    let best = null; const all = [];
    for (let a = sharp ? 1 : 2; a <= (sharp ? 179 : 178); a += sharp ? 1 : 2) all.push(ev(a));
    all.sort((x, y) => y.key - x.key); best = all[0];
    const rs = sharp ? 1 : 2, st = sharp ? .05 : .25;
    for (const t of all.slice(0, sharp ? 8 : 4)) for (let a = t.a - rs; a <= t.a + rs; a += st) { if (a < 0 || a > 180) continue; const c = ev(a); if (c.key > best.key) best = c; }
    if (sharp) for (let a = best.a - .06; a <= best.a + .06; a += .005) { if (a < 0 || a > 180) continue; const c = ev(a); if (c.key > best.key) best = c; }   // 마지막으로 한 번 더 아주 촘촘히 (0.005°)
    return { angle: best.a, power: 100, score: best.s, exact: sharp };
  }
  const noisy = (pl, lv) => ({ ...pl, angle: clamp(pl.angle + (pl.exact ? 0 : gauss() * lv.sa), pl.wide ? RAIL_AIM_MIN : 0, pl.wide ? 180 - RAIL_AIM_MIN : 180), power: clamp(pl.power * (1 + gauss() * lv.sp), 10, 100) });

  // ---------- 레일건: 충전(턴 소모) → 직선 관통 빔. 몇 번 충전할지, 어디를 겨눌지 ----------
  function railBeam(g, i, angle, lv) {   // 이 각도·충전 단계로 쏘면 맞는 (적) 가치
    const p = g.players[i], L = RAIL_LV[clamp(lv, 0, RAIL_MAX)], a = angle * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a), x0 = p.x, y0 = g.terrain[p.x] - 20 * FMAP.TS;
    let s = 0, kills = 0, near = Infinity;
    g.players.forEach((q, k) => {
      if (k === i || q.hp <= 0 || isAlly(g, i, k)) return;
      const qy = tankY(g, q), t = clamp((q.x - x0) * dx + (qy - y0) * dy, 0, L.len), d = Math.hypot(x0 + dx * t - q.x, y0 + dy * t - qy);
      near = Math.min(near, d);
      if (d < L.wid * p.mods.beam && Math.hypot(q.x - x0, qy - y0) <= L.len + L.wid * p.mods.beam) { const v = L.dmg * p.mods.dmg * (p.mods.kindDmg.rail || 1) * q.mods.taken; s += v; if (v >= q.hp) kills++; }
    });
    return { s, kills, near };
  }
  function planRailExpert(r, g, i, lv) {
    const p = g.players[i], ch = p.charge || 0, key = e => e.s + e.kills * lv.kill - e.near * .01;
    if (ch < 1) return { fire: false, angle: 90, power: 100 };
    let best = null;
    for (let a = RAIL_AIM_MIN; a <= 180 - RAIL_AIM_MIN; a += 1) { const e = railBeam(g, i, a, ch), k = key(e); if (!best || k > best.k) best = { a, k, e }; }
    const c0 = best.a;
    for (let a = c0 - 1; a <= c0 + 1; a += .05) { if (a < RAIL_AIM_MIN || a > 180 - RAIL_AIM_MIN) continue; const e = railBeam(g, i, a, ch), k = key(e); if (k > best.k) best = { a, k, e }; }
    // 처치 가능 / 최대 충전 / 2단계로 이미 큰 피해(45+)를 줄 수 있으면 발사, 아니면 계속 충전
    const fire = best.e.kills > 0 || ch >= RAIL_MAX || (ch >= 2 && best.e.s >= 45);
    return { fire, angle: best.a, power: 100 };
  }
  function planRail(r, g, i, lv) {
    if (lv.fine) return planRailExpert(r, g, i, lv);
    const p = g.players[i], ch = p.charge || 0, x0 = p.x, y0 = g.terrain[p.x] - 20 * FMAP.TS, foes = foesOf(g, i);
    const ang = k => { let d = Math.atan2(-(tankY(g, g.players[k]) - y0), g.players[k].x - x0) * 180 / Math.PI; if (d < RAIL_AIM_MIN) d += 360; return d; };
    const dist = k => Math.hypot(g.players[k].x - x0, tankY(g, g.players[k]) - y0);
    // 가장 가치 있는 목표(가까운 적 / 어려움은 약한 적)를 골라 각도를 맞춰요
    foes.sort((a, b) => (lv === LEVELS.hard ? g.players[a].hp - g.players[b].hp : dist(a) - dist(b)));
    const tgt = foes[0], need = RAIL_LV.findIndex((L, n) => n >= 1 && L.len >= dist(tgt)), want = need < 0 ? RAIL_MAX : Math.max(1, need);   // 사거리가 닿는 최소 충전 단계
    let best = null;
    for (let a = ang(tgt) - 6; a <= ang(tgt) + 6; a += .1) { const e = railBeam(g, i, a, Math.max(1, ch)); const key = e.s - e.near * .01; if (!best || key > best.key) best = { angle: a, key, s: e.s }; }
    // 몇 단계까지 충전해서 쏠지: 쉬움 = 닿으면 바로 / 보통 = 2단계 이상 / 어려움 = 3단계(확실히 처치할 수 있으면 그 전에)
    const goal = lv === LEVELS.easy ? want : lv === LEVELS.normal ? Math.max(want, 2) : Math.max(want, 3);
    const killNow = ch >= 1 && foes.some(k => railBeam(g, i, best.angle, ch).kills > 0);
    const fireNow = ch >= 1 && (ch >= Math.min(goal, RAIL_MAX) || (lv === LEVELS.hard && killNow));
    return { fire: fireNow, angle: best.angle, power: 100 };
  }

  // ---------- 위치 잡기 ----------
  function walkPath(g, i, dir, maxSteps) {   // dir 방향으로 걸을 때 도달 가능한 x 좌표 목록
    const p = g.players[i], xs = []; let x = p.x;
    for (let s = 0; s < maxSteps; s++) {
      const nx = x + dir * STEP;
      if (nx < 40 || nx > W - 40) break;
      if (g.terrain[nx] < g.terrain[x] - MAX_CLIMB) break;
      if (g.players.some((q, k) => k !== i && q.hp > 0 && Math.abs(q.x - nx) < 40)) break;
      x = nx; xs.push(x);
    }
    return xs;
  }
  function chooseSpot(r, g, i, lv, cur) {
    const p = g.players[i], icy = onIce(g, p), maxSteps = Math.floor(g.fuel / (STEP * (icy ? ICE_FUEL : 1)));
    if (maxSteps < 3) return null;
    const foes = foesOf(g, i), nearest = foes.map(k => g.players[k]).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    if (!nearest) return null;
    const toward = Math.sign(nearest.x - p.x) || 1;
    const paths = { [toward]: walkPath(g, i, toward, maxSteps), [-toward]: walkPath(g, i, -toward, maxSteps) };
    const out = cur.score <= 0 && Math.abs(nearest.x - p.x) > 700;   // 지금 자리에선 아무도 못 맞혀요 → 사거리 밖이면 일단 다가가요
    const approach = frac => { const path = paths[toward]; return path.length ? path[Math.min(path.length - 1, Math.max(0, Math.round(path.length * frac) - 1))] : null; };
    if (lv === LEVELS.easy) {   // 쉬움: 사거리 밖이면 느긋하게 다가가고, 아니면 가끔 어슬렁어슬렁 (방향은 가끔 틀려요)
      if (out) return approach(rnd(.4, .8));
      if (Math.random() > lv.moveP) return null;
      const dir = Math.random() < .75 ? toward : -toward, path = paths[dir];
      return path.length ? path[Math.min(path.length - 1, Math.floor(path.length * rnd(.2, .6)))] : null;
    }
    const cands = [];   // [x] 후보: 양쪽으로 1/3 · 2/3 · 끝 (엑스퍼트는 1/5 간격)
    [toward, -toward].forEach(dir => { const path = paths[dir]; if (!path.length) return; (lv.fine ? [.2, .4, .6, .8, 1] : [.34, .67, 1]).forEach(f => cands.push(path[Math.min(path.length - 1, Math.round(path.length * f) - 1 < 0 ? 0 : Math.round(path.length * f) - 1)])); });
    const uniq = [...new Set(cands)];
    if (lv === LEVELS.normal) {   // 보통: 후보 중 무작위 두 곳만 훑어봐요
      uniq.sort(() => Math.random() - .5);
    } else uniq.sort((a, b) => Math.abs(a - nearest.x) - Math.abs(b - nearest.x));
    let best = null;
    const scored = [];
    for (const cx of uniq.slice(0, lv.spots)) {
      const x0 = p.x; p.x = cx;
      let pl; try { pl = planAt(r, g, i, lv, true); } finally { p.x = x0; }
      scored.push({ x: cx, score: pl.score });
      if (!best || pl.score > best.score) best = { x: cx, score: pl.score };
    }
    if (lv.danger && scored.length) {   // 엑스퍼트: 공격 점수가 높은 후보 3곳(+현재 자리)만 '적의 반격 위험'을 빼서 다시 비교해요
      const risk = x => { const x0 = p.x; p.x = x; try { return threatAt(g, i); } finally { p.x = x0; } };
      const curTotal = cur.score - lv.danger * risk(p.x);
      best = null;
      scored.sort((a, b) => b.score - a.score).slice(0, 3).forEach(c => { const t = c.score - lv.danger * risk(c.x); if (!best || t > best.total) best = { x: c.x, score: c.score, total: t }; });
      if (best && best.total > curTotal + 3) return best.x;
      return out ? approach(1) : null;
    }
    if (best && best.score > cur.score + 4) return best.x;
    return out ? approach(lv === LEVELS.hard ? 1 : .85) : null;   // 어느 자리에서도 못 맞히면 적 쪽으로 최대한(보통은 조금 덜) 다가가요
  }
  // 내 자리(p.x)가 적에게 얼마나 위험한가: 살아 있는 적마다 '기본탄'으로 나를 가장 가깝게 맞히는 조준을 거친 격자로 찾아 피해량을 어림해요
  function threatAt(g, i) {
    const me = g.players[i], my = tankY(g, me); let t = 0;
    foesOf(g, i).forEach(k => {
      let bd = Infinity;
      for (let a = 10; a <= 170; a += 6) for (let pw = 14; pw <= 100; pw += 8) {
        const f = flight(g, k, a, pw, 'basic'); if (!f.impact) continue;
        const d = Math.hypot(f.impact[0] - me.x, f.impact[1] - my); if (d < bd) bd = d;
      }
      if (isFinite(bd)) t += dmgAt(20 * g.players[k].mods.dmg, bd, 95, DIRECT) * me.mods.taken;
    });
    return t;
  }
  const nominal = (g, i) => { const p = g.players[i], k = p.tank === 'escalation' ? 'basic' : p.tank === 'element' ? 'efire' : p.tank; return Math.max(6, (SHELL[k] && SHELL[k].dmg || 15) * p.mods.dmg * (p.mods.kindDmg[k] || 1)); };

  // ---------- 한 차례 ----------
  function turn(r, g) {
    if (!live(r, g) || g.phase !== 'play' || g.busy || g.botBusy) return;
    const i = g.turn, sl = r.slots[i];
    if (!sl || !sl.bot || g.players[i].hp <= 0) return;
    g.botBusy = true;
    const lv = lvOf(sl.level), ok = () => live(r, g) && g.turn === i && g.phase === 'play' && !g.busy && g.players[i].hp > 0;
    const done = () => { g.botBusy = false; };
    later(g, rnd(lv.think[0], lv.think[1]), () => {
      if (!ok()) return done();
      try { act(r, g, i, lv, ok, done); } catch (e) { console.error('bot error', e); done(); if (ok()) fallback(r, g, i); }
    });
  }
  function fallback(r, g, i) {   // 계산 중 오류가 나도 게임이 멈추지 않게 아무 데나 쏴요
    g.botBusy = true;
    const p = g.players[i];
    if (p.tank === 'rail' && (p.charge || 0) < 1) doCharge(r, i); else doFire(r, i, Math.random() * 100 + 40, rnd(40, 90));
    g.botBusy = false;
  }
  function act(r, g, i, lv, ok, done) {
    const p = g.players[i];
    if (p.tank === 'rail') {   // 충전하거나 발사해요 (충전하면 이번 턴은 끝나요)
      const pl = planRail(r, g, i, lv);
      done();
      if (pl.fire) doFire(r, i, clamp(pl.angle + gauss() * lv.sa * .35, RAIL_AIM_MIN, 180 - RAIL_AIM_MIN), 100); else doCharge(r, i);
      return;
    }
    const cur = planAt(r, g, i, lv, false);
    const good = nominal(g, i) * .55;
    let spot = null;
    const needMove = cur.score < good || (lv === LEVELS.hard && cur.score < nominal(g, i) * .9) || (lv.fine && cur.score < Math.max(lv.kill, nominal(g, i) * 1.1));   // 엑스퍼트: 처치(점수에 kill 보너스 포함)할 수 있는 샷이 아니면 항상 더 좋은 자리를 찾아봐요
    if (g.fuel > 0 && p.tank !== 'explosive' && needMove) spot = chooseSpot(r, g, i, lv, cur);
    if (spot == null) { done(); doFire(r, i, ...fireArgs(noisy(cur, lv))); return; }
    // 이동한 뒤 새 자리에서 다시 조준해요
    const dir = Math.sign(spot - p.x) || 1;
    const tick = () => {
      if (!ok()) return done();
      const icy = onIce(g, p);
      if (Math.abs(spot - p.x) < STEP * .5 || !doMove(r, i, dir)) {
        later(g, 350, () => {
          if (!ok()) return done();
          const pl = planAt(r, g, i, lv, false);
          done(); doFire(r, i, ...fireArgs(noisy(pl, lv)));
        });
        return;
      }
      later(g, icy ? ICE_GAP + 10 : 38, tick);
    };
    tick();
  }
  const fireArgs = pl => [pl.angle, pl.power];

  // ---------- 순서 정하기: 목표물에 가장 가깝게 ----------
  function order(r, g) {
    r.slots.forEach((sl, i) => {
      if (!sl || !sl.bot) return;
      const lv = lvOf(sl.level);
      later(g, Math.max(0, g.orderGoAt - Date.now()) + rnd(lv.think[0] * .6, lv.think[1] * 1.3), () => {
        if (!live(r, g) || g.phase !== 'order' || g.oshots[i]) return;
        const og = orderCtx(g, i), om = g.om[i], tx = om.tx, ty = om.terrain[tx];   // 내 개인 맵과 내 목표물
        const pl = perceived(og, lv, () => search((a, pw) => {
          const f = flight(og, i, a, pw, 'basic', true), d = f.impact ? Math.hypot(f.impact[0] - tx, f.impact[1] - ty) : 1e5;
          return { a, pw, key: -d };
        }));
        const n = noisy({ angle: pl.a, power: pl.pw }, lv);
        orderFire(r, i, n.angle, n.power);
      });
    });
  }

  // ---------- 증강 고르기 ----------
  function augScore(g, i, id, lv) {
    const a = FAUG.byId[id], x = a.mods || {}, p = g.players[i];
    let s = a.tank ? 4 : 0;
    s += (x.hp || 0) / 14 + (x.heal ? Math.min(x.heal, p.maxHp - p.hp) / 12 : 0);
    s += ((x.dmg || 1) - 1) * 30 + (1 - (x.taken || 1)) * 34 + ((x.rad || 1) - 1) * 18;
    const own = p.tank === 'escalation' ? null : p.tank;
    Object.entries(x.kindDmg || {}).forEach(([k, v]) => { s += (v - 1) * 28 * (lv.aug >= 3 && own && k !== own ? .08 : 1); });   // 엑스퍼트: 내 탱크 탄에만 붙는 증강을 높게 쳐요
    if (p.tank !== 'explosive') s += ((x.fuel || 1) - 1) * 3;
    s += ((x.shells || 1) - 1) * 4 + (x.bounce || 0) * 2 + ((x.beam || 1) - 1) * 6 + (x.missiles || 0) * 1.5 + (x.drills ? 4 : 0) + (x.dual ? 3 : 0) + (x.jumbo ? 2 : 0) + (x.split > 2 ? 3 : 0);
    return s + (lv.aug === 1 ? rnd(-3, 3) : 0);
  }
  function augment(r, g) {
    (g.pickers || []).forEach(i => {
      const sl = r.slots[i];
      if (!sl || !sl.bot) return;
      const lv = lvOf(sl.level);
      later(g, rnd(1200, 3600) * (lv.fine ? .45 : lv === LEVELS.hard ? .6 : 1), () => {
        if (r.dead || r.game !== g || g.phase !== 'augment' || g.picks[i]) return;
        const offers = g.offers[i] || []; if (!offers.length) return;
        const id = lv.aug === 0 ? offers[Math.floor(Math.random() * offers.length)] : offers.slice().sort((a, b) => augScore(g, i, b, lv) - augScore(g, i, a, lv))[0];
        pickAug(r, i, id);
      });
    });
  }

  return { LEVELS, lvOf, turn, order, augment, clearBots };
};
