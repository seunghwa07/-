const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const FMAP = require('./maps.js');

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
const KINDS = ['basic', 'incendiary', 'cluster', 'homing'];
const SHELL = { basic: { dmg: 17, rad: CRATER }, incendiary: { dmg: 10, rad: 40 }, cluster: { dmg: 5, rad: 22 }, homing: { dmg: 12, rad: 45 } };
const DIRECT = HIT_R + 8;          // 이 거리 안이면 직격 → 전체 피해
const MAX_CLIMB = 30;              // 한 걸음(6px)당 최대 오르막 높이 → 약 78° 경사까지 (이전 8 ≈ 53°)
const FIRE_R = 90, BURN = 8;       // 소이탄 불길 반경 / 불 위 탱크가 자기 차례 시작 때 받는 피해
const CLUSTER_N = 8;               // 집속탄 한 번에 나가는 소탄 수
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

const alive = g => g.players.map((p, i) => (p.on && p.hp > 0 ? i : -1)).filter(i => i >= 0);

function nextTurn(g, from) {
  for (let k = 1; k <= MAX; k++) {
    const i = (from + k) % MAX;
    if (g.players[i].on && g.players[i].hp > 0) return i;
  }
  return from;
}

function newGame(r) {
  const map = r.mapId === RANDOM_MAP ? Math.floor(Math.random() * FMAP.MAPS.length) : r.mapId;
  r.game = {
    map, terrain: FMAP.terrain(map), wind: rndWind(), winner: -1, mode: r.mode, winTeam: -1, fires: [],
    players: SPAWN.map((x, i) => ({ x, hp: r.slots[i] ? 100 : 0, on: !!r.slots[i], team: r.slots[i] ? r.slots[i].team : 0, tank: r.slots[i] ? r.slots[i].tank : 'basic', name: r.slots[i] ? r.slots[i].name : '', icon: r.slots[i] ? r.slots[i].icon : '' })),
  };
  r.game.turn = r.game.players.findIndex(p => p.on);
  r.game.fuel = FUEL;
}

function snapshot(r) {
  const g = r.game;
  return {
    type: 'state', map: g.map, terrain: g.terrain, turn: g.turn, wind: g.wind, winner: g.winner, fuel: g.fuel, mode: g.mode, winTeam: g.winTeam,
    teams: g.players.map(p => p.team),
    fires: g.fires.map(f => ({ x: f.x, y: f.y, r: f.r, life: f.life })),
    players: g.players.map(p => ({ team: p.team, tank: p.tank, x: p.x, y: g.terrain[p.x], hp: p.hp, on: p.on, name: p.name, icon: p.icon })),
  };
}

function checkEnd(r) {
  const g = r.game, a = alive(g);
  if (g.mode === 'team') {   // 팀전: 살아있는 팀이 하나 이하면 종료
    const ts = new Set(a.map(i => g.players[i].team));
    if (ts.size > 1) return false;
    g.winTeam = ts.size ? [...ts][0] : -1;
  } else if (a.length > 1) return false;
  g.winner = a.length ? a[0] : -2; // -2: 무승부
  setTimeout(() => {
    if (r.game === g) { r.game = null; toRoom(r, roomMsg(r)); pushList(); }
  }, 5000);
  return true;
}

function crater(g, cx, cy, rad) {
  for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(W - 1, Math.ceil(cx + rad)); x++) {
    const dy = Math.sqrt(Math.max(0, rad * rad - (x - cx) ** 2));
    if (g.terrain[x] <= cy + dy) g.terrain[x] = Math.min(H, Math.round(cy + dy));
  }
}

// 직격(DIRECT 이내)은 전체 피해, 멀어질수록 줄어들어 최소 25%
const dmgAt = (base, d, reach) => d >= reach ? 0 : d <= DIRECT ? base : Math.max(Math.round(base * .25), Math.round(base * (1 - (d - DIRECT) / (reach - DIRECT))));
const isAlly = (g, a, b) => g.mode === 'team' && a !== b && g.players[a].team === g.players[b].team;
const tankY = (g, q) => g.terrain[q.x] - 10 * TS;

// 포탄 한 발의 비행 계산. 유도탄은 가장 가까운 적 쪽으로 휘어져요.
function flight(g, shooter, angle, power, kind) {
  const p = g.players[shooter];
  const a = angle * Math.PI / 180, v = power * 8 * K, dt = 1 / 120;
  let x = p.x, y = g.terrain[p.x] - 14 * TS;
  let vx = v * Math.cos(a), vy = -v * Math.sin(a);
  const path = [[x, y]];
  let impact = null, target = null;
  if (kind === 'homing') {
    g.players.forEach((q, i) => {
      if (q.hp <= 0 || i === shooter || isAlly(g, shooter, i)) return;
      if (!target || Math.abs(q.x - p.x) < Math.abs(target.x - p.x)) target = q;
    });
  }
  for (let t = 0; t < 3600; t++) {
    if (target && t > 30) {
      const want = Math.atan2(tankY(g, target) - y, target.x - x), cur = Math.atan2(vy, vx), sp = Math.hypot(vx, vy);
      let d = want - cur;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const na = cur + Math.max(-HOMING_TURN * dt, Math.min(HOMING_TURN * dt, d));
      vx = sp * Math.cos(na) + g.wind * 1.5 * K * dt; vy = sp * Math.sin(na) + G * .3 * dt;
    } else { vx += g.wind * 3 * K * dt; vy += G * dt; }
    x += vx * dt; y += vy * dt;
    if (t % 4 === 0) path.push([x, y]);
    if (x < 0 || x >= W || y > H) break;
    if (y >= g.terrain[Math.floor(x)]) { impact = [x, y]; break; }
    if (g.players.some((q, i) => q.hp > 0 && (i !== shooter || t > 40) && !isAlly(g, shooter, i) &&
        Math.hypot(x - q.x, y - tankY(g, q)) < HIT_R)) { impact = [x, y]; break; }
  }
  if (impact) path.push(impact);
  return { path, impact };
}

// 착탄: 땅 파임 + 피해(팀전에서는 아군 제외) + 소이탄이면 불길 생성
function explode(g, shooter, impact, kind) {
  const { dmg, rad } = SHELL[kind], reach = rad + 25;
  crater(g, impact[0], impact[1], rad);
  g.players.forEach((q, i) => {
    if (q.hp <= 0 || isAlly(g, shooter, i)) return;
    q.hp = Math.max(0, q.hp - dmgAt(dmg, Math.hypot(q.x - impact[0], tankY(g, q) - impact[1]), reach));
  });
  if (kind === 'incendiary') {
    const fx = Math.max(0, Math.min(W - 1, Math.round(impact[0])));
    g.fires.push({ x: fx, y: g.terrain[fx], r: FIRE_R, life: 2 * alive(g).length + 1, by: shooter });
  }
}

// 다음 차례로 넘기고, 불길의 수명을 줄이고, 불 위에 선 탱크에 화상 피해를 줘요
function advance(r, from) {
  const g = r.game;
  g.turn = nextTurn(g, from); g.wind = rndWind(); g.fuel = FUEL;
  g.fires.forEach(f => f.life--);
  g.fires = g.fires.filter(f => f.life > 0);
  for (let n = 0; n < MAX; n++) {
    const qi = g.turn, q = g.players[qi];
    const burn = g.fires.filter(f => !isAlly(g, f.by, qi) && Math.hypot(q.x - f.x, tankY(g, q) - f.y) < f.r).length;
    if (!burn) return;
    q.hp = Math.max(0, q.hp - BURN * burn);
    if (q.hp > 0 || checkEnd(r)) return;
    g.turn = nextTurn(g, qi);
  }
}

function fire(r, shooter, angle, power) {
  const g = r.game, kind = g.players[shooter].tank;
  let shells, dud = false;
  if (kind === 'cluster') {
    shells = Array.from({ length: CLUSTER_N }, () =>
      flight(g, shooter, Math.min(180, Math.max(0, angle + (Math.random() - .5) * 14)), Math.min(100, power * (.9 + Math.random() * .2)), kind));
  } else if (kind === 'homing' && Math.random() < DUD) {   // 불발: 날아가다 떨어져 사라져요
    const s = flight(g, shooter, angle, power, 'basic');
    s.path = s.path.slice(0, Math.max(3, Math.floor(s.path.length * (.35 + Math.random() * .4)))); s.impact = null;
    shells = [s]; dud = true;
  } else shells = [flight(g, shooter, angle, power, kind)];

  shells.forEach(s => { if (s.impact) explode(g, shooter, s.impact, kind); });

  if (!checkEnd(r)) advance(r, shooter);
  return { type: 'shot', by: shooter, angle, kind, dud, shells: shells.map(s => ({ path: s.path, impact: s.impact })), state: snapshot(r) };
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
      if (!checkEnd(r) && g.turn === i) advance(r, i);
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
    } else if (r && m.type === 'move') {
      const g = r.game, now = Date.now();
      if (!g || g.winner !== -1 || g.turn !== ws.slot || g.fuel <= 0 || now - (ws.lastMove || 0) < 30) return;
      ws.lastMove = now;
      const dir = m.dir > 0 ? 1 : m.dir < 0 ? -1 : 0, p = g.players[ws.slot];
      const nx = p.x + dir * STEP;
      if (!dir || nx < 40 || nx > W - 40) return;
      if (g.terrain[nx] < g.terrain[p.x] - MAX_CLIMB) return; // 한 걸음(STEP)에 오를 수 있는 최대 높이
      if (g.players.some((q, i) => i !== ws.slot && q.hp > 0 && Math.abs(q.x - nx) < 40)) return;
      p.x = nx; g.fuel -= STEP;
      toRoom(r, { type: 'moved', i: ws.slot, x: nx, y: g.terrain[nx], fuel: g.fuel });
    } else if (r && m.type === 'fire') {
      const g = r.game;
      if (!g || g.winner !== -1 || g.turn !== ws.slot || g.players[ws.slot].hp <= 0) return;
      toRoom(r, fire(r, ws.slot,
        Math.min(180, Math.max(0, +m.angle || 0)),
        Math.min(100, Math.max(10, +m.power || 10))));
    }
  });

  ws.on('close', () => leave(ws));
});

server.listen(process.env.PORT || 3000, () => console.log('fortress server up'));
