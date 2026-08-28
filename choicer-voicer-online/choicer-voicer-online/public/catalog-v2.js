// Caption-gated catalog v3.
// IMPORTANT: caption verification uses a dedicated invisible YouTube player.
// It never touches the visible performance player and never replaces a prompt after
// the user has started listening to it.
(function () {
  const verified = new Set();
  const rejected = new Set();
  let checkingId = null;
  let consecutiveRejects = 0;
  let lockedPromptId = null;
  let lastPromptId = null;

  let probePlayer = null;
  let probeReadyResolve = null;
  let probeReadyPromise = null;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function customHasText(prompt) {
    return !!(prompt?.custom && String(prompt?.lyricCue || '').trim().split(/\s+/).filter(Boolean).length >= 3);
  }

  function langFor(prompt) {
    if (prompt?.language === 'IT') return 'it';
    if (prompt?.language === 'ES') return 'es';
    if (prompt?.language === 'KO') return 'ko';
    return 'en';
  }

  function trackValid(track) {
    if (!track) return false;
    if (Array.isArray(track)) return track.some(trackValid);
    if (typeof track !== 'object') return false;
    return Object.keys(track).length > 0 &&
      !!(track.languageCode || track.vss_id || track.name || track.id || track.kind || track.translationLanguage);
  }

  async function ensureProbePlayer() {
    if (probePlayer) return probePlayer;
    await ytReady;

    if (probeReadyPromise) {
      await probeReadyPromise;
      return probePlayer;
    }

    probeReadyPromise = new Promise(resolve => {
      probeReadyResolve = resolve;
    });

    const host = document.createElement('div');
    host.id = 'captionProbePlayer';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position: 'fixed',
      left: '-10000px',
      top: '-10000px',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
      overflow: 'hidden'
    });
    document.body.appendChild(host);

    try {
      probePlayer = new YT.Player(host, {
        height: '2',
        width: '2',
        playerVars: {
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          rel: 0,
          iv_load_policy: 3,
          cc_load_policy: 1,
          origin: location.origin
        },
        events: {
          onReady: () => {
            probeReadyResolve?.();
            probeReadyResolve = null;
          },
          onError: () => {
            probeReadyResolve?.();
            probeReadyResolve = null;
          }
        }
      });
    } catch {
      probeReadyResolve?.();
      probeReadyResolve = null;
    }

    await Promise.race([probeReadyPromise, wait(3500)]);
    return probePlayer;
  }

  async function waitUntilLoaded(player, timeout = 4200) {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      try {
        const s = player.getPlayerState();
        if (
          s === YT.PlayerState.PLAYING ||
          s === YT.PlayerState.BUFFERING ||
          s === YT.PlayerState.PAUSED ||
          s === YT.PlayerState.CUED
        ) return true;
      } catch {}
      await wait(120);
    }
    return false;
  }

  function requestCaptions(player, prompt) {
    const languageCode = langFor(prompt);
    try { player.loadModule?.('captions'); } catch {}
    try { player.loadModule?.('cc'); } catch {}
    try { player.setOption('captions', 'track', { languageCode }); } catch {}
    try { player.setOption('cc', 'track', { languageCode }); } catch {}
  }

  async function readCaptionAvailability(player, prompt) {
    requestCaptions(player, prompt);

    // YouTube exposes caption information asynchronously and not always on the
    // first request. Retry without changing the visible player.
    for (const delay of [450, 750, 1000, 1300]) {
      await wait(delay);
      requestCaptions(player, prompt);

      let track = null, trackCc = null, list = null, listCc = null;
      try { track = player.getOption('captions', 'track'); } catch {}
      try { trackCc = player.getOption('cc', 'track'); } catch {}
      try { list = player.getOption('captions', 'tracklist'); } catch {}
      try { listCc = player.getOption('cc', 'tracklist'); } catch {}

      if (trackValid(track) || trackValid(trackCc) || trackValid(list) || trackValid(listCc)) {
        return true;
      }
    }
    return false;
  }

  async function hasRealCaptions(prompt) {
    if (customHasText(prompt)) return true;
    if (!prompt?.youtubeId) return false;

    const player = await ensureProbePlayer();
    if (!player) return false;

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

    const loaded = await waitUntilLoaded(player);
    if (!loaded) {
      try { player.stopVideo(); } catch {}
      return false;
    }

    const has = await readCaptionAvailability(player, prompt);
    try { player.stopVideo(); } catch {}
    return has;
  }

  function lockCurrentPrompt() {
    if (
      state?.phase === 'perform' &&
      state.currentPerformerId === me &&
      state.currentPrompt?.id
    ) {
      lockedPromptId = state.currentPrompt.id;
    }
  }

  // Lock the visible prompt as soon as the player expresses intent to listen.
  // A late caption-check result is no longer allowed to swap it underneath them.
  const listenBtn = $('#listenBtn');
  listenBtn?.addEventListener('pointerdown', lockCurrentPrompt, true);
  listenBtn?.addEventListener('touchstart', lockCurrentPrompt, { capture:true, passive:true });
  listenBtn?.addEventListener('click', lockCurrentPrompt, true);

  async function verifyCurrentPrompt(snapshot) {
    if (!snapshot || snapshot.phase !== 'perform') return;
    if (snapshot.currentPerformerId !== me) return;
    if (isRecording || hasListened || recordingBlob) return;

    const prompt = snapshot.currentPrompt;
    if (!prompt?.id) return;

    if (lastPromptId !== prompt.id) {
      lastPromptId = prompt.id;
      lockedPromptId = null;
    }

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

    if (checkingId === prompt.id) return;

    if (rejected.has(prompt.id)) {
      // This can only happen if the server sent the same rejected prompt again.
      if (lockedPromptId === prompt.id) return;
      socket.emit('reject-current-prompt', { promptId: prompt.id, reason:'missing-captions' }, () => {});
      return;
    }

    if (consecutiveRejects >= 25) {
      // Never strand the user with a button that changes songs forever.
      $('#listenBtn').disabled = false;
      $('#recordStatus').textContent = 'Non riesco a verificare altri sottotitoli: puoi ascoltare questa canzone senza che venga sostituita.';
      return;
    }

    checkingId = prompt.id;
    $('#listenBtn').disabled = true;
    $('#recordBtn').disabled = true;
    $('#recordStatus').textContent = 'Verifico i sottotitoli senza toccare il video principale…';

    let ok = false;
    try { ok = await hasRealCaptions(prompt); } catch { ok = false; }

    if (state?.currentPrompt?.id !== prompt.id || state?.phase !== 'perform') {
      checkingId = null;
      return;
    }

    // If the user has already started interacting with this prompt, NEVER replace it.
    if (lockedPromptId === prompt.id || hasListened || isRecording || recordingBlob) {
      checkingId = null;
      $('#listenBtn').disabled = false;
      $('#recordStatus').textContent = ok
        ? 'Sottotitoli verificati ✓'
        : 'Canzone bloccata: non verrà cambiata mentre la stai ascoltando.';
      if (ok) verified.add(prompt.id);
      cueSong('perform', prompt);
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
    $('#recordStatus').textContent = 'Questo video non ha sottotitoli verificabili. Cerco un altro prima che tu inizi…';

    socket.emit('reject-current-prompt', {
      promptId: prompt.id,
      reason: 'missing-captions'
    }, response => {
      if (!response?.ok && state?.currentPrompt?.id === prompt.id) {
        // If replacement fails, keep the current song playable instead of trapping the user.
        lockedPromptId = prompt.id;
        $('#listenBtn').disabled = false;
        $('#recordStatus').textContent = 'Non posso sostituire il brano: puoi ascoltare questo senza ulteriori cambi.';
      }
    });
  }

  socket.on('state', snapshot => {
    setTimeout(() => verifyCurrentPrompt(snapshot), 0);
  });

  socket.on('prompt-replaced', () => {
    checkingId = null;
    lockedPromptId = null;
    try { resetLocalRound(); } catch {}
    setTimeout(() => {
      try { render(); } catch {}
      verifyCurrentPrompt(state);
    }, 80);
  });

  // catalog-v2.js may load after the round state event has already arrived.
  // Verify the current prompt immediately as well.
  setTimeout(() => {
    try { verifyCurrentPrompt(state); } catch {}
  }, 0);
})();
