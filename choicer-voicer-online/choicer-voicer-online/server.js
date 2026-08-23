const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 3e6,
  pingTimeout: 25000,
  pingInterval: 10000,
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Scene italiane, brevi e con segmento già deciso.
// I video restano su YouTube: il gioco incorpora solo il tratto start/end.
const DEFAULT_PROMPTS = [
  { id:'joker-1', movie:'Joker', label:'Arthur Fleck', youtubeId:'jzZ1ALIH7Po', start:31, end:41, emoji:'🃏', source:'Warner Bros. Italia', language:'it' },
  { id:'joker-2', movie:'Joker', label:'Arthur Fleck', youtubeId:'o7nkJDjuSp4', start:53, end:64, emoji:'🃏', source:'Warner Bros. Italia', language:'it' },
  { id:'barbie-1', movie:'Barbie', label:'Barbie', youtubeId:'WaOn1q0PHoE', start:37, end:47, emoji:'💗', source:'Warner Bros. Italia', language:'it' },
  { id:'barbie-2', movie:'Barbie', label:'Ken', youtubeId:'WaOn1q0PHoE', start:68, end:79, emoji:'🕺', source:'Warner Bros. Italia', language:'it' },
  { id:'mario-1', movie:'Super Mario Bros. Il Film', label:'Mario', youtubeId:'eyOP-gA4tIo', start:34, end:44, emoji:'🍄', source:'Universal Pictures International Italy', language:'it' },
  { id:'mario-2', movie:'Super Mario Bros. Il Film', label:'Principessa Peach', youtubeId:'eyOP-gA4tIo', start:69, end:79, emoji:'👑', source:'Universal Pictures International Italy', language:'it' },
  { id:'gru-1', movie:'Cattivissimo Me 4', label:'Gru', youtubeId:'wA1EJaxJocY', start:29, end:39, emoji:'🟡', source:'Universal Pictures International Italy', language:'it' },
  { id:'gru-2', movie:'Cattivissimo Me 4', label:'Maxime Le Mal', youtubeId:'Lfm204Dhb-0', start:49, end:59, emoji:'😈', source:'Universal Pictures International Italy', language:'it' },
  { id:'fastx-1', movie:'Fast X', label:'Dom Toretto', youtubeId:'2rKc-PDzGzc', start:23, end:34, emoji:'🏎️', source:'Universal Pictures International Italy', language:'it' },
  { id:'fastx-2', movie:'Fast X', label:'Dante Reyes', youtubeId:'1rUyJtfOgwE', start:42, end:53, emoji:'🔥', source:'Universal Pictures International Italy', language:'it' }
].map(p => ({ ...p, duration: p.end - p.start, type:'youtube', text:`Imita ${p.label}. La parte da doppiare è già scelta e dura ${p.end - p.start} secondi.` }));

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function publicState(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, ready: p.ready, connected: p.connected })),
    hostId: room.hostId,
    settings: room.settings,
    phase: room.phase,
    round: room.round,
    currentPerformerId: room.currentPerformerId,
    currentPrompt: room.currentPrompt,
    performance: room.performance,
    lastResult: room.lastResult,
    promptsCount: room.prompts.length
  };
}

function emitState(room) { io.to(room.code).emit('state', publicState(room)); }
function resetRoundData(room) { room.currentPrompt = null; room.performance = null; room.lastResult = null; }

function pickPrompt(room) {
  let available = room.prompts.filter(p => !room.usedPromptIds.has(p.id));
  if (!available.length) {
    room.usedPromptIds.clear();
    available = [...room.prompts];
  }
  const prompt = available[Math.floor(Math.random() * available.length)];
  room.usedPromptIds.add(prompt.id);
  return prompt;
}

function beginRound(room) {
  if (room.players.length !== 2) return;
  room.round += 1;
  room.phase = 'perform';
  room.currentPerformerId = room.players[(room.round - 1) % 2].id;
  room.currentPrompt = pickPrompt(room);
  room.performance = null;
  room.lastResult = null;
  emitState(room);
  io.to(room.code).emit('round-start', { round: room.round, performerId: room.currentPerformerId });
}

function finishGame(room) {
  room.phase = 'finished';
  room.currentPrompt = null;
  room.performance = null;
  emitState(room);
  io.to(room.code).emit('game-finished');
}

function normalizeName(name) { return String(name || '').trim().slice(0, 20) || 'Giocatore'; }

io.on('connection', socket => {
  socket.on('create-room', ({ name } = {}, ack = () => {}) => {
    const code = makeCode();
    const room = {
      code,
      hostId: socket.id,
      players: [{ id: socket.id, name: normalizeName(name), score: 0, ready: false, connected: true }],
      settings: { rounds: 8 },
      phase: 'lobby',
      round: 0,
      currentPerformerId: null,
      currentPrompt: null,
      performance: null,
      lastResult: null,
      prompts: DEFAULT_PROMPTS.map(x => ({ ...x })),
      usedPromptIds: new Set(),
      cleanupTimer: null
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, code, playerId: socket.id });
    emitState(room);
  });

  socket.on('join-room', ({ code, name } = {}, ack = () => {}) => {
    code = String(code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Stanza non trovata.' });
    if (room.players.length >= 2) return ack({ ok: false, error: 'La stanza è già piena.' });
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'La partita è già iniziata.' });
    room.players.push({ id: socket.id, name: normalizeName(name), score: 0, ready: false, connected: true });
    socket.join(code);
    socket.data.roomCode = code;
    ack({ ok: true, code, playerId: socket.id });
    emitState(room);
  });

  socket.on('set-ready', ({ ready } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'lobby') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.ready = !!ready;
    emitState(room);
  });

  socket.on('update-settings', ({ rounds } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    const allowed = [6, 8, 10, 12, 16];
    if (allowed.includes(Number(rounds))) room.settings.rounds = Number(rounds);
    emitState(room);
  });

  socket.on('start-game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    if (room.players.length !== 2 || !room.players.every(p => p.ready)) return;
    room.players.forEach(p => p.score = 0);
    room.round = 0;
    room.usedPromptIds.clear();
    resetRoundData(room);
    beginRound(room);
  });

  socket.on('submit-performance', ({ audioDataUrl } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'perform' || room.currentPerformerId !== socket.id) return ack({ ok: false });
    if (!audioDataUrl || typeof audioDataUrl !== 'string' || audioDataUrl.length > 2_500_000) {
      return ack({ ok: false, error: 'Registrazione troppo grande.' });
    }
    room.performance = { performerId: socket.id, audioDataUrl };
    room.phase = 'judge';
    ack({ ok: true });
    emitState(room);
  });

  socket.on('submit-judge-score', ({ score } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'judge' || !room.performance) return ack({ ok: false });
    if (socket.id === room.currentPerformerId) return ack({ ok: false, error: 'Il performer non può votarsi.' });
    const judgeScore = Math.max(1, Math.min(10, Number(score) || 1));
    const finalScore = Math.round(judgeScore * 10);
    const performer = room.players.find(p => p.id === room.currentPerformerId);
    if (performer) performer.score += finalScore;
    room.lastResult = { performerId: room.currentPerformerId, judgeScore, finalScore };
    room.phase = 'result';
    ack({ ok: true });
    emitState(room);

    setTimeout(() => {
      if (!rooms.has(room.code) || room.phase !== 'result') return;
      if (room.round >= room.settings.rounds) finishGame(room);
      else beginRound(room);
    }, 3200);
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'finished') return;
    room.phase = 'lobby';
    room.round = 0;
    room.currentPerformerId = null;
    room.players.forEach(p => { p.score = 0; p.ready = false; });
    room.usedPromptIds.clear();
    resetRoundData(room);
    emitState(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;
    emitState(room);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      if (!room.players.some(p => p.connected)) rooms.delete(room.code);
    }, 5 * 60 * 1000);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Choicer Voicer online on port ${PORT}`));
