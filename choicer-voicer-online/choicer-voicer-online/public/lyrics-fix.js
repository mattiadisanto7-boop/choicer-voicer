// Lyrics/captions reliability patch.
(function () {
  const langFor = p => p?.language === 'IT' ? 'it' : p?.language === 'ES' ? 'es' : p?.language === 'KO' ? 'ko' : 'en';

  try {
    setLyrics = function (el, p) {
      if (!el) return;
      const text = p?.custom ? String(p?.lyricCue || '').trim() : '';
      el.textContent = text;
      el.classList.toggle('hidden', !text);
      const hint = el.parentElement?.querySelector('.captions-hint');
      if (hint) hint.textContent = p?.custom && text
        ? 'Testo inserito dall’host'
        : 'CC YouTube: il brano viene accettato solo se verificati';
    };
  } catch {}

  try {
    tryCaptions = function (player, prompt) {
      if (!player) return;
      const languageCode = langFor(prompt);
      [100, 420, 850, 1500, 2400].forEach(delay => {
        setTimeout(() => {
          try { player.loadModule?.('captions'); } catch {}
          try { player.loadModule?.('cc'); } catch {}
          try { player.setOption('captions', 'track', { languageCode }); } catch {}
          try { player.setOption('cc', 'track', { languageCode }); } catch {}
          try { player.setOption('captions', 'fontSize', 1); } catch {}
          try { player.setOption('cc', 'fontSize', 1); } catch {}
        }, delay);
      });
    };
  } catch {}

  const patchedInit = function () {
    try {
      if (performPlayer || judgePlayer) return;
      let readyCount = 0;
      const onReady = () => { readyCount++; if (readyCount === 2) ytResolve(); };
      const make = (id, key) => new YT.Player(id, {
        height: '100%', width: '100%',
        playerVars: {
          controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0,
          iv_load_policy: 3, cc_load_policy: 1, origin: location.origin
        },
        events: {
          onReady,
          onError: () => toast('Questo video YouTube non è riproducibile qui.'),
          onStateChange: e => handlePlayerState(key, e)
        }
      });
      performPlayer = make('songPlayer', 'perform');
      judgePlayer = make('judgeSongPlayer', 'judge');
    } catch (e) {
      console.warn('Caption patch init failed', e);
    }
  };

  try {
    if (!window.YT?.Player && !performPlayer && !judgePlayer) {
      initYouTubePlayers = patchedInit;
      window.onYouTubeIframeAPIReady = patchedInit;
    }
  } catch {}

  const style = document.createElement('style');
  style.textContent = `.captions-hint{position:absolute!important;top:8px!important;left:8px!important;bottom:auto!important;z-index:5!important;max-width:78%;padding:5px 8px;border-radius:8px;background:rgba(0,0,0,.62);color:#fff;font-size:.72rem;line-height:1.15;pointer-events:none}.lyrics-overlay.hidden{display:none!important}`;
  document.head.appendChild(style);

  function loadPatch(src) {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    document.body.appendChild(s);
  }

  // The base page already loads singing-fix.js and judge-v4.js. Load the new layers only after both are ready.
  window.addEventListener('load', () => {
    loadPatch('/catalog-v2.js');
    loadPatch('/judge-v5.js');

    document.querySelectorAll('.captions-hint').forEach(el => {
      el.textContent = 'Solo brani con sottotitoli verificati';
    });
  });
})();
