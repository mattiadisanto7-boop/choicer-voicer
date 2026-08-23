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

const DEFAULT_PROMPTS = [
  { id: 'p1', label: 'Generale drammatico', text: 'Soldati, oggi si vince o si torna a casa!', audio: '/audio/generale.wav', emoji: '⚔️' },
  { id: 'p2', label: 'Telecronista impazzito', text: 'Incredibile! Non ci posso credere, che giocata!', audio: '/audio/telecronista.wav', emoji: '🎙️' },
  { id: 'p3', label: 'Robot confuso', text: 'Errore di sistema. Ho appena imparato a fare il caffè.', audio: '/audio/robot.wav', emoji: '🤖' },
  { id: 'p4', label: 'Re offeso', text: 'Come osi entrare nel mio castello senza biscotti?', audio: '/audio/re.wav', emoji: '👑' },
  { id: 'p5', label: 'Detective sospettoso', text: 'Qualcosa non torna. Quel gatto sa più di quanto dice.', audio: '/audio/detective.wav', emoji: '🕵️' },
  { id: 'p6', label: 'Alieno in vacanza', text: 'Salve terrestre, dov’è la spiaggia più vicina?', audio: '/audio/alieno.wav', emoji: '👽' },
  { id: 'p7', label: 'Chef disperato', text: 'No! La pasta è scotta! Questa è una tragedia nazionale!', audio: '/audio/chef.wav', emoji: '🍝' },
  { id: 'p8', label: 'Cattivo da film', text: 'Finalmente ci incontriamo. Ho aspettato questo momento.', audio: '/audio/cattivo.wav', emoji: '🦹' },
  { id: 'p9', label: 'Principessa annoiata', text: 'Un altro drago? Pensavo aveste qualcosa di originale.', audio: '/audio/principessa.wav', emoji: '👸' },
  { id: 'p10', label: 'Capitano spaziale', text: 'Motori al massimo. Destinazione: il pianeta delle patatine!', audio: '/audio/capitano.wav', emoji: '🚀' }
];

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

function emitState(room) {
  io.to(room.code).emit('state', publicState(room));
}

function resetRoundData(room) {
  room.currentPrompt = null;
  room.performance = null;
  room.lastResult = null;
}

function pickPrompt(room) {
  const used = room.usedPromptIds;
  let available = room.prompts.filter(p => !used.has(p.id));
  if (!available.length) {
    used.clear();
    available = [...room.prompts];
  }
  const prompt = available[Math.floor(Math.random() * available.length)];
  used.add(prompt.id);
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

function normalizeName(name) {
  return String(name || '').trim().slice(0, 20) || 'Giocatore';
}

io.on('connection', socket => {
  socket.on('create-room', ({ name } = {}, ack = () => {}) => {
    const code = makeCode();
    const room = {
      code,
      hostId: socket.id,
      players: [{ id: socket.id, name: normalizeName(name), score: 0, ready: false, connected: true }],
      settings: { rounds: 8, judgeWeight: 0.6 },
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

  socket.on('add-custom-prompt', ({ label, text, audioDataUrl } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return ack({ ok: false, error: 'Operazione non consentita.' });
    if (!audioDataUrl || typeof audioDataUrl !== 'string' || audioDataUrl.length > 2_200_000) {
      return ack({ ok: false, error: 'Audio troppo grande o non valido (max ~1,5 MB).' });
    }
    const prompt = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: String(label || 'Clip personalizzata').slice(0, 40),
      text: String(text || '').slice(0, 120),
      audioDataUrl,
      emoji: '🎧',
      custom: true
    };
    room.prompts.push(prompt);
    ack({ ok: true });
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

  socket.on('submit-performance', ({ audioDataUrl, autoScore, features } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'perform' || room.currentPerformerId !== socket.id) return ack({ ok: false });
    if (!audioDataUrl || typeof audioDataUrl !== 'string' || audioDataUrl.length > 2_500_000) {
      return ack({ ok: false, error: 'Registrazione troppo grande.' });
    }
    room.performance = {
      performerId: socket.id,
      audioDataUrl,
      autoScore: Math.max(0, Math.min(100, Math.round(Number(autoScore) || 0))),
      features: features || null
    };
    room.phase = 'judge';
    ack({ ok: true });
    emitState(room);
  });

  socket.on('submit-judge-score', ({ score } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'judge' || !room.performance) return ack({ ok: false });
    if (socket.id === room.currentPerformerId) return ack({ ok: false, error: 'Il performer non può votarsi.' });
    const judgeScore = Math.max(1, Math.min(10, Number(score) || 1));
    const auto = room.performance.autoScore;
    const final = Math.round((auto * (1 - room.settings.judgeWeight)) + ((judgeScore * 10) * room.settings.judgeWeight));
    const performer = room.players.find(p => p.id === room.currentPerformerId);
    if (performer) performer.score += final;
    room.lastResult = {
      performerId: room.currentPerformerId,
      autoScore: auto,
      judgeScore,
      finalScore: final
    };
    room.phase = 'result';
    ack({ ok: true });
    emitState(room);
    setTimeout(() => {
      const latest = rooms.get(room.code);
      if (!latest || latest.phase !== 'result') return;
      if (latest.round >= latest.settings.rounds) finishGame(latest);
      else beginRound(latest);
    }, 4200);
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'finished') return;
    room.phase = 'lobby';
    room.round = 0;
    room.currentPerformerId = null;
    room.players.forEach(p => { p.score = 0; p.ready = false; });
    resetRoundData(room);
    emitState(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (!room.players.length) {
      rooms.delete(code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    room.phase = 'lobby';
    room.round = 0;
    room.currentPerformerId = null;
    room.players.forEach(p => { p.ready = false; p.score = 0; });
    resetRoundData(room);
    emitState(room);
  });
});

server.listen(PORT, () => {
  console.log(`Choicer Voicer Online listening on port ${PORT}`);
});
