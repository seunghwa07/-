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
const KINDS = ['basic', 'incendiary', 'cluster', 'homing', 'heavy', 'pierce', 'laser'];
const SHELL = {
  basic: { dmg: 17, rad: CRATER }, incendiary: { dmg: 10, rad: 40 }, cluster: { dmg: 5, rad: 22 }, homing: { dmg: 12, rad: 45 },
  pierce: { dmg: 14, rad: 30 }, laser: { dmg: 15, rad: 0 },   // 관통탄(기본탄보다 약함) / 레이저(직격만)
  heavy: { dmg: 34, rad: Math.round(CRATER * Math.sqrt(3)) },   // 광폭탄: 피해 2배, 폭발 면적 3배(반지름 √3배)
};
const SPEED = { heavy: Math.sqrt(0.7) };   // 광폭탄 탄속: 사거리가 속도²에 비례하므로 사거리 70%
const DIRECT = HIT_R + 8;          // 이 거리 안이면 직격 → 전체 피해
const MAX_CLIMB = 90;              // 한 걸음(6px)당 최대 오르막 높이 → 약 86° 경사까지 (거의 수직 절벽만 막혀요)
const FIRE_R = 90, FIRE_MS = 3000, BURN_TICK = 500, BURN_DMG = 2;   // 소이탄: 불길 반경 / 3초 지속 / 0.5초마다 2 피해
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
    players: SPAWN.map((sx, i) => ({ x: xs[i] ?? sx, hp: r.slots[i] ? 100 : 0, on: !!r.slots[i], team: r.slots[i] ? r.slots[i].team : 0, tank: r.slots[i] ? r.slots[i].tank : 'basic', name: r.slots[i] ? r.slots[i].name : '', icon: r.slots[i] ? r.slots[i].icon : '' })),
  };
  r.game.turn = r.game.players.findIndex(p => p.on);
  r.game.fuel = FUEL;
}

function snapshot(r) {
  const g = r.game;
  return {
    type: 'state', map: g.map, terrain: g.terrain, turn: g.turn, wind: g.wind, winner: g.winner, fuel: g.fuel, mode: g.mode, winTeam: g.winTeam, busy: !!g.busy,
    teams: g.players.map(p => p.team),
    fires: fireList(g),
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
  const a = angle * Math.PI / 180, v = power * 8 * K * (SPEED[kind] || 1), dt = 1 / 120;
  let x = p.x, y = g.terrain[p.x] - 14 * TS;
  let vx = v * Math.cos(a), vy = -v * Math.sin(a);
  const path = [[x, y]];
  let impact = null, target = null, out = false;
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
    if (x < 0 || x >= W || y > H) { out = true; break; }
    if (kind !== 'pierce' && y >= g.terrain[Math.floor(x)]) { impact = [x, y]; break; }   // 관통탄은 땅을 그냥 통과해요
    if (g.players.some((q, i) => q.hp > 0 && (i !== shooter || t > 40) && !isAlly(g, shooter, i) &&
        Math.hypot(x - q.x, y - tankY(g, q)) < HIT_R)) { impact = [x, y]; break; }
  }
  if (impact) path.push(impact);
  return { path, impact, fizzled: !impact && !out };   // fizzled: 30초 넘게 날다 소멸
}

// 레이저: 포물선 없이 직선으로 날아가고, 벽(지형)에 닿으면 반사돼요. 4번 반사한 뒤 또 닿으면 사라져요.
const LASER_BOUNCES = 4;
function laserFlight(g, shooter, angle) {
  const p = g.players[shooter], a = angle * Math.PI / 180, STEP = 4, MAXLEN = 9000;
  let x = p.x, y = g.terrain[p.x] - 20 * TS, dx = Math.cos(a), dy = -Math.sin(a);
  let bounces = 0, len = 0, rec = 0, hit = null, impact = null;
  const path = [[x, y]];
  while (len < MAXLEN) {
    const nx = x + dx * STEP, ny = y + dy * STEP;
    if (nx < 0 || nx >= W || ny < -400) break;                                   // 맵 밖
    const ti = g.players.findIndex((q, i) => q.hp > 0 && (i !== shooter || bounces > 0 || len > 90) && !isAlly(g, shooter, i) &&
      Math.hypot(nx - q.x, ny - tankY(g, q)) < HIT_R);
    if (ti >= 0) { hit = ti; impact = [nx, ny]; x = nx; y = ny; break; }          // 탱크 명중
    if (ny >= g.terrain[Math.floor(nx)]) {                                       // 벽에 닿음
      path.push([x, y]); rec = 0;
      if (bounces >= LASER_BOUNCES) break;                                       // 5번째 접촉: 소멸
      bounces++;
      const xi = Math.floor(nx), xl = Math.max(0, xi - 6), xr = Math.min(W - 1, xi + 6);
      const sl = (g.terrain[xr] - g.terrain[xl]) / ((xr - xl) || 1), nl = Math.hypot(sl, 1), nX = sl / nl, nY = -1 / nl;   // 지형 표면의 바깥쪽 법선
      const dot = dx * nX + dy * nY;
      if (dot < 0) { dx -= 2 * dot * nX; dy -= 2 * dot * nY; }
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
function explode(g, shooter, impact, kind, delay = 0) {
  const { dmg, rad } = SHELL[kind], reach = rad + 25;
  crater(g, impact[0], impact[1], rad);
  g.players.forEach((q, i) => {
    if (q.hp <= 0 || isAlly(g, shooter, i)) return;
    q.hp = Math.max(0, q.hp - dmgAt(dmg, Math.hypot(q.x - impact[0], tankY(g, q) - impact[1]), reach));
  });
  if (kind === 'incendiary') {
    const fx = Math.max(0, Math.min(W - 1, Math.round(impact[0]))), t0 = Date.now() + delay;
    g.fires.push({ x: fx, y: g.terrain[fx], r: FIRE_R, by: shooter, startAt: t0, endsAt: t0 + FIRE_MS, next: t0 + BURN_TICK });
  }
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
        q.hp = Math.max(0, q.hp - BURN_DMG);
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
function endBusy(g) { g.busy = false; clearTimeout(g.busyTimer); }
function resolveShot(r, g) {
  if (r.game !== g || !g.busy) return;
  endBusy(g);
  if (g.winner !== -1) return;
  advance(r, g.turn);
  toRoom(r, { type: 'turn', turn: g.turn, wind: g.wind, fuel: g.fuel });
}

function advance(r, from) {   // 다음 차례로 넘겨요
  const g = r.game;
  g.turn = nextTurn(g, from); g.wind = rndWind(); g.fuel = FUEL;
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
  } else if (kind === 'laser') shells = [laserFlight(g, shooter, angle)];
  else shells = [flight(g, shooter, angle, power, kind)];

  if (shells.length === 1 && shells[0].fizzled) dud = true;   // 맴돌다 사라진 포탄도 불발로 처리
  // 클라이언트 애니메이션(약 60프레임/초)이 끝나 폭발이 보일 때쯤 불길이 시작되도록 맞춰요
  shells.forEach(s => { if (kind === 'laser') { if (s.hit != null) g.players[s.hit].hp = Math.max(0, g.players[s.hit].hp - SHELL.laser.dmg); } else if (s.impact) explode(g, shooter, s.impact, kind, Math.round(s.path.length * 1000 / 60 / (kind === 'heavy' ? .6 : 1)) + 300); });
  if (g.fires.length) startBurn(r);

  if (!checkEnd(r)) {   // 턴은 바로 넘기지 않고, 포탄이 끝날 때까지 기다려요
    g.busy = true;
    const ms = Math.max(...shells.map(s => s.path.length)) * 1000 / 60 / (kind === 'heavy' ? .6 : 1) + 2000;
    g.busyTimer = setTimeout(() => resolveShot(r, g), ms);
  }
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
      if (!checkEnd(r) && g.turn === i) { endBusy(g); advance(r, i); }
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
      if (g && g.busy && g.turn === ws.slot) resolveShot(r, g);
    } else if (r && m.type === 'move') {
      const g = r.game, now = Date.now();
      if (!g || g.winner !== -1 || g.busy || g.turn !== ws.slot || g.fuel <= 0 || now - (ws.lastMove || 0) < 30) return;
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
      if (!g || g.winner !== -1 || g.busy || g.turn !== ws.slot || g.players[ws.slot].hp <= 0) return;
      toRoom(r, fire(r, ws.slot,
        Math.min(180, Math.max(0, +m.angle || 0)),
        Math.min(100, Math.max(10, +m.power || 10))));
    }
  });

  ws.on('close', () => leave(ws));
});

server.listen(process.env.PORT || 3000, () => console.log('fortress server up'));
