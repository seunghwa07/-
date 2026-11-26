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
const G = 500 * K, CRATER = 60, HIT_R = 18 * TS, MAX = 4, RANDOM_MAP = FMAP.MAPS.length;
const SPAWN = [100, 366, 633, 900].map(x => Math.round(x * W / 1000));   // 월드 폭에 비례해서 흩어 놓아요
const ICONS = ['🪖', '🐸', '🚀', '🐱', '🤖', '🦖'];
const rooms = new Map();

// ---------- 탱크(포탄) 종류 ----------
// dmg: 직격 피해 (기본탄 17 → 정통으로 6발 맞으면 HP 100 파괴), rad: 폭발(크레이터) 크기
const KINDS = ['basic', 'incendiary', 'cluster', 'homing', 'heavy', 'pierce', 'laser', 'carpet', 'bumper', 'sniper', 'rail', 'gravity', 'electro', 'grinder', 'frost', 'vampire', 'water', 'explosive', 'intercept'];
const SHELL = {
  basic: { dmg: 17, rad: CRATER }, incendiary: { dmg: 10, rad: 40 }, cluster: { dmg: 5, rad: 22 }, homing: { dmg: 12, rad: 45 },
  carpet: { dmg: 20, rad: 40 },   // 융단 폭격: 미사일 1발 정통 20 / 스치면 13 (CARPET_GRAZE) 피해 (신호탄 자체는 피해 없음)
  bumper0: { dmg: 20, rad: 52 }, bumper1: { dmg: 12, rad: 42 }, bumper2: { dmg: 8, rad: 34 },   // 범퍼: 첫 탄 20 / 한 번 튄 탄 12 / 두 번 튄 가장 작은 탄 8
  pierce: { dmg: 14, rad: 30 }, laser: { dmg: 22, rad: 0 },   // 관통탄(기본탄보다 약함 · 맞은 탱크는 드릴로 2×3 추가 피해) / 레이저(직격만, 기본탄 17보다 센 22)
  sniper: { dmg: 50, rad: 16 },   // 스나이퍼: 작고 가벼운 탄 · 직격 50 = 체력 100의 절반 · 폭발은 아주 작아요
  heavy: { dmg: 68, rad: Math.round(CRATER * Math.sqrt(6)) },   // 광폭탄: 피해 4배(기본탄 17의 4배), 폭발 면적 6배(반지름 √6배)
  gravity: { dmg: 32, rad: 95 },   // 중력탄: 블랙홀에 끌려온 탱크가 받는 붕괴 폭발 피해 / 붕괴 크레이터 (아래 GRAV_* 와 같은 값)
  rail: { dmg: 0, rad: 0 },        // 레일건: 단계별 값은 RAIL_LV 에 있어요
  electro: { dmg: 3, rad: 0 },     // 일렉트로: 전깃줄에 닿은 탱크가 틱마다 받는 피해 (아래 ELEC_* 와 같은 값) · 땅은 안 파여요
  water: { dmg: 26, rad: CRATER },   // 물폭탄: 기본탄(17)보다 센 피해 26 + 착탄 주변에 물 범위가 생겨요 (아래 WATER_* 참고)
  vampire: { dmg: 17, rad: CRATER },   // 흡혈탄: 기본탄과 같은 피해·폭발 · 실제로 입힌 피해의 절반만큼 쏜 사람이 회복 (VAMP_RATE)
  frost: { dmg: 14, rad: 40 },      // 냉각탄: 약한 피해 + 착탄 주변 바닥이 얼어요 (아래 FROST_* 참고)
  explosive: { dmg: 34, rad: 70 },   // 고폭탄: 기본탄(17)의 2배 피해 + 조금 더 큰 폭발(반지름 70) · 대신 이동 불가 (fuelOf 참고) · 사거리는 SPEED 참고
  intercept: { dmg: 17, rad: CRATER },   // 요격탄: 탄은 기본탄과 완전히 같아요 · 대신 매 차례 요격 티켓이 설치돼요 (아래 ICPT_* 참고)
  grinder: { dmg: 10, rad: 0 },    // 그라인더: 톱니바퀴에 닿은 탱크가 받는 피해 (아래 GRIND_* 와 같은 값) · 땅은 안 파여요
};
const EXPL_SPEED = 1.35;   // 고폭탄 탄속 배율: 최대 사거리 ≈ 5800px 로 월드 폭(5000px)보다 길어서 맵 어디든 닿아요 (한 걸음 22.5px < 피격 반경 23.4px 라 탱크를 건너뛰지도 않아요) — 클라이언트(index.html)와 같아야 해요
const SPEED = { heavy: Math.sqrt(0.7), gravity: Math.sqrt(0.7), explosive: EXPL_SPEED };   // 광폭탄·중력탄 탄속: 사거리가 속도²에 비례하므로 사거리 70%
const SLOW_ANIM = { heavy: .6, gravity: .6, explosive: EXPL_SPEED };   // 고폭탄은 탄속이 빠른 만큼 화면에서도 빨리 날아가요 (비행 시간은 기본탄과 비슷)   // 화면에서 날아가는 속도 배율 (클라이언트와 같아야 해요)

// ----- 레일건: 충전(턴 소모) → 직선 관통 빔. 충전 단계(0~3)가 클수록 사거리·굵기(범위)·피해가 커져요. 쏘면 충전은 0으로 초기화 -----
const RAIL_MAX = 3;
const RAIL_LV = [   // 단계별: dmg 피해 / len 사거리(px) / wid 빔 반폭=피격 범위(px)
  { dmg: 15, len: 1500, wid: HIT_R * 1.0 },
  { dmg: 28, len: 2300, wid: HIT_R * 1.5 },
  { dmg: 45, len: 3200, wid: HIT_R * 2.1 },
  { dmg: 70, len: 4600, wid: HIT_R * 3.0 },
];
const RAIL_AIM_MIN = -45;       // 레일건은 수평보다 아래(-45°~225°)로도 조준할 수 있어요: 낮은 골짜기의 적도 곧은 빔으로 맞춰야 하니까요
const RAIL_CHARGE_MS = 1300;   // 충전 연출 시간 (이 뒤에 턴이 넘어가요)

// ----- 중력탄: 광폭탄과 같은 사거리. 떨어진 곳에 블랙홀이 생겨 범위 안의 탱크를 중심으로 끌어당긴 뒤 붕괴 폭발 -----
const GRAV_R = 280, GRAV_DMG = 32, GRAV_CRATER = 95, GRAV_GAP = 46;   // 끌어당기는 반경 / 폭파 피해 / 붕괴 크레이터 / 끌려온 탱크끼리 간격
const GRAV_FRAMES = 150;           // 블랙홀 연출 길이 (화면 프레임) — 클라이언트와 같아야 해요
const GRAV_MS = GRAV_FRAMES * 1000 / 60 + 200;
// ----- 일렉트로 · 그라인더: 땅에 닿으면 장판이 생겨 3초 동안 '앞으로(포탄이 날아오던 방향)' 나아가요 -----
// 일렉트로: 포탄이 상·하 반쪽으로 갈라지고 그 사이에 전깃줄이 생겨요. 줄에 닿은 탱크는 ELEC_TICK 마다 ELEC_DMG 피해
// 그라인더: 톱니바퀴가 땅을 타고 굴러가요. 닿은 탱크는 (탱크마다 한 번) GRIND_DMG 피해, 너무 가파른 벽을 만나면 그 자리에서 멈춰요
// 이동 경로와 피해는 발사 순간 서버가 한 번에 계산해서 보내요. (탱크는 움직이지 않고, 지형도 안 변하니까 결과가 같아요) 아래 값은 클라이언트(index.html)에도 필요한 것만 같이 보내요
const ZONE_STEP = 50;                                                    // 장판 위치를 기록하는 간격(ms)
const ELEC_MS = 3000, ELEC_SPEED = 280, ELEC_H = 240, ELEC_W = 55, ELEC_TICK = 200, ELEC_DMG = 3;   // 지속 / 이동 속도(px/s) / 전깃줄 길이(px) / 닿는 폭(px) / 피해 간격(ms) / 틱당 피해
const GRIND_MS = 3000, GRIND_SPEED = 220, GRIND_R = 34, GRIND_HIT = GRIND_R + 16, GRIND_DMG = 10, GRIND_CLIMB = 1.7;   // 지속 / 이동 속도 / 톱니바퀴 반지름 / 피격 거리 / 피해 / 오를 수 있는 최대 기울기(높이÷거리)
const DIRECT = HIT_R + 8;          // 이 거리 안이면 직격 → 전체 피해
const SNIPER_G = .3, SNIPER_HIT = HIT_R * .55, SNIPER_ANIM = 1.8;   // 스나이퍼탄: 중력 30% / 피격 범위 55%(작아서 맞추기 어려워요) / 화면에서 날아가는 속도 배율(빨라요)
const segDist = (px, py, x, y, cx, cy) => {   // 점 (cx,cy)와 선분 (px,py)-(x,y) 사이의 거리 (빠른 탄이 작은 판정을 건너뛰지 않게)
  const dx = x - px, dy = y - py, l2 = dx * dx + dy * dy, u = l2 ? Math.max(0, Math.min(1, ((cx - px) * dx + (cy - py) * dy) / l2)) : 0;
  return Math.hypot(px + dx * u - cx, py + dy * u - cy);
};
const PIERCE_HIT = HIT_R * 2;      // 관통탄 피격 범위: 기본 판정의 2배
const DRILL_TICK = 2, DRILL_N = 3, DRILL_MS = 850;   // 관통탄 드릴: 맞은 탱크를 2 피해씩 3번 더 갈아요 / 화면에서 갈리는 시간
const LASER_HIT = HIT_R * 1.9;     // 레이저 판정 범위: 기본 판정의 약 1.9배 (빔이 굵은 만큼 넓게)
const MAX_CLIMB = 90;              // 한 걸음(6px)당 최대 오르막 높이 → 약 86° 경사까지 (거의 수직 절벽만 막혀요)
const FIRE_R = 170, FIRE_MS = 3000, BURN_TICK = 500, BURN_DMG = 2;   // 소이탄: 불길 반경 / 3초 지속 / 0.5초마다 2 피해
const FROST_R = 150, FROST_TURNS = 3;   // 냉각탄: 얼음 바닥 반경(px) / 얼음이 남아 있는 차례 수 · 얼음 위에 있던 탱크는 자기 다음 차례에 이동 불가(발사는 가능)
const ICE_GAP = 70, ICE_FUEL = 2;   // 얼음 바닥 위: 이동 간격 70ms(기본 30~40ms 대비 절반 속도) / 한 걸음당 연료 2배
const onIce = (g, q) => (g.ice || []).some(f => Math.hypot(q.x - f.x, tankY(g, q) - f.y) < f.r);
// 물폭탄: 착탄 주변에 물 범위가 WATER_TURNS 차례 동안 남아요. 그 범위 안의 (적) 탱크가 쏘는 포탄은 WATER_DUD 확률로 불발(날아가다 사라짐)
const WATER_R = 240, WATER_TURNS = 3, WATER_DUD = .5;   // 물 범위 반경(px) / 남아 있는 차례 수 / 범위 안에서 쏜 포탄이 불발될 확률
const inWater = (g, i) => { const q = g.players[i]; return (g.water || []).some(z => !isAlly(g, z.by, i) && Math.hypot(q.x - z.x, tankY(g, q) - z.y) < z.r); };
// 요격탄: 자기 차례가 시작될 때마다 요격 티켓이 1장 설치돼요 (쌓이지 않아요). 티켓은 쓰일 때까지 유지돼요.
// 적이 쏜 포탄이 범위(ICPT_R) 안에 들어오면 그중 딱 한 발만 요격을 시도하고(티켓은 성공·실패와 관계없이 소모), 성공 확률은 ICPT_P 예요.
const ICPT_R = 380, ICPT_P = .5;   // (증강: 광역 레이더 icptR · 정밀 추적 icptP · 이중 티켓 tickets)
const icptCap = q => 1 + q.mods.tickets;   // 티켓 최대 보유 수   // 요격 범위 반경(px) / 요격 성공 확률 — 클라이언트(index.html)와 같아야 해요
function intercepts(g, shooter, shells) {   // 발사 직후 비행 경로가 나온 뒤 호출 · 요격된 포탄은 경로가 잘리고 착탄·피해가 사라져요
  const out = [];
  g.players.forEach((q, i) => {
    if (q.tank !== 'intercept' || !q.ticket || q.hp <= 0 || !q.on || i === shooter || isAlly(g, shooter, i)) return;
    const cx = q.x, cy = tankY(g, q), R = ICPT_R * q.mods.icptR, P = Math.min(1, ICPT_P + q.mods.icptP);
    while (q.ticket > 0) {   // 티켓 1장마다 탄 한 발 (이중 티켓이면 최대 2발)
      let best = null;   // 범위에 가장 먼저 들어온 포탄 한 발
      shells.forEach((s, si) => {
        if (s.icpt || s.dudShell || !s.path || s.path.length < 2 || (s.triedBy || []).includes(i)) return;
        const k = s.path.findIndex(pt => Math.hypot(pt[0] - cx, pt[1] - cy) < R);
        if (k >= 0 && (!best || k < best.k)) best = { s, si, k };
      });
      if (!best) break;
      q.ticket--;   // 티켓 소모 (성공·실패 무관)
      const ok = Math.random() < P, pt = best.s.path[best.k];
      (best.s.triedBy = best.s.triedBy || []).push(i);
      out.push({ by: i, si: best.si, idx: best.k, x: pt[0], y: pt[1], ok });
      if (ok) {   // 요격 성공: 그 지점에서 포탄이 터져 사라져요 (지형 파임·피해·장판 없음)
        best.s.path = best.s.path.slice(0, best.k + 1);
        best.s.impact = null; best.s.hit = null; best.s.hd = 0; best.s.icpt = true;
        if (best.s.splits) best.s.splits = best.s.splits.filter(q2 => q2 <= best.k);   // 범퍼탄: 잘려 나간 경로의 튕김 지점은 버려요
      }
    }
  });
  return out;
}
const VAMP_RATE = .5;                // 흡혈탄: 입힌 피해 대비 회복 비율
const CLUSTER_N = 8;               // 집속탄 한 번에 나가는 소탄 수
const ORDER_GO = 3600, ORDER_MS = 15000;   // 순서 정하기: 시작 연출(로딩+등장) 시간 / 조준·발사 제한시간
// 융단 폭격: 가벼운 신호탄(피해 없음)이 날아가 땅에서 조금 구른 뒤, 붉은 연기가 피어나고 위에서 미사일 3발이 수직으로 떨어져요. (시간 단위 = 화면 애니메이션 프레임)
const CARPET_GLOW = 70, CARPET_GAP = 16, CARPET_FALL = 34, CARPET_SPREAD = 110, CARPET_WIND = 1.6;   // 신호탄은 가벼워서 바람을 1.6배 더 타요
const CARPET_GRAZE = 13;           // 융단 폭격 미사일에 스쳐 맞았을 때 피해
const BUMPER_BOUNCES = 2, BUMPER_HIT = Math.min(HIT_R * 1.4, DIRECT - 1);   // 범퍼탄은 커진 만큼 탱크 피격 범위도 넓어요
const BUMPER_SPREAD = .2;          // 범퍼탄이 튀는 횟수 (튈 때마다 좌우로 2개씩 쪼개져요)
const DUD = 0.3, HOMING_TURN = 2.2; // 유도탄 불발 확률 / 초당 최대 회전각(rad)

const send = (ws, m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));   // 봇 슬롯은 ws 가 없어서 조용히 건너뛰어요
// FUEL, STEP 은 maps.js 에서 가져와요
const rndWind = () => Math.round(Math.random() * 20 - 10);
const count = r => r.slots.filter(Boolean).length;
const host = r => r.slots.findIndex(Boolean);
const toRoom = (r, m) => r.slots.forEach(s => s && send(s.ws, m));
const roomMsg = r => ({ type: 'room', code: r.code, host: host(r), mapId: r.mapId, mode: r.mode, solo: !!r.solo, bots: r.slots.map(s => (s && s.bot ? s.level : null)), teams: r.slots.map(s => s && s.team), tanks: r.slots.map(s => s && s.tank), names: r.slots.map(s => s && s.name), icons: r.slots.map(s => s && s.icon) });
const listMsg = () => ({
  type: 'rooms',
  rooms: [...rooms.values()].filter(r => !r.solo).map(r => ({
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
const fuelOf = (g, i) => g.players[i].tank === 'explosive' ? 0 : Math.round(FUEL * g.players[i].mods.fuel);   // 고폭탄 포대는 바퀴가 없어서 연료 0 = 이동 불가
const iceList = g => (g.ice || []).map(q => ({ id: q.id, x: q.x, y: q.y, r: q.r, left: q.left }));
const waterList = g => (g.water || []).map(q => ({ id: q.id, x: q.x, y: q.y, r: q.r, left: q.left, by: q.by }));
const turnMsg = g => ({ type: 'turn', turn: g.turn, wind: g.wind, fuel: g.fuel, fuelMax: fuelOf(g, g.turn), rings: g.rings, frozen: !!g.frozen, frz: g.players.map(p => p.frz || 0), tk: g.players.map(p => p.ticket || 0), ice: iceList(g), water: waterList(g) });

// ----- 튕김 링: 2~3개가 떠 있다가 2~5턴 뒤에 사라지고, 다른 자리에 새로 나타나요 -----
function tickRings(g, init) {
  if (!init) { g.rings.forEach(q => q.ttl--); g.rings = g.rings.filter(q => q.ttl > 0); }
  const target = 2 + Math.floor(Math.random() * 2), xs = g.players.filter(p => p.on && p.hp > 0).map(p => p.x);
  if (g.rings.length >= target) return;
  const add = FMAP.makeRings(g.terrain, xs, target - g.rings.length, g.rings);
  add.forEach(q => { q.id = ++g.ringSeq; q.ttl = 2 + Math.floor(Math.random() * 4); });
  g.rings = g.rings.concat(add);
}
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

// 시작 위치: 2명이면 맵 양 끝에 마주 보게, 3~4명이면 맵 전체에 같은 간격으로 흩어 놓아요 (한쪽 끝에 둘씩 몰려서 싸움이 짧아지지 않게).
// 개인전은 자리를 랜덤으로 섞고, 팀전은 팀이 번갈아 서도록(A B A B) 배치한 뒤 좌우를 랜덤으로 뒤집어요.
const EDGE = [300, 800, 1300];   // 맵 끝에서 안쪽으로 떨어진 거리 (EDGE[0] = 가장자리 여백)
function spawnXs(r) {
  const xs = [], ids = r.slots.map((s, i) => (s ? i : -1)).filter(i => i >= 0), n = ids.length;
  if (n <= 2) {
    const used = [0, 0];
    ids.forEach((i, k) => {
      const side = r.mode === 'team' ? r.slots[i].team : k % 2, c = used[side]++;
      xs[i] = side === 0 ? EDGE[c] : W - EDGE[c];
    });
    return xs;
  }
  const pos = Array.from({ length: n }, (_, k) => Math.round(EDGE[0] + k * (W - 2 * EDGE[0]) / (n - 1)));
  let seq;
  if (r.mode === 'team') {
    const a = ids.filter(i => r.slots[i].team === 0), b = ids.filter(i => r.slots[i].team === 1), [big, small] = a.length >= b.length ? [a, b] : [b, a];
    seq = [];
    while (big.length || small.length) { if (big.length) seq.push(big.shift()); if (small.length) seq.push(small.shift()); }   // 많은 팀부터 번갈아
  } else {
    seq = ids.slice();
    for (let k = seq.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [seq[k], seq[j]] = [seq[j], seq[k]]; }
  }
  if (Math.random() < .5) seq.reverse();
  seq.forEach((i, k) => { xs[i] = pos[k]; });
  return xs;
}

function newGame(r) {
  const xs = spawnXs(r);
  const map = r.mapId === RANDOM_MAP ? Math.floor(Math.random() * FMAP.MAPS.length) : r.mapId;
  r.game = {
    map, terrain: FMAP.terrain(map), wind: rndWind(), winner: -1, mode: r.mode, winTeam: -1, fires: [], ice: [], water: [], frozen: false, iceSeq: 0, waterSeq: 0,
    players: SPAWN.map((sx, i) => ({ x: xs[i] ?? sx, hp: r.slots[i] ? 100 : 0, maxHp: 100, charge: 0, mods: FAUG.calc([]), aug: [], lastHp: 100, lostFrac: 0, augTaken: 0, on: !!r.slots[i], team: r.slots[i] ? r.slots[i].team : 0, tank: r.slots[i] ? (r.slots[i].tank === 'random' ? KINDS[Math.floor(Math.random() * KINDS.length)] : r.slots[i].tank) : 'basic', name: r.slots[i] ? r.slots[i].name : '', icon: r.slots[i] ? r.slots[i].icon : '' })),
  };
  const g = r.game;
  g.players.forEach(q => { q.ticket = q.tank === 'intercept' ? 1 : 0; });   // 요격탄: 첫 차례부터 티켓이 설치돼 있어요
  g.rings = []; g.ringSeq = 0; tickRings(g, true);   // 튕김 링 (2~3개)
  g.turn = g.players.findIndex(p => p.on);
  g.fuel = fuelOf(g, g.turn);
  // 순서 정하기: 목표물 하나를 맵 가운데 쪽 랜덤 위치에 세우고, 모두 동시에 한 발씩 쏴서 가장 가까운 순서대로 차례를 정해요
  g.phase = 'order'; g.order = null; g.oshots = {};
  g.target = { x: Math.round(W * (.4 + Math.random() * .2)) };
  g.orderGoAt = Date.now() + ORDER_GO; g.orderEnd = g.orderGoAt + ORDER_MS;
  g.orderTimer = setTimeout(() => resolveOrder(r, g), ORDER_GO + ORDER_MS + 1500);   // 시간이 지나면 못 쏜 사람은 꼴찌 처리
  g.bt = new Set();   // AI(bot.js)가 예약한 타이머들
  BOT.order(r, g);    // 솔로 모드: AI 도 순서 정하기에서 한 발씩 쏴요
}

function snapshot(r) {
  const g = r.game;
  return {
    type: 'state', solo: !!r.solo, map: g.map, terrain: g.terrain, turn: g.turn, wind: g.wind, winner: g.winner, fuel: g.fuel, mode: g.mode, winTeam: g.winTeam, busy: !!g.busy, fuelMax: fuelOf(g, g.turn),
    phase: g.phase, target: g.target, rings: g.rings, order: g.order, ofired: g.players.map((_, i) => !!g.oshots[i]),
    orderGo: Math.max(0, g.orderGoAt - Date.now()), orderLeft: Math.max(0, g.orderEnd - Date.now()),
    teams: g.players.map(p => p.team),
    fires: fireList(g), ice: iceList(g), water: waterList(g), frozen: !!g.frozen,
    players: g.players.map(p => ({ team: p.team, tank: p.tank, x: p.x, y: g.terrain[p.x], hp: p.hp, maxHp: p.maxHp, aug: p.aug, on: p.on, name: p.name, icon: p.icon, charge: p.charge || 0, frz: p.frz || 0, ticket: p.ticket || 0, icr: Math.round(ICPT_R * p.mods.icptR) })),
  };
}

function checkEnd(r, animMs = 0) {   // animMs: 이번 포탄 화면 연출 길이 (끝난 뒤에도 5초 보여줘요)
  const g = r.game, a = alive(g);
  if (r.solo && !a.some(i => !isBot(r, i))) { /* 솔로: 내가 쓰러지면 AI 끼리 계속 싸우지 않고 바로 끝나요 */ }
  else if (g.mode === 'team') {   // 팀전: 살아있는 팀이 하나 이하면 종료
    const ts = new Set(a.map(i => g.players[i].team));
    if (ts.size > 1) return false;
    g.winTeam = ts.size ? [...ts][0] : -1;
  } else if (a.length > 1) return false;
  g.winner = a.length ? (r.solo ? a.slice().sort((x, y) => g.players[y].hp - g.players[x].hp)[0] : a[0]) : -2; // -2: 무승부 (솔로에서 내가 쓰러졌을 땐 체력이 가장 많은 AI 가 승자)
  clearTimeout(g.orderTimer); clearTimeout(g.augTimer); BOT.clearBots(g);
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
    target = foes.length > 1 ? (foes[pick] || foes[0]) : (foes[0] || null);   // pick: 몇 번째로 가까운 적을 노릴지 (듀얼의 두 번째 탄은 1)
  }
  for (let t = 0; t < 3600; t++) {
    if (target && t > 30) {
      const want = Math.atan2(tankY(g, target) - y, target.x - x), cur = Math.atan2(vy, vx), sp = Math.hypot(vx, vy);
      let d = want - cur;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const na = cur + Math.max(-HOMING_TURN * dt, Math.min(HOMING_TURN * dt, d));
      vx = sp * Math.cos(na) + g.wind * 1.5 * K * dt; vy = sp * Math.sin(na) + G * .3 * dt;
    } else { vx += g.wind * 3 * K * dt * (kind === 'carpet' ? CARPET_WIND : 1); vy += G * dt * (kind === 'sniper' ? SNIPER_G * p.mods.grav : 1); }   // 스나이퍼탄은 가벼워서 중력을 덜 받아요
    const px = x, py = y;
    x += vx * dt; y += vy * dt;
    const rb = FMAP.ringBounce(g.rings, px, py, x, y, vx, vy);   // 링에 닿으면 튕겨요 (어떤 탄이든)
    if (rb) { x = rb.x; y = rb.y; vx = rb.vx; vy = rb.vy; path.push([rb.cx, rb.cy]); }
    if (t % 4 === 0) path.push([x, y]);
    if (x < 0 || x >= W || y > H) { out = true; break; }
    if (kind !== 'pierce' && (y >= g.terrain[Math.floor(x)] || (kind === 'sniper' && (py + y) / 2 >= g.terrain[Math.floor((px + x) / 2)]))) { impact = [x, y]; break; }   // 관통탄은 땅을 그냥 통과해요 (스나이퍼탄은 빨라서 걸음 중간도 검사)
    if (!free && g.players.some((q, i) => q.hp > 0 && (i !== shooter || t > 40) && !isAlly(g, shooter, i) &&
        (kind === 'sniper' ? segDist(px, py, x, y, q.x, tankY(g, q)) < SNIPER_HIT * p.mods.hitr : Math.hypot(x - q.x, y - tankY(g, q)) < (kind === 'pierce' ? PIERCE_HIT : HIT_R)))) { impact = [x, y]; break; }
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
      vx += g.wind * 3 * K * dt; vy += G * dt; const px = x, py = y; x += vx * dt; y += vy * dt;
      const rb = FMAP.ringBounce(g.rings, px, py, x, y, vx, vy);   // 링에 닿으면 튕겨요
      if (rb) { x = rb.x; y = rb.y; vx = rb.vx; vy = rb.vy; path.push([rb.cx, rb.cy]); }
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
      if (bounces >= maxB) break;                                                // 반사 횟수를 다 쓰면 소멸 (증강 반영)
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
      if (bounces >= maxB) break;                                                // 반사 횟수를 다 쓰면 소멸 (증강 반영)
      bounces++;
      const xi = Math.floor(nx), xl = Math.max(0, xi - 6), xr = Math.min(W - 1, xi + 6);
      const sl = (g.terrain[xr] - g.terrain[xl]) / ((xr - xl) || 1), nl = Math.hypot(sl, 1), nX = sl / nl, nY = -1 / nl;   // 지형 표면의 바깥쪽 법선
      const dot = dx * nX + dy * nY;
      if (dot < 0) { dx -= 2 * dot * nX; dy -= 2 * dot * nY; }
      else { bounces--; x = nx; y = ny; len += STEP; rec += STEP; }   // 이미 벽에서 멀어지는 중(스치기/파묻힘): 튕김으로 세지 않고 그냥 빠져나가요
      continue;
    }
    const rb = FMAP.ringBounce(g.rings, x, y, nx, ny, dx, dy);                   // 링에 닿으면 반사 (반사 횟수에는 안 세요)
    if (rb) { path.push([rb.cx, rb.cy]); const L = Math.hypot(rb.vx, rb.vy) || 1; dx = rb.vx / L; dy = rb.vy / L; x = rb.x; y = rb.y; len += STEP; rec = 0; continue; }
    x = nx; y = ny; len += STEP; rec += STEP;
    if (rec >= 50) { path.push([x, y]); rec = 0; }
  }
  const last = path[path.length - 1];
  if (last[0] !== x || last[1] !== y) path.push([x, y]);
  return { path, impact, hit, fizzled: false, bounces };
}

// 착탄: 땅 파임 + 피해(팀전에서는 아군 제외) + 소이탄이면 불길 생성 (delay: 클라이언트 화면에서 폭발이 보일 때까지의 시간)
function explode(g, shooter, impact, kind, delay = 0, mul = 1) {   // mul: 이 포탄의 피해 배율 (듀얼 0.7)
  const { dmg } = SHELL[kind], rad = SHELL[kind].rad * g.players[shooter].mods.rad, direct = kind === 'pierce' ? PIERCE_HIT + 8 : kind === 'sniper' ? SNIPER_HIT * g.players[shooter].mods.hitr + 8 : DIRECT, reach = kind === 'pierce' ? Math.max(rad + 25, direct + 20) : kind === 'sniper' ? direct + 16 : rad + 25;
  crater(g, impact[0], impact[1], rad);
  let drained = 0;   // 흡혈탄: 다른 탱크에게 실제로 깎은 체력 합계
  g.players.forEach((q, i) => {
    if (q.hp <= 0 || isAlly(g, shooter, i)) return;
    const d = Math.hypot(q.x - impact[0], tankY(g, q) - impact[1]), before = q.hp;
    q.hp = Math.max(0, q.hp - scaleDmg(g, shooter, i, kind === 'carpet' ? (d <= direct ? dmg : d < Math.max(reach, direct + 20) ? CARPET_GRAZE : 0) : dmgAt(dmg, d, reach, direct), kind, mul));   // 융단 폭격: 정통 20 / 스치면 일정하게 13
    if (i !== shooter) drained += before - q.hp;
  });
  if (kind === 'vampire') { const sp = g.players[shooter]; if (sp.hp > 0 && drained > 0) sp.hp = Math.min(sp.maxHp, sp.hp + Math.round(drained * (VAMP_RATE + sp.mods.drain))); }   // 입힌 피해의 절반을 회복 (최대 체력까지)
  if (kind === 'frost') {   // 냉각탄: 착탄 주변 바닥이 얼고, 그 위에 있는 (적) 탱크는 자기 다음 차례에 이동할 수 없어요
    const fx = Math.max(0, Math.min(W - 1, Math.round(impact[0]))), fy = g.terrain[fx], fr = Math.round(FROST_R * g.players[shooter].mods.area);
    g.ice.push({ id: ++g.iceSeq, x: fx, y: fy, r: fr, left: FROST_TURNS + g.players[shooter].mods.turns + 1 });   // +1: 쏜 직후 차례가 넘어갈 때 하나 줄어요
    g.players.forEach((q, i) => { if (q.hp > 0 && !isAlly(g, shooter, i) && Math.hypot(q.x - fx, tankY(g, q) - fy) < fr) q.frz = 1; });
  }
  if (kind === 'water') {   // 물폭탄: 착탄 주변에 물 범위 생성 (그 안의 적 탱크가 쏘는 포탄은 50% 불발)
    const wx = Math.max(0, Math.min(W - 1, Math.round(impact[0]))), wy = g.terrain[wx], wr = Math.round(WATER_R * g.players[shooter].mods.area);
    g.water.push({ id: ++g.waterSeq, x: wx, y: wy, r: wr, left: WATER_TURNS + g.players[shooter].mods.turns + 1, by: shooter });   // +1: 쏜 직후 차례가 넘어갈 때 하나 줄어요
  }
  if (kind === 'incendiary') {
    const fx = Math.max(0, Math.min(W - 1, Math.round(impact[0]))), t0 = Date.now() + delay;
    g.fires.push({ x: fx, y: g.terrain[fx], r: Math.round(FIRE_R * g.players[shooter].mods.area), by: shooter, startAt: t0, endsAt: t0 + Math.round(FIRE_MS * g.players[shooter].mods.fireMs), next: t0 + BURN_TICK });
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
    toRoom(r, snapshot(r)); BOT.turn(r, g);
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
  if (startMid(r, g)) return;   // 체력바 한 칸이 깎인 플레이어가 있으면 증강을 먼저 고르고, 끝나면 다음 차례를 알려요
  toRoom(r, turnMsg(g)); BOT.turn(r, g);   // 다음이 AI 차례면 생각을 시작해요
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
const allPicked = g => (g.pickers || []).every(i => !g.players[i].on || g.players[i].hp <= 0 || g.picks[i]);
// who: 증강을 고를 사람들(없으면 살아있는 모두) / why: 'start' = 게임 시작 때, 'hit' = 체력바 한 칸이 깎여서 받는 보상
function startAugment(r, g, who, why = 'start') {
  if (r.game !== g || g.winner !== -1) return;
  const ps = who || g.players.map((p, i) => (p.on && p.hp > 0 ? i : -1)).filter(i => i >= 0);
  g.phase = 'augment'; g.busy = true; g.picks = {}; g.augWhy = why;
  g.offers = g.players.map((p, i) => (ps.includes(i) ? FAUG.offer(p.tank, p.aug) : []));
  g.pickers = ps.filter(i => g.offers[i].length);
  if (!g.pickers.length) return finishAugment(r, g);
  g.augTimer = setTimeout(() => finishAugment(r, g), FAUG.PICK_MS + 800);   // 시간이 지나면 못 고른 사람은 랜덤
  r.slots.forEach((sl, i) => sl && send(sl.ws, { type: 'augment', offers: g.offers[i], left: FAUG.PICK_MS, why, n: g.pickers.length, who: g.pickers }));
  BOT.augment(r, g);   // AI 는 알아서 골라요
}
// 체력바 한 칸(최대 체력의 25%)이 깎일 때마다 그 플레이어에게 증강 선택권이 생겨요 (한 번에 여러 번 깎였으면 차례로 여러 번)
const HP_SEGS = 4;   // 체력바 칸 수 (클라이언트 drawTag 의 seg 와 같아야 해요)
const owed = p => Math.floor(p.lostFrac * HP_SEGS + 1e-6) - p.augTaken;
function startMid(r, g) {
  if (r.game !== g || g.winner !== -1) return false;
  g.players.forEach(p => { const d = p.lastHp - p.hp; if (d > 0) p.lostFrac += d / p.maxHp; p.lastHp = p.hp; });
  const ps = [];
  g.players.forEach((p, i) => {
    if (!p.on || p.hp <= 0 || owed(p) <= 0) return;
    if (FAUG.offer(p.tank, p.aug).length) ps.push(i); else p.augTaken += owed(p);   // 더 고를 증강이 없으면 넘어가요
  });
  if (!ps.length) return false;
  startAugment(r, g, ps, 'hit');
  return true;
}
function finishAugment(r, g) {
  if (r.game !== g || g.phase !== 'augment') return;
  clearTimeout(g.augTimer);
  const mid = g.augWhy === 'hit';
  (g.pickers || []).forEach(i => {
    const p = g.players[i];
    if (!p.on || p.hp <= 0) return;
    const id = g.picks[i] || g.offers[i][Math.floor(Math.random() * g.offers[i].length)];
    if (!id) return;
    g.picks[i] = id; p.aug.push(id);
    const before = p.mods.hp; p.mods = FAUG.calc(p.aug);
    if (p.tank === 'rail') p.charge = Math.max(p.charge || 0, p.mods.charge0);   // 예열 코일: 바로 충전 1단계
    if (p.tank === 'intercept') p.ticket = Math.max(p.ticket || 0, icptCap(p));   // 이중 티켓: 티켓이 바로 2장
    p.maxHp = 100 + p.mods.hp; p.hp = Math.max(1, p.hp + p.mods.hp - before);   // 체력 증강은 현재 체력도 같이 올려요
    const heal = (FAUG.byId[id].mods || {}).heal || 0;
    if (heal) p.hp = Math.min(p.maxHp, p.hp + heal);                            // 응급 수리: 즉시 회복
    if (mid) p.augTaken++;
    p.lastHp = p.hp;                                                           // 증강으로 바뀐 체력은 '피해'로 세지 않아요
  });
  g.phase = 'play'; endBusy(g);
  if (mid && (!g.players[g.turn].on || g.players[g.turn].hp <= 0)) advance(r, g.turn);   // 고르는 동안 차례인 사람이 나갔다면 넘겨요
  g.fuel = fuelOf(g, g.turn);
  toRoom(r, { type: 'augdone', picks: g.picks });
  toRoom(r, snapshot(r));
  if (mid && startMid(r, g)) return;   // 아직 못 받은 선택권이 남았으면 이어서 한 번 더
  toRoom(r, turnMsg(g)); BOT.turn(r, g);
}

const tp_isIcpt = (g, i) => g.players[i] && g.players[i].tank === 'intercept' && g.players[i].hp > 0;
function advance(r, from) {   // 다음 차례로 넘겨요
  const g = r.game;
  g.turn = nextTurn(g, from); g.wind = rndWind(); g.fuel = fuelOf(g, g.turn);
  g.frozen = false; const tp = g.players[g.turn];
  if (tp_isIcpt(g, g.turn)) g.players[g.turn].ticket = icptCap(g.players[g.turn]);   // 요격탄: 차례마다 요격 티켓 설치 (이미 있으면 그대로 1장)
  if (tp.frz > 0) { tp.frz--; g.frozen = true; g.fuel = 0; }   // 얼어붙은 탱크: 이번 차례는 이동 불가 (연료 0)
  g.ice = (g.ice || []).map(q => ({ ...q, left: q.left - 1 })).filter(q => q.left > 0);   // 얼음 바닥은 몇 차례 뒤에 녹아요
  g.water = (g.water || []).map(q => ({ ...q, left: q.left - 1 })).filter(q => q.left > 0);   // 물 범위도 몇 차례 뒤에 마르고 사라져요
  tickRings(g);   // 차례가 넘어갈 때마다 링이 사라지고 새로 나타나요
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
      const x = Math.max(2, Math.min(W - 3, Math.round(rest[0] + k * CARPET_SPREAD * g.players[shooter].mods.spread))), y0 = Math.max(-300, g.terrain[x] - 1100);
      let y1 = g.terrain[x], hit = false;
      for (let y = y0; y < g.terrain[x]; y += 5) {
        if (g.players.some((q, i) => q.hp > 0 && !isAlly(g, shooter, i) && Math.hypot(x - q.x, y - tankY(g, q)) < HIT_R)) { y1 = y; hit = true; break; }
      }
      const off = Math.round(Math.abs(k)), cmul = nm > 3 ? [1, .75, .5][off] || .5 : 1;   // 증강으로 5발이면 중앙 100% / 양옆 75%(15) / 맨끝 50%(10)
      explode(g, shooter, [x, y1], 'carpet', 0, cmul);   // 앞 미사일이 판 땅과 입은 피해가 다음 미사일에 바로 반영돼요
      missiles.push({ x, y0, y1, hit });
    }
  }
  const total = path.length + (missiles.length ? CARPET_GLOW + CARPET_GAP * (missiles.length - 1) + CARPET_FALL : 20);
  if (!checkEnd(r, SHOT_MS(total))) { g.busy = true; g.busyTimer = setTimeout(() => resolveShot(r, g), SHOT_MS(total) + 2000); }
  return { type: 'shot', by: shooter, angle, kind: 'carpet', dud: false, shells: [],
    carpet: { path, landIdx, missiles, glow: CARPET_GLOW, gap: CARPET_GAP, fall: CARPET_FALL, total }, state: snapshot(r) };
}

// 레일건 발사: 포물선 없이 직선. 벽(지형)을 관통하고, 빔 위의 모든 적에게 피해를 줘요. 충전 단계가 클수록 사거리·굵기·피해가 커지고, 쏘면 충전은 0으로 돌아가요.
const RAIL_STEP = 80;   // 화면 연출용 경로 점 간격(px)
function fireRail(r, shooter, angle) {
  const g = r.game, p = g.players[shooter], lv = Math.max(0, Math.min(RAIL_MAX, p.charge || 0)), L = RAIL_LV[lv], wid = L.wid * p.mods.beam;   // 증강: 자기 집속(빔 굵기)
  const a = angle * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a), x0 = p.x, y0 = g.terrain[p.x] - 20 * TS;
  let len = L.len;   // 맵 경계(좌·우·위)에서 끝나요
  if (dx > 1e-6) len = Math.min(len, (W - 1 - x0) / dx); else if (dx < -1e-6) len = Math.min(len, -x0 / dx);
  if (dy < -1e-6) len = Math.min(len, -y0 / dy); else if (dy > 1e-6) len = Math.min(len, (H - 1 - y0) / dy);   // 아래로 쏘면 맵 바닥에서 끝나요
  len = Math.max(20, len);
  const n = Math.max(2, Math.ceil(len / RAIL_STEP) + 1), step = len / (n - 1);
  const path = Array.from({ length: n }, (_, k) => [x0 + dx * step * k, y0 + dy * step * k]);
  const hits = [];
  g.players.forEach((q, i) => {
    if (i === shooter || q.hp <= 0 || isAlly(g, shooter, i)) return;
    const qy = tankY(g, q), t = Math.max(0, Math.min(len, (q.x - x0) * dx + (qy - y0) * dy));
    if (Math.hypot(x0 + dx * t - q.x, y0 + dy * t - qy) >= wid) return;   // 빔 반폭 안에 들어온 탱크만
    const hp0 = q.hp;
    q.hp = Math.max(0, q.hp - scaleDmg(g, shooter, i, L.dmg, 'rail'));
    hits.push({ i, idx: t / step, x: q.x, y: Math.round(qy), d: hp0 - q.hp });
  });
  p.charge = p.mods.charge0;   // 쏘면 충전 초기화 (예열 코일이면 1단계에서 시작)
  const ms = n * 1000 / 60 / FMAP.SHOT_SPEED + 800 + 2000;
  if (!checkEnd(r, ms - 2000)) { g.busy = true; g.busyTimer = setTimeout(() => resolveShot(r, g), ms); }
  return { type: 'shot', by: shooter, angle, kind: 'rail', dud: false, shells: [{ path, impact: null }], rail: { lv, wid: Math.round(wid), hits }, state: snapshot(r) };
}

// 중력탄: 떨어진 자리(cx, cy)에 블랙홀 → 반경 안의 탱크는 중심으로 끌려오고(서로 간격을 두고 늘어서요), 붕괴 폭발 피해를 받아요. 팀전에서 아군은 끌려오기만 하고 피해는 없어요.
function gravityWell(g, shooter, impact) {
  const mods = g.players[shooter].mods, R = GRAV_R * mods.rad;
  const cx = Math.max(40, Math.min(W - 40, Math.round(impact[0]))), cy = impact[1];
  const pulled = g.players.map((_, i) => i)
    .filter(i => { const q = g.players[i]; return q.hp > 0 && Math.hypot(q.x - cx, tankY(g, q) - cy) <= R; })
    .sort((a, b) => g.players[a].x - g.players[b].x), moves = [];
  pulled.forEach((i, j) => {
    const q = g.players[i], x0 = q.x, x1 = Math.max(40, Math.min(W - 40, Math.round(cx + (j - (pulled.length - 1) / 2) * GRAV_GAP)));
    q.x = x1; moves.push({ i, x0, x1 });
  });
  crater(g, cx, cy, GRAV_CRATER * mods.rad);
  pulled.forEach(i => { if (!isAlly(g, shooter, i)) g.players[i].hp = Math.max(0, g.players[i].hp - scaleDmg(g, shooter, i, GRAV_DMG, 'gravity')); });
  return { cx, cy: Math.round(cy), r: Math.round(R), moves, frames: GRAV_FRAMES };
}

// 일렉트로 · 그라인더 장판의 3초 이동과 피해를 미리 계산해요. 증강(fireMs)으로 지속 시간이 늘어나요.
function zoneRun(g, shooter, impact, vx, kind) {
  const el = kind === 'electro', ms = Math.round((el ? ELEC_MS : GRIND_MS) * g.players[shooter].mods.fireMs), n = Math.max(1, Math.floor(ms / ZONE_STEP));
  const dir = vx >= 0 ? 1 : -1, sp = (el ? ELEC_SPEED : GRIND_SPEED) * ZONE_STEP / 1000;
  const ty = x => g.terrain[Math.max(0, Math.min(W - 1, Math.round(x)))];
  let x = Math.max(20, Math.min(W - 20, impact[0]));
  const path = [], hits = [], next = g.players.map(() => 0);
  for (let k = 0; k <= n; k++) {
    const t = k * ZONE_STEP;
    let y = ty(x);
    if (!el) y -= 2;   // 톱날은 중심이 땅 높이에 오도록 반쯤 박혀서 굴러가요
    path.push([Math.round(x), Math.round(y)]);
    g.players.forEach((q, i) => {
      if (q.hp <= 0 || isAlly(g, shooter, i) || t < next[i]) return;
      const qy = tankY(g, q);
      if (!(el ? segDist(x, y - ELEC_H, x, y, q.x, qy) < ELEC_W : Math.hypot(x - q.x, y - qy) < GRIND_HIT)) return;
      const hp0 = q.hp;
      q.hp = Math.max(0, q.hp - scaleDmg(g, shooter, i, el ? ELEC_DMG : GRIND_DMG, kind));
      next[i] = el ? t + ELEC_TICK : Infinity;   // 전기는 계속 지지고, 톱날은 탱크마다 한 번만 갈아요
      hits.push({ i, t, x: q.x, y: Math.round(qy), d: hp0 - q.hp });
    });
    if (k < n) {
      const nx = x + dir * sp;
      if (nx < 20 || nx > W - 20) continue;                                      // 맵 끝에서 멈춰요
      if (!el && ty(x) - ty(nx) > GRIND_CLIMB * Math.abs(nx - x)) continue;      // 톱니바퀴는 너무 가파른 벽을 못 올라가요
      x = nx;
    }
  }
  const lastOf = {}; hits.forEach((h, j) => { lastOf[h.i] = j; }); hits.forEach((h, j) => { h.last = lastOf[h.i] === j; });   // 탱크별 마지막 타격 (쓰러지는 연출용)
  return { kind, dir, ms: n * ZONE_STEP, step: ZONE_STEP, h: ELEC_H, r: GRIND_R, path, hits };
}

function fire(r, shooter, angle, power) {
  const g = r.game, kind = g.players[shooter].tank;
  const wet = inWater(g, shooter) && Math.random() < WATER_DUD;   // 물 범위 안에서 쏘면 어떤 탱크든 50% 확률로 불발
  if (!wet && kind === 'carpet') return fireCarpet(r, shooter, angle, power);
  if (!wet && kind === 'rail') return fireRail(r, shooter, angle);
  let shells, dud = false, grav = null, zone = null;
  if (wet) {   // 불발: 날아가다 떨어져 사라져요 (피해·폭발·장판 없음)
    const s = flight(g, shooter, angle, power, 'basic');
    s.path = s.path.slice(0, Math.max(3, Math.floor(s.path.length * (.35 + Math.random() * .4)))); s.impact = null; s.hit = null; s.hd = 0; s.dudShell = true;
    shells = [s]; dud = true;
    if (kind === 'rail') g.players[shooter].charge = g.players[shooter].mods.charge0;   // 레일건은 충전만 날아가요
  } else if (kind === 'cluster') {
    shells = Array.from({ length: Math.round(CLUSTER_N * g.players[shooter].mods.shells) }, () =>
      flight(g, shooter, Math.min(180, Math.max(0, angle + (Math.random() - .5) * 14)), Math.min(100, power * (.9 + Math.random() * .2)), kind));
  } else if (kind === 'homing') {   // 유도탄: 듀얼 증강이면 2발(각 피해 70%) · 발마다 따로 30% 불발
    const n = g.players[shooter].mods.dual ? 2 : 1;
    shells = Array.from({ length: n }, (_, k) => {
      const ang = n > 1 ? Math.min(180, Math.max(0, angle + (k ? -3 : 3))) : angle;   // 두 발이 살짝 벌어져 나가요
      let s;
      if (Math.random() < DUD * g.players[shooter].mods.dud) {   // 불발: 날아가다 떨어져 사라져요
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

  if (shells.length === 1 && shells[0].fizzled) dud = true;
  const icpt = wet ? [] : intercepts(g, shooter, shells);   // 요격탄 탱크의 티켓이 있으면 범위 안 포탄 한 발을 50%로 요격   // 맴돌다 사라진 포탄도 불발로 처리
  // 클라이언트 애니메이션(약 60프레임/초)이 끝나 폭발이 보일 때쯤 불길이 시작되도록 맞춰요
  shells.forEach(s => { if (kind === 'pierce') { if (s.impact) drill(g, shooter, s, Math.round(s.path.length * 1000 / 60 / FMAP.SHOT_SPEED) + 300, s.mul || 1); } else if (kind === 'laser') { if (s.hit != null) g.players[s.hit].hp = Math.max(0, g.players[s.hit].hp - scaleDmg(g, shooter, s.hit, SHELL.laser.dmg, 'laser')); } else if (kind === 'gravity') { if (s.impact && !grav) grav = gravityWell(g, shooter, s.impact); } else if (kind === 'electro' || kind === 'grinder') { if (s.impact && !zone) zone = zoneRun(g, shooter, s.impact, s.vx, kind); } else if (s.impact) explode(g, shooter, s.impact, kind === 'bumper' ? 'bumper' + s.gen : kind, Math.round(s.path.length * 1000 / 60 / ((SLOW_ANIM[kind] || 1) * FMAP.SHOT_SPEED)) + 300, s.mul || 1); });
  if (g.fires.length) startBurn(r);

  const ms = Math.max(...shells.map(s => s.path.length)) * 1000 / 60 / ((SLOW_ANIM[kind] || (kind === 'sniper' ? SNIPER_ANIM : 1)) * FMAP.SHOT_SPEED) + 2000 + (kind === 'pierce' ? DRILL_MS : 0) + (grav ? GRAV_MS : 0) + (zone ? zone.ms + 300 : 0);
  if (!checkEnd(r, ms - 2000)) {   // 턴은 바로 넘기지 않고, 포탄이 끝날 때까지 기다려요
    g.busy = true;
    g.busyTimer = setTimeout(() => resolveShot(r, g), ms);
  }
  return { type: 'shot', by: shooter, angle, kind, dud, wet, grav, zone, icpt, beam: kind === 'laser' ? g.players[shooter].mods.beam : 1, shells: shells.map(s => ({ path: s.path, impact: s.impact, gen: s.gen, splits: s.splits, hit: s.hit, hd: s.hd, small: !!s.small, jumbo: !!s.jumbo, icpt: !!s.icpt })), state: snapshot(r) };
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
  if (!humans(r)) { destroyRoom(r); }   // 사람이 한 명도 없으면 (AI 만 남은 솔로 방 포함) 방을 닫아요
  else if (g) {
    if (g.players[i].on && g.winner === -1) {
      g.players[i].hp = 0;
      if (!checkEnd(r)) {
        if (g.phase === 'order') { if (allFired(g)) { toRoom(r, snapshot(r)); resolveOrder(r, g); pushList(); return; } }
        else if (g.phase === 'augment') { if (allPicked(g)) finishAugment(r, g); }
        else if (g.turn === i) { endBusy(g); advance(r, i); }
      }
    }
    toRoom(r, snapshot(r)); BOT.turn(r, g);
  } else toRoom(r, roomMsg(r));
  pushList();
}


// ===== 사람과 AI 가 똑같이 쓰는 행동 함수 (규칙 검사는 모두 여기서 해요) =====
const humans = r => r.slots.filter(s => s && !s.bot).length;
const isBot = (r, i) => !!(r.slots[i] && r.slots[i].bot);

function destroyRoom(r) {   // 방을 닫고 남은 타이머를 모두 정리해요
  r.dead = true; clearInterval(r.hb);
  const g = r.game;
  if (g) { clearTimeout(g.orderTimer); clearTimeout(g.augTimer); clearTimeout(g.busyTimer); clearInterval(g.burnTimer); BOT.clearBots(g); }
  rooms.delete(r.code);
}

function doMove(r, i, dir) {   // 한 걸음 이동 (성공하면 true)
  const g = r.game;
  if (!g || g.phase === 'order' || g.winner !== -1 || g.busy || g.turn !== i || g.fuel <= 0 || !dir) return false;
  const p = g.players[i], icy = onIce(g, p), nx = p.x + dir * STEP;
  if (nx < 40 || nx > W - 40) return false;
  if (g.terrain[nx] < g.terrain[p.x] - MAX_CLIMB) return false;   // 한 걸음(STEP)에 오를 수 있는 최대 높이
  if (g.players.some((q, k) => k !== i && q.hp > 0 && Math.abs(q.x - nx) < 40)) return false;
  p.x = nx; g.fuel = Math.max(0, g.fuel - STEP * (icy ? ICE_FUEL : 1));
  toRoom(r, { type: 'moved', i, x: nx, y: g.terrain[nx], fuel: g.fuel });
  return true;
}
function doCharge(r, i) {   // 레일건 충전: 이번 턴이 끝나요
  const g = r.game, p = g && g.players[i];
  if (!g || g.phase === 'order' || g.winner !== -1 || g.busy || g.turn !== i || p.hp <= 0 || p.tank !== 'rail' || (p.charge || 0) >= RAIL_MAX) return false;
  p.charge = (p.charge || 0) + 1;
  g.busy = true; g.busyTimer = setTimeout(() => resolveShot(r, g), RAIL_CHARGE_MS);   // 포탄이 없으니 서버 타이머로 차례를 넘겨요
  toRoom(r, { type: 'charged', by: i, charge: p.charge });
  toRoom(r, snapshot(r));
  return true;
}
function doFire(r, i, angle, power) {
  const g = r.game;
  if (!g || g.phase === 'order' || g.winner !== -1 || g.busy || g.turn !== i || g.players[i].hp <= 0) return false;
  if (g.players[i].tank === 'rail' && (g.players[i].charge || 0) < 1) return false;   // 레일건은 최소 1번 충전해야 발사할 수 있어요
  const railAim = g.players[i].tank === 'rail';   // 레일건만 수평 아래로도 조준 가능
  toRoom(r, fire(r, i,
    Math.min(railAim ? 180 - RAIL_AIM_MIN : 180, Math.max(railAim ? RAIL_AIM_MIN : 0, +angle || 0)),
    Math.min(100, Math.max(10, +power || 10))));
  return true;
}
function orderFire(r, i, angle, power) {   // 순서 정하기 조준 확정
  const g = r.game;
  if (!g || g.phase !== 'order' || g.winner !== -1 || !g.players[i].on || g.players[i].hp <= 0 || g.oshots[i] || Date.now() < g.orderGoAt - 400) return false;
  g.oshots[i] = { angle: Math.min(180, Math.max(0, +angle || 0)), power: Math.min(100, Math.max(10, +power || 10)) };
  toRoom(r, { type: 'ofired', i });
  if (allFired(g)) resolveOrder(r, g);
  return true;
}
function pickAug(r, i, id) {   // 증강 선택
  const g = r.game;
  if (!g || g.phase !== 'augment' || !g.offers || g.picks[i] || !(g.offers[i] || []).includes(id)) return false;
  g.picks[i] = id; toRoom(r, { type: 'augpicked', i });
  if (allPicked(g)) finishAugment(r, g);
  return true;
}

// ===== 솔로 모드 AI: bot.js (쉬움 · 보통 · 어려움) =====
const BOT = require('./bot.js')({ FMAP, FAUG, SHELL, flight, laserFlight, bumperFlight, zoneRun, dmgAt, tankY, isAlly, onIce, RAIL_LV, RAIL_MAX, RAIL_AIM_MIN,
  W, STEP, MAX_CLIMB, HIT_R, DIRECT, GRAV_R, GRAV_DMG, SNIPER_HIT, PIERCE_HIT, FIRE_R, FROST_R, WATER_R, CARPET_SPREAD, CARPET_GRAZE, ICE_FUEL, ICE_GAP,
  doMove, doCharge, doFire, orderFire, pickAug, isBot });
const LEVELS = BOT.LEVELS;
const botName = (slot, level) => `AI${slot + 1} ${LEVELS[level].label}`;   // 이름은 최대 8자
function addBot(r, level) {   // 빈 자리에 AI 를 앉혀요 (난이도를 모르면 보통)
  const i = r.slots.indexOf(null); if (i < 0) return;
  const lv = LEVELS[level] ? level : 'normal', used = r.slots.filter(Boolean).map(s => s.icon), pool = ICONS.filter(c => !used.includes(c));
  const t0 = r.slots.filter(s => s && s.team === 0).length, t1 = r.slots.filter(s => s && s.team === 1).length;
  r.slots[i] = { ws: null, bot: true, level: lv, name: botName(i, lv), icon: (pool.length ? pool : ICONS)[Math.floor(Math.random() * (pool.length || ICONS.length))], team: t0 <= t1 ? 0 : 1, tank: 'random' };
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
    } else if (m.type === 'solo' && !r) {   // 솔로 모드: 나 + AI 1~3명 (개인전)
      const code = newCode();
      const nr = { code, slots: Array(MAX).fill(null), mapId: 0, mode: 'ffa', game: null, solo: true };
      rooms.set(code, nr);
      nr.hb = setInterval(() => { if (nr.game) BOT.turn(nr, nr.game); }, 800);   // 안전장치: 훅을 놓쳐도 AI 차례가 멈추지 않게
      ws.room = nr;
      join(ws, nr, name, icon);
      const n = Math.max(1, Math.min(MAX - 1, (+m.bots | 0) || 1));
      for (let k = 0; k < n; k++) addBot(nr, m.level);
      toRoom(nr, roomMsg(nr));
    } else if (m.type === 'join' && !r) {
      const t = rooms.get(String(m.code || '').toUpperCase());
      if (!t) return send(ws, { type: 'error', msg: '방을 찾을 수 없어요' });
      if (t.solo) return send(ws, { type: 'error', msg: '솔로 방에는 참가할 수 없어요' });
      if (t.game) return send(ws, { type: 'error', msg: '이미 게임이 진행 중이에요' });
      if (!t.slots.includes(null)) return send(ws, { type: 'error', msg: '방이 가득 찼어요' });
      join(ws, t, name, icon);
    } else if (m.type === 'leave') {
      leave(ws); send(ws, listMsg());
    } else if (r && m.type === 'map' && !r.game && ws.slot === host(r)) {
      r.mapId = Math.max(0, Math.min(RANDOM_MAP, (+m.id) | 0));
      toRoom(r, roomMsg(r)); pushList();
    } else if (r && m.type === 'mode' && !r.game && !r.solo && ws.slot === host(r)) {
      r.mode = m.mode === 'team' ? 'team' : 'ffa';
      toRoom(r, roomMsg(r)); pushList();
    } else if (r && m.type === 'bot' && r.solo && !r.game && ws.slot === host(r)) {   // AI 추가 / 제거 / 난이도 / 탱크
      const sl = r.slots[m.slot | 0];
      if (m.op === 'add') { if (r.slots.includes(null)) addBot(r, m.level); }
      else if (sl && sl.bot && m.op === 'del') r.slots[m.slot | 0] = null;
      else if (sl && sl.bot && m.op === 'level' && LEVELS[m.level]) { sl.level = m.level; sl.name = botName(m.slot | 0, m.level); }
      else if (sl && sl.bot && m.op === 'tank' && (KINDS.includes(m.kind) || m.kind === 'random')) sl.tank = m.kind;
      else return;
      toRoom(r, roomMsg(r));
    } else if (r && m.type === 'team' && !r.game && !r.solo) {
      // 본인 팀은 누구나, 다른 사람의 팀은 방장만 바꿀 수 있어요
      const target = Number.isInteger(m.slot) && ws.slot === host(r) ? m.slot : ws.slot;
      if (r.mode === 'team' && r.slots[target]) { r.slots[target].team = m.team === 1 ? 1 : 0; toRoom(r, roomMsg(r)); }
    } else if (r && m.type === 'tank' && !r.game && (KINDS.includes(m.kind) || m.kind === 'random')) {
      r.slots[ws.slot].tank = m.kind; toRoom(r, roomMsg(r));
    } else if (r && m.type === 'start' && !r.game && ws.slot === host(r) && count(r) >= 2) {
      if (r.mode === 'team') {
        const t0 = r.slots.filter(s => s && s.team === 0).length, t1 = r.slots.filter(s => s && s.team === 1).length;
        if (!t0 || !t1) return send(ws, { type: 'error', msg: '팀전은 양 팀에 최소 1명씩 필요해요' });
      }
      newGame(r); toRoom(r, snapshot(r)); pushList();
    } else if (r && m.type === 'landed') {
      const g = r.game;
      if (g && g.busy && !g.orderBusy && g.phase !== 'order' && g.phase !== 'augment' && (g.turn === ws.slot || (r.solo && isBot(r, g.turn)))) resolveShot(r, g);
    } else if (r && m.type === 'move') {
      const g = r.game, now = Date.now();
      if (!g || g.phase === 'order' || g.winner !== -1 || g.busy || g.turn !== ws.slot || g.fuel <= 0) return;
      const icy = onIce(g, g.players[ws.slot]);   // 얼음 위에서는 이동이 느려지고 연료를 더 써요
      if (now - (ws.lastMove || 0) < (icy ? ICE_GAP : 30)) return;
      ws.lastMove = now;
      doMove(r, ws.slot, m.dir > 0 ? 1 : m.dir < 0 ? -1 : 0);
    } else if (r && m.type === 'ofire') {   // 순서 정하기: 각자 동시에 조준을 확정해요 (모두 확정하거나 시간이 끝나면 한꺼번에 발사)
      orderFire(r, ws.slot, m.angle, m.power);
    } else if (r && m.type === 'aug') {   // 증강 선택
      pickAug(r, ws.slot, m.id);
    } else if (r && m.type === 'charge') {   // 레일건: 충전하면 이번 턴이 끝나요 (최대 3번)
      doCharge(r, ws.slot);
    } else if (r && m.type === 'fire') {
      doFire(r, ws.slot, m.angle, m.power);
    }
  });

  ws.on('close', () => leave(ws));
});

server.listen(process.env.PORT || 3000, () => console.log('fortress server up'));
