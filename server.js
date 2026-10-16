const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.static('public'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map(); // code -> room

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function newRoom(hostSocket, nick, config) {
  let code;
  do { code = genCode(); } while (rooms.has(code));
  const room = {
    code,
    hostId: hostSocket.id,
    players: [{ id: hostSocket.id, nick: nick || 'Jugador 1', bananas: (config && config.startingBananas != null) ? config.startingBananas : 10, alive: true, connected: true }],
    started: false,
    gameOver: false,
    winnerId: null,
    config: {
      bananasPerCrate: (config && config.bananasPerCrate) || 5,
      target: (config && config.target) || 200,
      maxBid: (config && config.maxBid) || 100,
      startingBananas: (config && config.startingBananas != null) ? config.startingBananas : 10,
    },
    round: null,
    roundNumber: 0,
    nextRoundTimer: null,
  };
  rooms.set(code, room);
  return room;
}

function getPublicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    gameOver: room.gameOver,
    winnerId: room.winnerId,
    config: room.config,
    players: room.players.map(p => ({
      id: p.id,
      nick: p.nick,
      bananas: p.bananas,
      connected: p.connected,
      alive: p.alive !== false,
    })),
    roundNumber: room.roundNumber,
    round: room.round ? sanitizeRound(room) : null,
  };
}

function sanitizeRound(room) {
  const r = room.round;
  // During bidding, hide bid values. Show who has acted.
  if (r.phase === 'bidding') {
    return {
      phase: r.phase,
      pot: r.pot,
      actions: Object.keys(r.actions || {}).reduce((acc, k) => { acc[k] = { type: r.actions[k].type }; return acc; }, {}),
    };
  }
  return {
    phase: r.phase,
    pot: r.pot,
    carryover: r.carryover,
    actions: r.actions,
    result: r.result,
  };
}

function broadcast(room) {
  io.to(room.code).emit('roomState', getPublicState(room));
}

function getPlayer(room, id) {
  return room.players.find(p => p.id === id);
}

function startRound(room) {
  const maxBananas = Math.max(0, ...room.players.map(p => p.bananas));
  const pot = Math.max(1, maxBananas);
  room.roundNumber += 1;
  room.round = {
    phase: 'bidding',
    pot,
    carryover: 0,
    actions: {},
    result: null,
  };
  broadcast(room);
}

function resolveRound(room) {
  const round = room.round;
  const activePlayers = room.players.filter(p => p.alive !== false);
  const activeIds = activePlayers.map(p => p.id);
  activeIds.forEach(id => {
    if (!round.actions[id]) {
      const p = getPlayer(room, id);
      if (p && !p.connected) {
        round.actions[id] = { type: 'bid', value: 0 };
      }
    }
  });
  if (activeIds.some(id => !round.actions[id])) {
    broadcast(room);
    return;
  }

  const bids = activeIds.map(id => {
    const a = round.actions[id];
    const val = (a && a.type === 'bid') ? Number(a.value) : 0;
    const clamped = Math.max(0, Math.min(room.config.maxBid, isNaN(val) ? 0 : val));
    return { id, val: clamped };
  });

  let eliminatedThisRound = [];
  const bidsMap = bids.reduce((acc, b) => { acc[b.id] = b.val; return acc; }, {});

  function markEliminated(id) {
    const p = getPlayer(room, id);
    if (p) { p.alive = false; }
    if (!eliminatedThisRound.includes(id)) eliminatedThisRound.push(id);
  }

  function attempt(entries) {
    if (entries.length === 0) return null;
    if (entries.length === 1) {
      const cur = entries[0];
      const pCur = getPlayer(room, cur.id);
      pCur.bananas += round.pot;
      return { type: 'win', winner: cur.id, second: null, maxVal: cur.val, secondVal: cur.val, tariff: 0, pot: round.pot, awarded: true, bids: bidsMap, eliminated: eliminatedThisRound.slice() };
    }
    const topVal = entries[0].val;
    const leaders = entries.filter(e => e.val === topVal);
    const rest = entries.filter(e => e.val !== topVal);

    if (leaders.length >= 2) {
      const nextVal = rest.length ? rest[0].val : topVal;
      const tariffTotal = Math.max(0, topVal - nextVal);
      const n = leaders.length;
      const basePay = Math.floor(tariffTotal / n);
      let remPay = tariffTotal - basePay * n;
      const payments = leaders.map((l, i) => basePay + (i < remPay ? 1 : 0));
      const canAll = leaders.every((l, i) => getPlayer(room, l.id).bananas >= payments[i]);
      if (canAll) {
        leaders.forEach((l, i) => { getPlayer(room, l.id).bananas -= payments[i]; });
        const recipient = rest.length ? getPlayer(room, rest[0].id) : null;
        if (recipient) recipient.bananas += tariffTotal;
        const share = Math.floor(round.pot / n);
        leaders.forEach(l => { getPlayer(room, l.id).bananas += share; });
        return { type: 'tie', leaders: leaders.map(l => l.id), maxVal: topVal, second: recipient ? recipient.id : null, secondVal: nextVal, tariff: tariffTotal, payments: leaders.reduce((acc, l, i) => { acc[l.id] = payments[i]; return acc; }, {}), pot: round.pot, shares: leaders.reduce((acc, l) => { acc[l.id] = share; return acc; }, {}), awarded: true, bids: bidsMap, eliminated: eliminatedThisRound.slice() };
      } else {
        leaders.forEach((l, i) => {
          if (getPlayer(room, l.id).bananas < payments[i]) {
            markEliminated(l.id);
          }
        });
        const remaining = entries.filter(e => !eliminatedThisRound.includes(e.id));
        if (remaining.length === 0) {
          return { type: 'nocapacity', winner: null, second: null, maxVal: topVal, secondVal: nextVal, tariff: tariffTotal, pot: round.pot, awarded: false, bids: bidsMap, eliminated: eliminatedThisRound.slice() };
        }
        const sub = attempt(remaining);
        if (sub) { sub.eliminated = eliminatedThisRound.slice(); }
        return sub;
      }
    } else {
      const cur = leaders[0];
      const nextVal = rest.length ? rest[0].val : 0;
      const tariff = Math.max(0, cur.val - nextVal);
      const recipient = rest.length ? getPlayer(room, rest[0].id) : null;
      const pCur = getPlayer(room, cur.id);
      if (pCur.bananas >= tariff) {
        pCur.bananas -= tariff;
        if (recipient) recipient.bananas += tariff;
        pCur.bananas += round.pot;
        return { type: 'win', winner: cur.id, second: recipient ? recipient.id : null, maxVal: cur.val, secondVal: nextVal, tariff, pot: round.pot, awarded: true, bids: bidsMap, eliminated: eliminatedThisRound.slice() };
      } else {
        markEliminated(cur.id);
        const remaining = entries.slice(1);
        if (remaining.length === 0) {
          return { type: 'nocapacity', winner: cur.id, second: null, maxVal: cur.val, secondVal: nextVal, tariff, pot: round.pot, awarded: false, bids: bidsMap, eliminated: eliminatedThisRound.slice() };
        }
        const sub = attempt(remaining);
        if (sub) { sub.eliminated = eliminatedThisRound.slice(); }
        return sub;
      }
    }
  }

  const sortedEntries = [...bids].sort((a, b) => b.val - a.val);
  const result = attempt(sortedEntries);
  round.carryover = 0;
  round.potAwarded = (result && result.awarded) ? true : false;
  round.result = result || { type: 'nocapacity', winner: null, second: null, maxVal: 0, secondVal: 0, tariff: 0, pot: round.pot, awarded: false, bids: bidsMap, eliminated: eliminatedThisRound.slice() };
  if (!round.result.eliminated) round.result.eliminated = eliminatedThisRound.slice();
  round.result.bids = bidsMap;

  round.phase = 'result';
  if (!room.gameOver) {
    const alive = room.players.filter(p => p.alive !== false);
    if (alive.length === 1) {
      room.gameOver = true;
      room.winnerId = alive[0].id;
      round.result.gameWinner = alive[0].id;
    } else {
      const candidates = alive.filter(p => p.bananas >= room.config.target);
      if (candidates.length > 0) {
        // if several reach the target at once, the one with the most bananas wins
        const gainer = candidates.reduce((best, p) => (!best || p.bananas > best.bananas) ? p : best, null);
        room.gameOver = true;
        room.winnerId = gainer.id;
        round.result.gameWinner = gainer.id;
      }
    }
  }
  broadcast(room);

  if (room.nextRoundTimer) { clearTimeout(room.nextRoundTimer); room.nextRoundTimer = null; }
  if (!room.gameOver) {
    room.nextRoundTimer = setTimeout(() => {
      room.nextRoundTimer = null;
      if (room.round && room.round.phase === 'result' && !room.gameOver) {
        startRound(room);
      }
    }, 12000 + bids.length * 1200); // deja terminar el develado en el cliente
  }
}


io.on('connection', (socket) => {
  socket.on('createRoom', (data) => {
    const nick = (data && data.nick) ? String(data.nick).trim().slice(0, 20) : 'Jugador';
    const config = data && data.config ? data.config : {};
    const room = newRoom(socket, nick, config);
    socket.join(room.code);
    socket.roomCode = room.code;
    socket.emit('joined', { code: room.code, playerId: socket.id });
    broadcast(room);
  });

  socket.on('joinRoom', (data) => {
    const code = (data && data.code) ? String(data.code).toUpperCase().trim() : '';
    const nick = (data && data.nick) ? String(data.nick).trim().slice(0, 20) : 'Jugador';
    const room = rooms.get(code);
    if (!room) { socket.emit('error', { msg: 'Sala no encontrada.' }); return; }
    // Reconnect: if the nick already belongs to a player in this room, reuse that slot
    // (works even after the game started or when refreshing the page).
    const existing = room.players.find(p => p.nick === nick);
    if (existing) {
      const oldId = existing.id;
      existing.id = socket.id;
      existing.connected = true;
      if (room.round && room.round.actions && room.round.actions[oldId]) {
        room.round.actions[socket.id] = room.round.actions[oldId];
        delete room.round.actions[oldId];
      }
      if (room.hostId === oldId) room.hostId = socket.id;
      socket.join(code);
      socket.roomCode = code;
      socket.emit('joined', { code, playerId: socket.id });
      broadcast(room);
      if (room.started && !room.gameOver && room.round && room.round.phase === 'bidding') {
        resolveRound(room);
      }
      return;
    }
    if (room.started) { socket.emit('error', { msg: 'La partida ya comenzó, no se pueden sumar jugadores.' }); return; }
    if (room.players.length >= 8) { socket.emit('error', { msg: 'Sala llena.' }); return; }
    room.players.push({ id: socket.id, nick, bananas: (room.config.startingBananas != null ? room.config.startingBananas : 10), alive: true, connected: true });
    socket.join(code);
    socket.roomCode = code;
    socket.emit('joined', { code, playerId: socket.id });
    broadcast(room);
  });

  socket.on('startGame', (data) => {
    const code = (data && data.code) ? String(data.code).toUpperCase().trim() : (socket.roomCode || '');
    const room = rooms.get(code);
    if (!room) { socket.emit('error', { msg: 'Sala no encontrada.' }); return; }
    if (socket.id !== room.hostId) { socket.emit('error', { msg: 'Solo el anfitrión puede iniciar.' }); return; }
    const aliveCount = room.players.filter(p => p.alive !== false).length;
    if (aliveCount < 2) { socket.emit('error', { msg: 'Se necesitan al menos 2 jugadores.' }); return; }
    if (room.started) { socket.emit('error', { msg: 'La partida ya comenzó.' }); return; }
    room.started = true;
    startRound(room);
  });

  socket.on('submitBid', (data) => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || !room.started || room.gameOver) return;
    if (!room.round || room.round.phase !== 'bidding') return;
  const p = getPlayer(room, socket.id);
  if (!p || p.alive === false) return;
    const val = Math.max(0, Math.min(room.config.maxBid, parseInt(data && data.value, 10) || 0));
    room.round.actions[socket.id] = { type: 'bid', value: val };
    resolveRound(room);
  });

  socket.on('voteSplit', (data) => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || !room.started || room.gameOver) return;
    if (!room.round || room.round.phase !== 'bidding') return;
    if (!getPlayer(room, socket.id)) return;
    room.round.actions[socket.id] = { type: 'split' };
    resolveRound(room);
  });

  socket.on('nextRound', (data) => {
    const code = (data && data.code) ? String(data.code).toUpperCase().trim() : (socket.roomCode || '');
    const room = rooms.get(code);
    if (!room) return;
    if (!room.started || room.gameOver) return;
    if (!room.round || room.round.phase !== 'result') return;
    if (room.nextRoundTimer) { clearTimeout(room.nextRoundTimer); room.nextRoundTimer = null; }
    startRound(room);
  });

  socket.on('abandonGame', (data) => {
    const code = (data && data.code) ? String(data.code).toUpperCase().trim() : (socket.roomCode || '');
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players.find(pl => pl.id === socket.id);
    if (p) {
      if (!room.started) {
        room.players = room.players.filter(pl => pl.id !== socket.id);
        if (socket.id === room.hostId && room.players.length > 0) room.hostId = room.players[0].id;
      } else {
        p.alive = false;
        p.connected = false;
      }
    }
    socket.leave(code);
    socket.roomCode = null;
    if (!room.started) {
      if (room.players.length === 0) rooms.delete(code);
    } else {
      // resolve if bidding stalled
      if (!room.gameOver && room.round && room.round.phase === 'bidding') resolveRound(room);
      // game end check
      if (!room.gameOver) {
        const alive = room.players.filter(pl => pl.alive !== false);
        if (alive.length === 1) {
          room.gameOver = true;
          room.winnerId = alive[0].id;
          if (room.round) { room.round.result = room.round.result || {}; room.round.result.gameWinner = alive[0].id; }
        }
      }
    }
    broadcast(room);
    socket.emit('left', {});
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    const room = code ? rooms.get(code) : null;
    if (!room) return;
    const p = getPlayer(room, socket.id);
    if (p) p.connected = false;
    if (!room.started) {
      room.players = room.players.filter(pl => pl.id !== socket.id);
      if (socket.id === room.hostId && room.players.length > 0) {
        room.hostId = room.players[0].id;
      }
      if (room.players.length === 0) {
        rooms.delete(code);
      }
    }
    // resolve if bidding stalled due to disconnected players
    if (room.started && !room.gameOver && room.round && room.round.phase === 'bidding') {
      resolveRound(room);
    }
    broadcast(room);
  });

  socket.on('leaveRoom', () => {
    const code = socket.roomCode;
    if (code) rooms.get(code); // noop guard
    socket.leave(code);
    socket.roomCode = null;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor bananas escuchando en http://0.0.0.0:' + PORT);
});
