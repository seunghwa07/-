const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const FMAP = require('./maps.js');
const FAUG = require('./augments.js');

const app = express();
app.use(express.static(__dirname));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const { K, W, H, TS, FUEL, STEP } = FMAP;
const G = 500 * K, CRATER = 60, HIT_R = 18 * TS, MAX = 4, RANDOM_MAP = 4;
const SPAWN = [100, 366, 633, 900].map(x => Math.round(x * W / 1000));   // 월드 폭에 비례해서 흩어 놓아요
const ICONS = ['🪖', '🐸', '🚀', '🐱', '🤖', '🦖'];
const rooms = new Map();

// ---------- 탱크(포탄) 종류 ----------
// dmg: 직격 피해 (기본탄 17 → 정통으로 6발 맞으면 HP 100 파괴), rad: 폭발(크레이터) 크기
const KINDS = ['basic', 'incendiary', 'cluster', 'homing', 'heavy', 'pierce', 'laser', 'carpet', 'bumper'];
const SHELL = {
  basic: { dmg: 17, rad: CRATER }, incendiary: { dmg: 10, rad: 40 }, cluster: { dmg: 5, rad: 22 }, homing: { dmg: 12, rad: 45 },
  carpet: { dmg: 20, rad: 40 },   // 융단 폭격: 미사일 1발 정통 20 / 스치면 13 (CARPET_GRAZE) 피해 (신호탄 자체는 피해 없음)
  bumper0: { dmg: 20, rad: 52 }, bumper1: { dmg: 12, rad: 42 }, bumper2: { dmg: 8, rad: 34 },   // 범퍼: 첫 탄 20 / 한 번 튄 탄 12 / 두 번 튄 가장 작은 탄 8
  pierce: { dmg: 14, rad: 30 }, laser: { dmg: 22, rad: 0 },   // 관통탄(기본탄보다 약함 · 맞은 탱크는 드릴로 2×3 추가 피해) / 레이저(직격만, 기본탄 17보다 센 22)
  heavy: { dmg: 68, rad: Math.round(CRATER * Math.sqrt(6)) },   // 광폭탄: 피해 4배(기본탄 17의 4배), 폭발 면적 6배(반지름 √6배)
};
const SPEED = { heavy: Math.sqrt(0.7) };   // 광폭탄 탄속: 사거리가 속도²에 비례하므로 사거리 70%
const DIRECT = HIT_R + 8;          // 이 거리 안이면 직격 → 전체 피해
const PIERCE_HIT = HIT_R * 2;      // 관통탄 피격 범위: 기본 판정의 2배
const DRILL_TICK = 2, DRILL_N = 3, DRILL_MS = 850;   // 관통탄 드릴: 맞은 탱크를 2 피해씩 3번 더 갈아요 / 화면에서 갈리는 시간
const LASER_HIT = HIT_R * 1.9;     // 레이저 판정 범위: 기본 판정의 약 1.9배 (빔이 굵은 만큼 넓게)
const MAX_CLIMB = 90;              // 한 걸음(6px)당 최대 오르막 높이 → 약 86° 경사까지 (거의 수직 절벽만 막혀요)
const FIRE_R = 170, FIRE_MS = 3000, BURN_TICK = 500, BURN_DMG = 2;   // 소이탄: 불길 반경 / 3초 지속 / 0.5초마다 2 피해
const CLUSTER_N = 8;               // 집속탄 한 번에 나가는 소탄 수
const ORDER_GO = 3600, ORDER_MS = 15000;   // 순서 정하기: 시작 연출(로딩+등장) 시간 / 조준·발사 제한시간
// 융단 폭격: 가벼운 신호탄(피해 없음)이 날아가 땅에서 조금 구른 뒤, 붉은 연기가 피어나고 위에서 미사일 3발이 수직으로 떨어져요. (시간 단위 = 화면 애니메이션 프레임)
const CARPET_GLOW = 70, CARPET_GAP = 16, CARPET_FALL = 34, CARPET_SPREAD = 110, CARPET_WIND = 1.6;   // 신호탄은 가벼워서 바람을 1.6배 더 타요
const CARPET_GRAZE = 13;           // 융단 폭격 미사일에 스쳐 맞았을 때 피해
const BUMPER_BOUNCES = 2, BUMPER_HIT = Math.min(HIT_R * 1.4, DIRECT - 1);   // 범퍼탄은 커진 만큼 탱크 피격 범위도 넓어요
const BUMPER_SPREAD = .2;          // 범퍼탄이 튀는 횟수 (튈 때마다 좌우로 2개씩 쪼개져요)
const DUD = 0.3, HOMING_TURN = 2.2; // 유도탄 불발 확률 / 초당 최대 회전각(rad)

const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
// FUEL, STEP 은 maps.js 에서 가져와요
const rndWind = () => Math.round(Math.random() * 20 - 10);
const count = r => r.slots.filter(Boolean).length;
const host = r => r.slots.findIndex(Boolean);
const toRoom = (r, m) => r.slots.forEach(s => s && send(s.ws, m));
const roomMsg = r => ({ type: 'room', code: r.code, host: host(r), mapId: r.mapId, mode: r.mode, teams: r.slots.map(s => s && s.team), tanks: r.slots.map(s => s && s.tank), names: r.slots.map(s => s && s.name), icons: r.slots.map(s => s && s.icon) });
const listMsg = () => ({
  type: 'rooms',
  rooms: [...rooms.values()].map(r => ({
    code: r.code, count: count(r), map: r.mapId, mode: r.mode, host: r.slots[host(r)].name, playing: !!r.game,
  })),
});
const pushList = () => { const m = listMsg(); wss.clients.forEach(c => !c.room && send(c, m)); };

function newCode() {
  let c;
  do c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
  while (rooms.has(c));
  return c;
}

// ----- 증강 헬퍼: 능력치는 p.mods (augments.js 의 calc 결과) 에 모여 있어요 -----
const fuelOf = (g, i) => Math.round(FUEL * g.players[i].mods.fuel);
const turnMsg = g => ({ type: 'turn', turn: g.turn, wind: g.wind, fuel: g.fuel, fuelMax: fuelOf(g, g.turn) });
function scaleDmg(g, from, to, amt, kind, mul = 1) {   // 주는 쪽 · 받는 쪽 증강을 반영한 최종 피해
  const a = g.players[from] && g.players[from].mods, b = g.players[to].mods, k = String(kind).replace(/\d+$/, '');
  return Math.round(amt * mul * (a ? a.dmg * (a.kindDmg[k] || 1) : 1) * b.taken);
}
const alive = g => g.players.map((p, i) => (p.on && p.hp > 0 ? i : -1)).filter(i => i >= 0);

function nextTurn(g, from) {   // 순서 정하기로 정해진 차례(g.order)를 따라 돌아요
  const o = g.order && g.order.length ? g.order : [0, 1, 2, 3], pos = o.indexOf(from);
  for (let k = 1; k <= o.length; k++) {
    const i = o[(pos + k + o.length) % o.length];
    if (g.players[i].on && g.players[i].hp > 0) return i;
  }
  return from;
}

// 시작 위치: 맵 양 끝에 나눠 배치해요. 팀전은 A팀=왼쪽, B팀=오른쪽, 개인전은 번갈아 양쪽에.
const EDGE = [300, 800, 1300];   // 맵 끝에서 안쪽으로 떨어진 거리 (같은 쪽에 여럿이면 차례로)
function spawnXs(r) {
  const xs = [], used = [0, 0];
  r.slots.map((s, i) => (s ? i : -1)).filter(i => i >= 0).forEach((i, n) => {
    const side = r.mode === 'team' ? r.slots[i].team : n % 2, k = used[side]++;
    xs[i] = side === 0 ? EDGE[k] : W - EDGE[k];
  });
  return xs;
}

function newGame(r) {
  const xs = spawnXs(r);
  const map = r.mapId === RANDOM_MAP ? Math.floor(Math.random() * FMAP.MAPS.length) : r.mapId;
  r.game = {
    map, terrain: FMAP.terrain(map), wind: rndWind(), winner: -1, mode: r.mode, winTeam: -1, fires: [],
    players: SPAWN.map((sx, i) => ({ x: xs[i] ?? sx, hp: r.slots[i] ? 100 : 0, maxHp: 100, mods: FAUG.calc([]), aug: [], on: !!r.slots[i], team: r.slots[i] ? r.slots[i].team : 0, tank: r.slots[i] ? r.slots[i].tank : 'basic', name: r.slots[i] ? r.slots[i].name : '', icon: r.slots[i] ? r.slots[i].icon : '' })),
  };
  const g = r.game;
  g.turn = g.players.findIndex(p => p.on);
  g.fuel = fuelOf(g, g.turn);
  // 순서 정하기: 목표물 하나를 맵 가운데 쪽 랜덤 위치에 세우고, 모두 동시에 한 발씩 쏴서 가장 가까운 순서대로 차례를 정해요
  g.phase = 'order'; g.order = null; g.oshots = {};
  g.target = { x: Math.round(W * (.4 + Math.random() * .2)) };
  g.orderGoAt = Date.now() + ORDER_GO; g.orderEnd = g.orderGoAt + ORDER_MS;
  g.orderTimer = setTimeout(() => resolveOrder(r, g), ORDER_GO + ORDER_MS + 1500);   // 시간이 지나면 못 쏜 사람은 꼴찌 처리
}

function snapshot(r) {
  const g = r.game;
  return {
    type: 'state', map: g.map, terrain: g.terrain, turn: g.turn, wind: g.wind, winner: g.winner, fuel: g.fuel, mode: g.mode, winTeam: g.winTeam, busy: !!g.busy, fuelMax: fuelOf(g, g.turn),
    phase: g.phase, target: g.target, order: g.order, ofired: g.players.map((_, i) => !!g.oshots[i]),
    orderGo: Math.max(0, g.orderGoAt - Date.now()), orderLeft: Math.max(0, g.orderEnd - Date.now()),
    teams: g.players.map(p => p.team),
    fires: fireList(g),
    players: g.players.map(p => ({ team: p.team, tank: p.tank, x: p.x, y: g.terrain[p.x], hp: p.hp, maxHp: p.maxHp, aug: p.aug, on: p.on, name: p.name, icon: p.icon })),
  };
}

function checkEnd(r, animMs = 0) {   // animMs: 이번 포탄 화면 연출 길이 (끝난 뒤에도 5초 보여줘요)
  const g = r.game, a = alive(g);
  if (g.mode === 'team') {   // 팀전: 살아있는 팀이 하나 이하면 종료
    const ts = new Set(a.map(i => g.players[i].team));
    if (ts.size > 1) return false;
    g.winTeam = ts.size ? [...ts][0] : -1;
  } else if (a.length > 1) return false;
  g.winner = a.length ? a[0] : -2; // -2: 무승부
  clearTimeout(g.orderTimer); clearTimeout(g.augTimer);
  setTimeout(() => {
    if (r.game === g) { r.game = null; toRoom(r, roomMsg(r)); pushList(); }
  }, 5000 + animMs);
  return true;
}

function crater(g, cx, cy, rad) {
  for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(W - 1, Math.ceil(cx + rad)); x++) {
    const dy = Math.sqrt(Math.max(0, rad * rad - (x - cx) ** 2));
    if (g.terrain[x] <= cy + dy) g.terrain[x] = Math.min(H, Math.round(cy + dy));
  }
}

// 직격(DIRECT 이내)은 전체 피해, 멀어질수록 줄어들어 최소 25%
const dmgAt = (base, d, reach, direct = DIRECT) => d >= reach ? 0 : d <= direct ? base : Math.max(Math.round(base * .25), Math.round(base * (1 - (d - direct) / (reach - direct))));
const isAlly = (g, a, b) => g.mode === 'team' && a !== b && g.players[a].team === g.players[b].team;
const tankY = (g, q) => g.terrain[q.x] - 10 * TS;

// 포탄 한 발의 비행 계산. 유도탄은 가장 가까운 적 쪽으로 휘어져요.
function flight(g, shooter, angle, power, kind, free = false, pick = 0) {   // free: 탱크에 맞지 않고 지형에만 닿아요 (순서 정하기용)
  const p = g.players[shooter];
  const a = angle * Math.PI / 180, v = power * 8 * K * (SPEED[kind] || 1), dt = 1 / 120;
  let x = p.x, y = g.terrain[p.x] - 14 * TS;
  let vx = v * Math.cos(a), vy = -v * Math.sin(a);
  const path = [[x, y]];
  let impact = null, target = null, out = false;
  if (kind === 'homing') {
    const foes = g.players.filter((q, i) => q.hp > 0 && i !== shooter && !isAlly(g, shooter, i)).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
    target = foes[pick] || foes[0] || null;   // pick: 몇 번째로 가까운 적을 노릴지 (듀얼의 두 번째 탄은 1)
  }
  for (let t = 0; t < 3600; t++) {
    if (target && t > 30) {
      const want = Math.atan2(tankY(g, target) - y, target.x - x), cur = Math.atan2(vy, vx), sp = Math.hypot(vx, vy);
      let d = want - cur;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const na = cur + Math.max(-HOMING_TURN * dt, Math.min(HOMING_TURN * dt, d));
      vx = sp * Math.cos(na) + g.wind * 1.5 * K * dt; vy = sp * Math.sin(na) + G * .3 * dt;
    } else { vx += g.wind * 3 * K * dt * (kind === 'carpet' ? CARPET_WIND : 1); vy += G * dt; }
    x += vx * dt; y += vy * dt;
    if (t % 4 === 0) path.push([x, y]);
    if (x < 0 || x >= W || y > H) { out = true; break; }
    if (kind !== 'pierce' && y >= g.terrain[Math.floor(x)]) { impact = [x, y]; break; }   // 관통탄은 땅을 그냥 통과해요
    if (!free && g.players.some((q, i) => q.hp > 0 && (i !== shooter || t > 40) && !isAlly(g, shooter, i) &&
        Math.hypot(x - q.x, y - tankY(g, q)) < (kind === 'pierce' ? PIERCE_HIT : HIT_R))) { impact = [x, y]; break; }
  }
  if (impact) path.push(impact);
  return { path, impact, fizzled: !impact && !out, vx, vy };   // fizzled: 30초 넘게 날다 소멸
}

// 범퍼: 탱탱볼처럼 땅에 닿으면 튀면서 좌우로 2개씩 쪼개져요. (첫 탄 → 2발 → 4발)
// 쪼개진 탄의 path 는 '부모가 튀기 전까지의 경로 + 자기 경로'로 이어 붙여서, 화면에서는 모든 탄이 같은 시간축으로 날아가요. splits = 튄 지점의 path 인덱스
function bumperFlight(g, shooter, angle, power) {
  const p = g.players[shooter], a = angle * Math.PI / 180, v = power * 8 * K, dt = 1 / 120, out = [];
  const { jumbo, split } = p.mods, maxB = jumbo ? 3 : BUMPER_BOUNCES;   // 증강: 점보(큰 탄 하나가 3번 튕김) / 분열(튈 때 4개)
  const run = (x, y, vx, vy, gen, prefix, splits) => {
    const path = []; let impact = null, hitTank = false;
    for (let t = 0; t < 3600; t++) {
      vx += g.wind * 3 * K * dt; vy += G * dt; x += vx * dt; y += vy * dt;
      if (t % 4 === 0) path.push([x, y]);
      if (x < 0 || x >= W || y > H) break;
      if (y >= g.terrain[Math.floor(x)]) { impact = [x, y]; break; }
      if (g.players.some((q, i) => q.hp > 0 && (i !== shooter || splits.length > 0 || t > 40) && !isAlly(g, shooter, i) && Math.hypot(x - q.x, y - tankY(g, q)) < BUMPER_HIT)) { impact = [x, y]; hitTank = true; break; }
    }
    if (impact) path.push(impact);
    const full = prefix.concat(path);
    if (impact && !hitTank && jumbo && splits.length < maxB) {   // 점보: 쪼개지지 않고 앞으로 통통 튀어요
      const dir = vx >= 0 ? 1 : -1, sx = Math.max(2, Math.min(W - 3, Math.round(impact[0] + dir * 5))), sy = Math.min(impact[1], g.terrain[sx]) - 4;
      run(sx, sy, dir * Math.max(Math.abs(vx) * .7, v * .12), -Math.max(Math.abs(vy) * .55, v * .27), gen, full, splits.concat(full.length - 1));
    } else if (impact && !hitTank && splits.length < maxB) {   // 땅에 닿음 → 튀면서 좌우로 쪼개져요 (이 지점에서는 폭발·피해 없음)
      for (const dir of split >= 4 ? [-1.7, -.6, .6, 1.7] : [-1, 1]) {
        const sx = Math.max(2, Math.min(W - 3, Math.round(impact[0] + dir * 5))), sy = Math.min(impact[1], g.terrain[sx]) - 4;
        run(sx, sy, dir * Math.max(Math.abs(vx) * .22, v * .06) * BUMPER_SPREAD / .2, -Math.max(Math.abs(vy) * .5, v * .27), gen + 1, full, splits.concat(full.length - 1));
      }
    } else out.push({ path: full, impact, gen, splits, fizzled: false, jumbo });
  };
  run(p.x, g.terrain[p.x] - 14 * TS, v * Math.cos(a), -v * Math.sin(a), 0, [[p.x, g.terrain[p.x] - 14 * TS]], []);
  return out;
}

// 레이저: 포물선 없이 직선으로 날아가고, 벽(지형)과 맵 경계(왼쪽·오른쪽·위)에 닿으면 반사돼요. 4번 반사한 뒤 또 닿으면 사라져요.
const LASER_BOUNCES = 4;
function laserFlight(g, shooter, angle) {
  const p = g.players[shooter], a = angle * Math.PI / 180, STEP = 4, maxB = LASER_BOUNCES + p.mods.bounce, hitR = LASER_HIT * p.mods.beam, MAXLEN = 60000 * (maxB / LASER_BOUNCES);   // 증강: 반사 횟수·판정 범위   // 맵 폭(5000)보다 훨씬 길게: 4번 튕기는 동안 거리 제한에 걸려 사라지지 않게 해요
  let x = p.x, y = g.terrain[p.x] - 20 * TS, dx = Math.cos(a), dy = -Math.sin(a);
  let bounces = 0, len = 0, rec = 0, hit = null, impact = null;
  const path = [[x, y]];
  while (len < MAXLEN) {
    const nx = x + dx * STEP, ny = y + dy * STEP;
    if (nx < 0 || nx >= W || ny < 0) {                                           // 맵 경계(왼쪽·오른쪽·위)도 벽처럼 반사
      path.push([x, y]); rec = 0;
      if (bounces >= LASER_BOUNCES) break;                                       // 5번째 접촉: 소멸
      bounces++;
      if (nx < 0 || nx >= W) dx = -dx;
      if (ny < 0) dy = -dy;
      continue;
    }
    const ti = g.players.findIndex((q, i) => q.hp > 0 && (i !== shooter || bounces > 0 || len > 90) && !isAlly(g, shooter, i) &&
      Math.hypot(nx - q.x, ny - tankY(g, q)) < hitR);
    if (ti >= 0) { hit = ti; impact = [nx, ny]; x = nx; y = ny; break; }          // 탱크 명중
    if (ny >= g.terrain[Math.floor(nx)]) {                                       // 벽에 닿음
      path.push([x, y]); rec = 0;
      if (bounces >= LASER_BOUNCES) break;                                       // 5번째 접촉: 소멸
      bounces++;
      const xi = Math.floor(nx), xl = Math.max(0, xi - 6), xr = Math.min(W - 1, xi + 6);
      const sl = (g.terrain[xr] - g.terrain[xl]) / ((xr - xl) || 1), nl = Math.hypot(sl, 1), nX = sl / nl, nY = -1 / nl;   // 지형 표면의 바깥쪽 법선
      const dot = dx * nX + dy * nY;
      if (dot < 0) { dx -= 2 * dot * nX; dy -= 2 * dot * nY; }
      else { bounces--; x = nx; y = ny; len += STEP; rec += STEP; }   // 이미 벽에서 멀어지는 중(스치기/파묻힘): 튕김으로 세지 않고 그냥 빠져나가요
      continue;
    }
    x = nx; y = ny; len += STEP; rec += STEP;
    if (rec >= 50) { path.push([x, y]); rec = 0; }
  }
  const last = path[path.length - 1];
  if (last[0] !== x || last[1] !== y) path.push([x, y]);
  return { path, impact, hit, fizzled: false, bounces };
}

// 착탄: 땅 파임 + 피해(팀전에서는 아군 제외) + 소이탄이면 불길 생성 (delay: 클라이언트 화면에서 폭발이 보일 때까지의 시간)
function explode(g, shooter, impact, kind, delay = 0, mul = 1) {   // mul: 이 포탄의 피해 배율 (듀얼 0.7)
  const { dmg, rad } = SHELL[kind], direct = kind === 'pierce' ? PIERCE_HIT + 8 : DIRECT, reach = kind === 'pierce' ? Math.max(rad + 25, direct + 20) : rad + 25;
  crater(g, impact[0], impact[1], rad);
  g.players.forEach((q, i) => {
    if (q.hp <= 0 || isAlly(g, shooter, i)) return;
    const d = Math.hypot(q.x - impact[0], tankY(g, q) - impact[1]);
    q.hp = Math.max(0, q.hp - scaleDmg(g, shooter, i, kind === 'carpet' ? (d <= direct ? dmg : d < Math.max(reach, direct + 20) ? CARPET_GRAZE : 0) : dmgAt(dmg, d, reach, direct), kind, mul));   // 융단 폭격: 정통 20 / 스치면 일정하게 13
  });
  if (kind === 'incendiary') {
    const fx = Math.max(0, Math.min(W - 1, Math.round(impact[0]))), t0 = Date.now() + delay;
    g.fires.push({ x: fx, y: g.terrain[fx], r: Math.round(FIRE_R * g.players[shooter].mods.area), by: shooter, startAt: t0, endsAt: t0 + FIRE_MS, next: t0 + BURN_TICK });
  }
}

// 관통탄: 원래대로 착탄 피해(14, 주변은 줄어든 피해)를 주고, 맞은 탱크 하나는 드릴로 2 피해씩 3번 더 갈아요
function drill(g, shooter, s, delay, mul = 1) {   // mul: 작은 드릴 0.5
  let hit = -1, best = Infinity;
  g.players.forEach((q, i) => {
    if (q.hp <= 0 || isAlly(g, shooter, i)) return;
    const d = Math.hypot(q.x - s.impact[0], tankY(g, q) - s.impact[1]);
    if (d < PIERCE_HIT + 2 && d < best) { best = d; hit = i; }
  });
  const hp0 = hit >= 0 ? g.players[hit].hp : 0;
  explode(g, shooter, s.impact, 'pierce', delay, mul);
  if (hit < 0) return;
  s.hit = hit; s.hd = hp0 - g.players[hit].hp;   // hd: 착탄 피해 (화면에서 드릴 틱보다 먼저 보여줘요)
  g.players[hit].hp = Math.max(0, g.players[hit].hp - scaleDmg(g, shooter, hit, DRILL_TICK * DRILL_N, 'pierce', mul));
}

const fireList = g => g.fires.map(f => ({ x: f.x, y: f.y, r: f.r, life: Math.max(0, f.endsAt - Math.max(Date.now(), f.startAt)) }));

// 소이탄 불길: 실시간으로 0.5초마다 불 위의 탱크에 2 피해, 3초 뒤 꺼져요
function startBurn(r) {
  const g = r.game;
  if (!g.burnTimer) g.burnTimer = setInterval(() => burnTick(r, g), 100);
}
function burnTick(r, g) {
  if (r.game !== g || g.winner !== -1 || !g.fires.length) { clearInterval(g.burnTimer); g.burnTimer = null; return; }
  const now = Date.now(); let changed = false, died = false;
  g.fires.forEach(f => {
    while (now >= f.next && f.next <= f.endsAt) {
      f.next += BURN_TICK; changed = true;
      g.players.forEach((q, i) => {
        if (q.hp <= 0 || isAlly(g, f.by, i) || Math.hypot(q.x - f.x, tankY(g, q) - f.y) >= f.r) return;
        q.hp = Math.max(0, q.hp - scaleDmg(g, f.by, i, BURN_DMG, 'incendiary'));
        if (q.hp <= 0) died = true;
      });
    }
  });
  const n = g.fires.length;
  g.fires = g.fires.filter(f => now < f.endsAt);
  if (g.fires.length !== n) changed = true;
  if (died) {   // 화상으로 누군가 쓰러졌어요: 승패/차례를 다시 계산해서 전체 상태를 보내요
    if (!checkEnd(r) && !g.busy && g.players[g.turn].hp <= 0) advance(r, g.turn);
    toRoom(r, snapshot(r));
  } else if (changed) toRoom(r, { type: 'burn', hp: g.players.map(p => p.hp), fires: fireList(g) });
}

// 턴은 포탄이 명중 / 불발 / 맵 밖으로 사라진 뒤에만 넘어가요.
// 쏜 사람의 화면에서 포탄이 끝나면 'landed'를 보내고, 안 오면 예상 시간 뒤에 서버가 넘겨요.
function endBusy(g) { g.busy = false; g.orderBusy = false; clearTimeout(g.busyTimer); }
function resolveShot(r, g) {
  if (r.game !== g || !g.busy || g.phase === 'augment') return;
  endBusy(g);
  if (g.winner !== -1) return;
  advance(r, g.turn);
  toRoom(r, turnMsg(g));
}

const allFired = g => g.players.every((p, i) => !p.on || p.hp <= 0 || g.oshots[i]);
const SHOT_MS = len => len * 1000 / 60 / FMAP.SHOT_SPEED;   // 화면 애니메이션 길이와 같은 계산

// 순서 정하기 결과: 모두의 포탄을 한꺼번에 날리고, 목표물에 가까운 순서대로 g.order 를 정해요
function resolveOrder(r, g) {
  if (r.game !== g || g.phase !== 'order' || g.winner !== -1) return;
  clearTimeout(g.orderTimer);
  g.phase = 'play';
  const tx = g.target.x, ty = g.terrain[tx];
  const res = [];
  g.players.forEach((p, i) => {
    if (!p.on || p.hp <= 0) return;
    const s = g.oshots[i], e = { i, angle: s ? s.angle : 90, path: null, impact: null, dist: Infinity, tb: Math.random() };
    if (s) { const f = flight(g, i, s.angle, s.power, 'basic', true); e.path = f.path; e.impact = f.impact; if (f.impact) e.dist = Math.hypot(f.impact[0] - tx, f.impact[1] - ty); }
    res.push(e);
  });
  const rank = [...res].sort((a, b) => a.dist < b.dist ? -1 : a.dist > b.dist ? 1 : a.tb - b.tb);
  g.order = rank.map(e => e.i);
  g.turn = g.order[0] ?? g.turn; g.wind = rndWind(); g.fuel = fuelOf(g, g.turn);
  g.busy = true; g.orderBusy = true;
  const ms = Math.max(0, ...res.filter(e => e.path).map(e => SHOT_MS(e.path.length))) + 4800;   // 포탄 비행 + 결과 카드 시간
  g.busyTimer = setTimeout(() => {
    if (r.game !== g || !g.busy) return;
    endBusy(g);
    startAugment(r, g);   // 순서가 정해졌으니 증강을 고르고 시작해요
  }, ms);
  toRoom(r, {
    type: 'oshot', order: g.order,
    shots: res.filter(e => e.path).map(e => ({ by: e.i, angle: e.angle, path: e.path, impact: e.impact })),
    ranks: rank.map(e => ({ i: e.i, dist: isFinite(e.dist) ? Math.round(e.dist) : null })),
    state: snapshot(r),
  });
}

// ===== 증강 선택 단계: 순서가 정해진 뒤, 모두 3개 중 하나를 골라야 본 게임이 시작돼요 =====
const allPicked = g => g.players.every((p, i) => !p.on || p.hp <= 0 || g.picks[i]);
function startAugment(r, g) {
  if (r.game !== g || g.winner !== -1) return;
  g.phase = 'augment'; g.busy = true; g.picks = {};
  g.offers = g.players.map(p => (p.on && p.hp > 0 ? FAUG.offer(p.tank, p.aug) : []));
  g.augTimer = setTimeout(() => finishAugment(r, g), FAUG.PICK_MS + 800);   // 시간이 지나면 못 고른 사람은 랜덤
  r.slots.forEach((sl, i) => sl && send(sl.ws, { type: 'augment', offers: g.offers[i], left: FAUG.PICK_MS }));
}
function finishAugment(r, g) {
  if (r.game !== g || g.phase !== 'augment') return;
  clearTimeout(g.augTimer);
  g.players.forEach((p, i) => {
    if (!p.on || p.hp <= 0) return;
    const id = g.picks[i] || g.offers[i][Math.floor(Math.random() * g.offers[i].length)];
    if (!id) return;
    g.picks[i] = id; p.aug.push(id);
    const before = p.mods.hp; p.mods = FAUG.calc(p.aug);
    p.maxHp = 100 + p.mods.hp; p.hp = Math.max(1, p.hp + p.mods.hp - before);   // 체력 증강은 현재 체력도 같이 올려요
  });
  g.phase = 'play'; g.fuel = fuelOf(g, g.turn); endBusy(g);
  toRoom(r, { type: 'augdone', picks: g.picks });
  toRoom(r, snapshot(r));
  toRoom(r, turnMsg(g));
}

function advance(r, from) {   // 다음 차례로 넘겨요
  const g = r.game;
  g.turn = nextTurn(g, from); g.wind = rndWind(); g.fuel = fuelOf(g, g.turn);
}

function fireCarpet(r, shooter, angle, power) {
  const g = r.game, f = flight(g, shooter, angle, power, 'carpet', true);   // 신호탄은 탱크에 맞지 않고 땅에만 닿아요
  const path = f.path.slice(), missiles = [];
  let landIdx = -1;
  if (f.impact) {
    landIdx = path.length - 1;
    // 던진 물건처럼 날아오던 방향으로 통통 튀며 조금 굴러가요 (가파른 오르막이면 멈춰요)
    const dir = f.vx >= 0 ? 1 : -1, want = Math.min(200, Math.abs(f.vx) * .1), N = Math.max(6, Math.round(want / 5));
    let px = f.impact[0];
    for (let k = 1; k <= N; k++) {
      const u = k / N, nx = Math.round(f.impact[0] + dir * want * (1 - (1 - u) * (1 - u)));
      if (nx < 20 || nx > W - 20 || g.terrain[nx] < g.terrain[Math.round(px)] - 14) break;
      px = nx;
      path.push([nx, g.terrain[nx] - 6 - 16 * Math.abs(Math.sin(u * Math.PI * 2.5)) * (1 - u)]);
    }
    const rest = path[path.length - 1];
    const nm = 3 + g.players[shooter].mods.missiles;   // 증강(신호탄): 미사일 수
    for (const k of Array.from({ length: nm }, (_, j) => j - (nm - 1) / 2)) {   // 신호탄 위치와 양옆, 위에서 수직으로 떨어져요
      const x = Math.max(2, Math.min(W - 3, Math.round(rest[0] + k * CARPET_SPREAD))), y0 = Math.max(-300, g.terrain[x] - 1100);
      let y1 = g.terrain[x], hit = false;
      for (let y = y0; y < g.terrain[x]; y += 5) {
        if (g.players.some((q, i) => q.hp > 0 && !isAlly(g, shooter, i) && Math.hypot(x - q.x, y - tankY(g, q)) < HIT_R)) { y1 = y; hit = true; break; }
      }
      explode(g, shooter, [x, y1], 'carpet');   // 앞 미사일이 판 땅과 입은 피해가 다음 미사일에 바로 반영돼요
      missiles.push({ x, y0, y1, hit });
    }
  }
  const total = path.length + (missiles.length ? CARPET_GLOW + CARPET_GAP * (missiles.length - 1) + CARPET_FALL : 20);
  if (!checkEnd(r, SHOT_MS(total))) { g.busy = true; g.busyTimer = setTimeout(() => resolveShot(r, g), SHOT_MS(total) + 2000); }
  return { type: 'shot', by: shooter, angle, kind: 'carpet', dud: false, shells: [],
    carpet: { path, landIdx, missiles, glow: CARPET_GLOW, gap: CARPET_GAP, fall: CARPET_FALL, total }, state: snapshot(r) };
}

function fire(r, shooter, angle, power) {
  const g = r.game, kind = g.players[shooter].tank;
  if (kind === 'carpet') return fireCarpet(r, shooter, angle, power);
  let shells, dud = false;
  if (kind === 'cluster') {
    shells = Array.from({ length: Math.round(CLUSTER_N * g.players[shooter].mods.shells) }, () =>
      flight(g, shooter, Math.min(180, Math.max(0, angle + (Math.random() - .5) * 14)), Math.min(100, power * (.9 + Math.random() * .2)), kind));
  } else if (kind === 'homing') {   // 유도탄: 듀얼 증강이면 2발(각 피해 70%) · 발마다 따로 30% 불발
    const n = g.players[shooter].mods.dual ? 2 : 1;
    shells = Array.from({ length: n }, (_, k) => {
      const ang = n > 1 ? Math.min(180, Math.max(0, angle + (k ? -3 : 3))) : angle;   // 두 발이 살짝 벌어져 나가요
      let s;
      if (Math.random() < DUD) {   // 불발: 날아가다 떨어져 사라져요
        s = flight(g, shooter, ang, power, 'basic');
        s.path = s.path.slice(0, Math.max(3, Math.floor(s.path.length * (.35 + Math.random() * .4)))); s.impact = null; s.dudShell = true;
      } else s = flight(g, shooter, ang, power, 'homing', false, k);   // 두 번째 탄은 두 번째로 가까운 적 (적이 하나면 같은 적)
      if (n > 1) s.mul = .7;
      return s;
    });
    dud = shells.every(s => s.dudShell);
  } else if (kind === 'laser') shells = [laserFlight(g, shooter, angle)];
  else if (kind === 'bumper') shells = bumperFlight(g, shooter, angle, power);
  else if (kind === 'pierce' && g.players[shooter].mods.drills) {   // 다중 드릴: 기존 드릴 + 양옆으로 작은 드릴 2발 (각 피해 50%)
    shells = [flight(g, shooter, angle, power, kind)];
    [4, -4].forEach(d => { const s = flight(g, shooter, Math.min(180, Math.max(0, angle + d)), power, kind); s.small = true; s.mul = .5; shells.push(s); });
  }
  else shells = [flight(g, shooter, angle, power, kind)];

  if (shells.length === 1 && shells[0].fizzled) dud = true;   // 맴돌다 사라진 포탄도 불발로 처리
  // 클라이언트 애니메이션(약 60프레임/초)이 끝나 폭발이 보일 때쯤 불길이 시작되도록 맞춰요
  shells.forEach(s => { if (kind === 'pierce') { if (s.impact) drill(g, shooter, s, Math.round(s.path.length * 1000 / 60 / FMAP.SHOT_SPEED) + 300, s.mul || 1); } else if (kind === 'laser') { if (s.hit != null) g.players[s.hit].hp = Math.max(0, g.players[s.hit].hp - scaleDmg(g, shooter, s.hit, SHELL.laser.dmg, 'laser')); } else if (s.impact) explode(g, shooter, s.impact, kind === 'bumper' ? 'bumper' + s.gen : kind, Math.round(s.path.length * 1000 / 60 / ((kind === 'heavy' ? .6 : 1) * FMAP.SHOT_SPEED)) + 300, s.mul || 1); });
  if (g.fires.length) startBurn(r);

  const ms = Math.max(...shells.map(s => s.path.length)) * 1000 / 60 / ((kind === 'heavy' ? .6 : 1) * FMAP.SHOT_SPEED) + 2000 + (kind === 'pierce' ? DRILL_MS : 0);
  if (!checkEnd(r, ms - 2000)) {   // 턴은 바로 넘기지 않고, 포탄이 끝날 때까지 기다려요
    g.busy = true;
    g.busyTimer = setTimeout(() => resolveShot(r, g), ms);
  }
  return { type: 'shot', by: shooter, angle, kind, dud, beam: kind === 'laser' ? g.players[shooter].mods.beam : 1, shells: shells.map(s => ({ path: s.path, impact: s.impact, gen: s.gen, splits: s.splits, hit: s.hit, hd: s.hd, small: !!s.small, jumbo: !!s.jumbo })), state: snapshot(r) };
}

function join(ws, r, name, icon) {
  const i = r.slots.indexOf(null);
  const t0 = r.slots.filter(s => s && s.team === 0).length, t1 = r.slots.filter(s => s && s.team === 1).length;
  r.slots[i] = { ws, name, icon, team: t0 <= t1 ? 0 : 1, tank: 'basic' };   // 인원이 적은 팀에 자동 배정
  ws.room = r; ws.slot = i;
  send(ws, { type: 'joined', code: r.code, you: i });
  toRoom(r, roomMsg(r));
  pushList();
}

function leave(ws) {
  const r = ws.room;
  if (!r) return;
  const i = ws.slot, g = r.game;
  r.slots[i] = null; ws.room = null;
  if (!count(r)) rooms.delete(r.code);
  else if (g) {
    if (g.players[i].on && g.winner === -1) {
      g.players[i].hp = 0;
      if (!checkEnd(r)) {
        if (g.phase === 'order') { if (allFired(g)) { toRoom(r, snapshot(r)); resolveOrder(r, g); pushList(); return; } }
        else if (g.phase === 'augment') { if (allPicked(g)) finishAugment(r, g); }
        else if (g.turn === i) { endBusy(g); advance(r, i); }
      }
    }
    toRoom(r, snapshot(r));
  } else toRoom(r, roomMsg(r));
  pushList();
}

wss.on('connection', ws => {
  ws.room = null;
  send(ws, listMsg());

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const r = ws.room;
    const name = String(m.name || '').trim().slice(0, 8) || '플레이어';
    const icon = ICONS.includes(m.icon) ? m.icon : ICONS[0];

    if (m.type === 'create' && !r) {
      const code = newCode();
      const nr = { code, slots: Array(MAX).fill(null), mapId: 0, mode: 'ffa', game: null };
      rooms.set(code, nr);
      join(ws, nr, name, icon);
    } else if (m.type === 'join' && !r) {
      const t = rooms.get(String(m.code || '').toUpperCase());
      if (!t) return send(ws, { type: 'error', msg: '방을 찾을 수 없어요' });
      if (t.game) return send(ws, { type: 'error', msg: '이미 게임이 진행 중이에요' });
      if (!t.slots.includes(null)) return send(ws, { type: 'error', msg: '방이 가득 찼어요' });
      join(ws, t, name, icon);
    } else if (m.type === 'leave') {
      leave(ws); send(ws, listMsg());
    } else if (r && m.type === 'map' && !r.game && ws.slot === host(r)) {
      r.mapId = Math.max(0, Math.min(RANDOM_MAP, (+m.id) | 0));
      toRoom(r, roomMsg(r)); pushList();
    } else if (r && m.type === 'mode' && !r.game && ws.slot === host(r)) {
      r.mode = m.mode === 'team' ? 'team' : 'ffa';
      toRoom(r, roomMsg(r)); pushList();
    } else if (r && m.type === 'team' && !r.game) {
      // 본인 팀은 누구나, 다른 사람의 팀은 방장만 바꿀 수 있어요
      const target = Number.isInteger(m.slot) && ws.slot === host(r) ? m.slot : ws.slot;
      if (r.mode === 'team' && r.slots[target]) { r.slots[target].team = m.team === 1 ? 1 : 0; toRoom(r, roomMsg(r)); }
    } else if (r && m.type === 'tank' && !r.game && KINDS.includes(m.kind)) {
      r.slots[ws.slot].tank = m.kind; toRoom(r, roomMsg(r));
    } else if (r && m.type === 'start' && !r.game && ws.slot === host(r) && count(r) >= 2) {
      if (r.mode === 'team') {
        const t0 = r.slots.filter(s => s && s.team === 0).length, t1 = r.slots.filter(s => s && s.team === 1).length;
        if (!t0 || !t1) return send(ws, { type: 'error', msg: '팀전은 양 팀에 최소 1명씩 필요해요' });
      }
      newGame(r); toRoom(r, snapshot(r)); pushList();
    } else if (r && m.type === 'landed') {
      const g = r.game;
      if (g && g.busy && !g.orderBusy && g.phase !== 'order' && g.phase !== 'augment' && g.turn === ws.slot) resolveShot(r, g);
    } else if (r && m.type === 'move') {
      const g = r.game, now = Date.now();
      if (!g || g.phase === 'order' || g.winner !== -1 || g.busy || g.turn !== ws.slot || g.fuel <= 0 || now - (ws.lastMove || 0) < 30) return;
      ws.lastMove = now;
      const dir = m.dir > 0 ? 1 : m.dir < 0 ? -1 : 0, p = g.players[ws.slot];
      const nx = p.x + dir * STEP;
      if (!dir || nx < 40 || nx > W - 40) return;
      if (g.terrain[nx] < g.terrain[p.x] - MAX_CLIMB) return; // 한 걸음(STEP)에 오를 수 있는 최대 높이
      if (g.players.some((q, i) => i !== ws.slot && q.hp > 0 && Math.abs(q.x - nx) < 40)) return;
      p.x = nx; g.fuel -= STEP;
      toRoom(r, { type: 'moved', i: ws.slot, x: nx, y: g.terrain[nx], fuel: g.fuel });
    } else if (r && m.type === 'ofire') {   // 순서 정하기: 각자 동시에 조준을 확정해요 (모두 확정하거나 시간이 끝나면 한꺼번에 발사)
      const g = r.game;
      if (!g || g.phase !== 'order' || g.winner !== -1 || !g.players[ws.slot].on || g.players[ws.slot].hp <= 0 || g.oshots[ws.slot] || Date.now() < g.orderGoAt - 400) return;
      g.oshots[ws.slot] = { angle: Math.min(180, Math.max(0, +m.angle || 0)), power: Math.min(100, Math.max(10, +m.power || 10)) };
      toRoom(r, { type: 'ofired', i: ws.slot });
      if (allFired(g)) resolveOrder(r, g);
    } else if (r && m.type === 'aug') {   // 증강 선택
      const g = r.game;
      if (!g || g.phase !== 'augment' || !g.offers || g.picks[ws.slot] || !(g.offers[ws.slot] || []).includes(m.id)) return;
      g.picks[ws.slot] = m.id; toRoom(r, { type: 'augpicked', i: ws.slot });
      if (allPicked(g)) finishAugment(r, g);
    } else if (r && m.type === 'fire') {
      const g = r.game;
      if (!g || g.phase === 'order' || g.winner !== -1 || g.busy || g.turn !== ws.slot || g.players[ws.slot].hp <= 0) return;
      toRoom(r, fire(r, ws.slot,
        Math.min(180, Math.max(0, +m.angle || 0)),
        Math.min(100, Math.max(10, +m.power || 10))));
    }
  });

  ws.on('close', () => leave(ws));
});

server.listen(process.env.PORT || 3000, () => console.log('fortress server up'));
