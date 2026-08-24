// Caption-gated catalog: a default song is accepted only if the YouTube player exposes a caption track.
(function () {
  const verified = new Set();
  const rejected = new Set();
  let checkingId = null;
  let consecutiveRejects = 0;

  function customHasText(prompt) {
    return !!(prompt?.custom && String(prompt?.lyricCue || '').trim().split(/\s+/).filter(Boolean).length >= 3);
  }

  function trackValid(track) {
    if (!track || typeof track !== 'object') return false;
    if (Array.isArray(track)) return track.length > 0;
    return Object.keys(track).length > 0 && !!(track.languageCode || track.vss_id || track.name || track.id || track.kind);
  }

  async function waitUntilPlaying(player, timeout = 3200) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      try {
        const s = player.getPlayerState();
        if (s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING) return true;
      } catch {}
      await sleep(120);
    }
    return false;
  }

  async function hasRealCaptions(prompt) {
    if (customHasText(prompt)) return true;
    if (!prompt?.youtubeId) return false;
    await ytReady;
    const player = performPlayer;
    if (!player) return false;

    stopPlayer('perform');
    try {
      player.mute();
      player.loadVideoById({
        videoId: prompt.youtubeId,
        startSeconds: Number(prompt.start) || 0,
        endSeconds: Number(prompt.end) || 10
      });
    } catch {
      return false;
    }

    const started = await waitUntilPlaying(player);
    if (!started) {
      try { player.stopVideo(); } catch {}
      return false;
    }

    tryCaptions(player, prompt);
    await sleep(1600);

    let track = null, trackCc = null, list = null, listCc = null;
    try { track = player.getOption('captions', 'track'); } catch {}
    try { trackCc = player.getOption('cc', 'track'); } catch {}
    try { list = player.getOption('captions', 'tracklist'); } catch {}
    try { listCc = player.getOption('cc', 'tracklist'); } catch {}

    const has = trackValid(track) || trackValid(trackCc) || trackValid(list) || trackValid(listCc);

    try {
      player.pauseVideo();
      player.seekTo(Number(prompt.start) || 0, true);
      player.mute();
      tryCaptions(player, prompt);
    } catch {}

    return has;
  }

  async function verifyCurrentPrompt(snapshot) {
    if (!snapshot || snapshot.phase !== 'perform') return;
    if (snapshot.currentPerformerId !== me) return;
    if (isRecording || hasListened || recordingBlob) return;

    const prompt = snapshot.currentPrompt;
    if (!prompt?.id) return;

    if (verified.has(prompt.id) || customHasText(prompt)) {
      verified.add(prompt.id);
      consecutiveRejects = 0;
      $('#listenBtn').disabled = false;
      $('#recordStatus').textContent = customHasText(prompt)
        ? 'Testo del frammento disponibile ✓ Ascolta il pezzo.'
        : 'Sottotitoli verificati ✓ Ascolta il pezzo.';
      cueSong('perform', prompt);
      return;
    }

    if (rejected.has(prompt.id) || checkingId === prompt.id) return;
    if (consecutiveRejects >= 25) {
      $('#listenBtn').disabled = true;
      $('#recordBtn').disabled = true;
      $('#recordStatus').textContent = 'Non trovo un altro video con sottotitoli verificabili. Ricarica la stanza o aggiungi un brano con testo.';
      return;
    }

    checkingId = prompt.id;
    $('#listenBtn').disabled = true;
    $('#recordBtn').disabled = true;
    $('#recordStatus').textContent = 'Controllo che questo video abbia davvero i sottotitoli…';

    let ok = false;
    try { ok = await hasRealCaptions(prompt); } catch { ok = false; }

    if (state?.currentPrompt?.id !== prompt.id || state?.phase !== 'perform') {
      checkingId = null;
      return;
    }

    if (ok) {
      verified.add(prompt.id);
      checkingId = null;
      consecutiveRejects = 0;
      $('#listenBtn').disabled = false;
      $('#recordStatus').textContent = 'Sottotitoli verificati ✓ Ascolta il pezzo.';
      cueSong('perform', prompt);
      return;
    }

    rejected.add(prompt.id);
    checkingId = null;
    consecutiveRejects++;
    $('#recordStatus').textContent = 'Questo video non ha una traccia sottotitoli verificabile. Ne scelgo un altro…';
    socket.emit('reject-current-prompt', { promptId: prompt.id, reason: 'missing-captions' }, response => {
      if (!response?.ok) {
        $('#recordStatus').textContent = 'Non sono riuscito a sostituire il brano. Riprova.';
      }
    });
  }

  socket.on('state', snapshot => {
    setTimeout(() => verifyCurrentPrompt(snapshot), 0);
  });

  socket.on('prompt-replaced', () => {
    checkingId = null;
    try { resetLocalRound(); } catch {}
    setTimeout(() => {
      try { render(); } catch {}
      verifyCurrentPrompt(state);
    }, 40);
  });
})();
