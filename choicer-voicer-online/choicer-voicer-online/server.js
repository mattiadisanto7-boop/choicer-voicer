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
  { id: 'movie-godfather', type: 'youtube', movie: 'Il Padrino', label: 'Don Vito Corleone', text: 'Guarda la scena e imita voce, pause e atteggiamento del personaggio.', youtubeId: 'D6me2-OurCw', emoji: '🎩', source: 'Paramount Movies' },
  { id: 'movie-rocky', type: 'youtube', movie: 'Rocky', label: 'Mickey', text: 'Guarda la scena e prova a rifare il personaggio nel modo più fedele possibile.', youtubeId: 'FC4VfvR_V1s', emoji: '🥊', source: 'Official Rocky Balboa' },
  { id: 'movie-scent', type: 'youtube', movie: 'Scent of a Woman', label: 'Frank Slade', text: 'Guarda il discorso e imita intensità, ritmo e tono.', youtubeId: 'Jd10x8LiuBc', emoji: '🔥', source: 'Universal Pictures' },
  { id: 'movie-field', type: 'youtube', movie: 'L’uomo dei sogni', label: 'Terence Mann', text: 'Guarda la scena e prova a riprodurre la stessa presenza e cadenza.', youtubeId: 'mXBMqbWcqzg', emoji: '⚾', source: 'Universal Pictures' },
  { id: 'movie-mi', type: 'youtube', movie: 'Mission: Impossible – The Final Reckoning', label: 'Ethan Hunt e squadra', text: 'Scegli una battuta della scena e rifalla con la stessa tensione.', youtubeId: 'AP81nzJLS-c', emoji: '🕶️', source: 'Paramount Pictures' },
  { id: 'movie-topgun', type: 'youtube', movie: 'Top Gun: Maverick', label: 'Maverick', text: 'Guarda la scena e imita una delle battute con la stessa sicurezza.', youtubeId: '8xlHWUvWcVM', emoji: '✈️', source: 'Paramount Movies' },
  { id: 'movie-puss', type: 'youtube', movie: 'Il gatto con gli stivali 2', label: 'Gatto / Lupo / Perro', text: 'Scegli un personaggio della clip e prova a rifarne voce ed espressività.', youtubeId: 'XY-XgQ25fKM', emoji: '🐱', source: 'Universal Kids' },
  { id: 'movie-tmnt', type: 'youtube', movie: 'Teenage Mutant Ninja Turtles', label: 'Le Tartarughe / April', text: 'Guarda la scena e imita uno dei personaggi nel modo più convincente possibile.', youtubeId: 'z88vDU5pLxU', emoji: '🐢', source: 'Paramount Movies' }
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
      settings: { rounds: 8, judgeWeight: 1 },
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

  socket.on('add-custom-prompt', ({ movie, character, youtubeUrl } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return ack({ ok: false, error: 'Operazione non consentita.' });
    const raw = String(youtubeUrl || '').trim();
    const match = raw.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/i);
    const youtubeId = match?.[1] || (/^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : null);
    if (!youtubeId) return ack({ ok: false, error: 'Inserisci un link YouTube valido.' });
    const prompt = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'youtube',
      movie: String(movie || 'Scena personalizzata').trim().slice(0, 60),
      label: String(character || 'Personaggio').trim().slice(0, 50),
      text: 'Guarda la scena e imitala nel modo più fedele possibile.',
      youtubeId,
      emoji: '🎬',
      source: 'Scena aggiunta dall’host',
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Choicer Voicer online on port ${PORT}`);
});
