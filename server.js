const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const FMAP = require('./maps.js');

const app = express();
app.use(express.static(__dirname));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const W = 1000, H = 600, G = 500, CRATER = 40, HIT_R = 18, MAX = 4, RANDOM_MAP = 4;
const SPAWN = [100, 366, 633, 900];
const ICONS = ['🪖', '🐸', '🚀', '🐱', '🤖', '🦖'];
const rooms = new Map();

const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const rndWind = () => Math.round(Math.random() * 20 - 10);
const count = r => r.slots.filter(Boolean).length;
const host = r => r.slots.findIndex(Boolean);
const toRoom = (r, m) => r.slots.forEach(s => s && send(s.ws, m));
const roomMsg = r => ({ type: 'room', code: r.code, host: host(r), mapId: r.mapId, names: r.slots.map(s => s && s.name), icons: r.slots.map(s => s && s.icon) });
const listMsg = () => ({
  type: 'rooms',
  rooms: [...rooms.values()].map(r => ({
    code: r.code, count: count(r), map: r.mapId, host: r.slots[host(r)].name, playing: !!r.game,
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
    map, terrain: FMAP.terrain(map), wind: rndWind(), winner: -1,
    players: SPAWN.map((x, i) => ({ x, hp: r.slots[i] ? 100 : 0, on: !!r.slots[i], name: r.slots[i] ? r.slots[i].name : '', icon: r.slots[i] ? r.slots[i].icon : '' })),
  };
  r.game.turn = r.game.players.findIndex(p => p.on);
}

function snapshot(r) {
  const g = r.game;
  return {
    type: 'state', map: g.map, terrain: g.terrain, turn: g.turn, wind: g.wind, winner: g.winner,
    players: g.players.map(p => ({ x: p.x, y: g.terrain[p.x], hp: p.hp, on: p.on, name: p.name, icon: p.icon })),
  };
}

function checkEnd(r) {
  const g = r.game, a = alive(g);
  if (a.length > 1) return false;
  g.winner = a.length ? a[0] : -2; // -2: 무승부
  setTimeout(() => {
    if (r.game === g) { r.game = null; toRoom(r, roomMsg(r)); pushList(); }
  }, 5000);
  return true;
}

function crater(g, cx, cy) {
  for (let x = Math.max(0, Math.floor(cx - CRATER)); x <= Math.min(W - 1, Math.ceil(cx + CRATER)); x++) {
    const dy = Math.sqrt(Math.max(0, CRATER * CRATER - (x - cx) ** 2));
    if (g.terrain[x] <= cy + dy) g.terrain[x] = Math.min(H, Math.round(cy + dy));
  }
}

function fire(r, shooter, angle, power) {
  const g = r.game, p = g.players[shooter];
  const a = angle * Math.PI / 180, v = power * 8, dt = 1 / 60;
  let x = p.x, y = g.terrain[p.x] - 14;
  let vx = v * Math.cos(a), vy = -v * Math.sin(a);
  const path = [[x, y]];
  let impact = null;

  for (let t = 0; t < 1800; t++) {
    vx += g.wind * 3 * dt; vy += G * dt; x += vx * dt; y += vy * dt;
    if (t % 2 === 0) path.push([x, y]);
    if (x < 0 || x >= W || y > H) break;
    if (y >= g.terrain[Math.floor(x)]) { impact = [x, y]; break; }
    if (g.players.some((q, i) => q.hp > 0 && (i !== shooter || t > 20) &&
        Math.hypot(x - q.x, y - (g.terrain[q.x] - 10)) < HIT_R)) { impact = [x, y]; break; }
  }

  if (impact) {
    path.push(impact);
    crater(g, impact[0], impact[1]);
    const reach = CRATER + 20;
    g.players.forEach(q => {
      if (q.hp <= 0) return;
      const d = Math.hypot(q.x - impact[0], g.terrain[q.x] - 10 - impact[1]);
      if (d < reach) q.hp = Math.max(0, q.hp - Math.max(5, Math.round(40 * (1 - d / reach))));
    });
  }

  if (!checkEnd(r)) { g.turn = nextTurn(g, shooter); g.wind = rndWind(); }
  return { type: 'shot', by: shooter, angle, path, impact, state: snapshot(r) };
}

function join(ws, r, name, icon) {
  const i = r.slots.indexOf(null);
  r.slots[i] = { ws, name, icon };
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
      if (!checkEnd(r) && g.turn === i) g.turn = nextTurn(g, i);
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
      const nr = { code, slots: Array(MAX).fill(null), mapId: 0, game: null };
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
    } else if (r && m.type === 'start' && !r.game && ws.slot === host(r) && count(r) >= 2) {
      newGame(r); toRoom(r, snapshot(r)); pushList();
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
