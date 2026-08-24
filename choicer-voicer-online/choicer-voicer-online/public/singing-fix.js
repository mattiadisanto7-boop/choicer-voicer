// Choicer Voicer: muted-video recording + stricter singing/content judge.
(function () {
  const BaseAnalyze = analyzeRecording;
  let speechRec = null;
  let speechTranscript = '';
  let speechSupported = false;
  let speechHadResult = false;
  let speechStopPromise = null;
  let speechStopResolve = null;

  function speechLang(prompt) {
    if (prompt?.language === 'IT') return 'it-IT';
    if (prompt?.language === 'ES') return 'es-ES';
    if (prompt?.language === 'KO') return 'ko-KR';
    return 'en-US';
  }

  function startSpeechCheck(prompt) {
    speechTranscript = '';
    speechHadResult = false;
    speechRec = null;
    speechStopPromise = null;
    speechStopResolve = null;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechSupported = !!SR;
    if (!SR) return;

    try {
      const rec = new SR();
      speechRec = rec;
      rec.lang = speechLang(prompt);
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = event => {
        let text = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const part = event.results[i]?.[0]?.transcript || '';
          if (part) text += ' ' + part;
        }
        if (text.trim()) {
          speechHadResult = true;
          speechTranscript = (speechTranscript + ' ' + text).trim();
        }
      };
      rec.onerror = () => {};
      rec.onend = () => {
        if (speechStopResolve) speechStopResolve();
        speechStopResolve = null;
      };
      rec.start();
    } catch {
      speechRec = null;
    }
  }

  async function finishSpeechCheck() {
    if (!speechRec) return;
    if (!speechStopPromise) {
      speechStopPromise = new Promise(resolve => {
        speechStopResolve = resolve;
        try { speechRec.stop(); }
        catch { resolve(); speechStopResolve = null; }
        setTimeout(() => {
          if (speechStopResolve) speechStopResolve();
          speechStopResolve = null;
        }, 650);
      });
    }
    await speechStopPromise.catch(() => {});
    await sleep(80);
  }

  function normalizeWords(text) {
    return String(text || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map(x => x.replace(/^'+|'+$/g, ''))
      .filter(x => x.length > 1);
  }

  function lyricMatchScore(expectedText, heardText) {
    const expected = normalizeWords(expectedText);
    const heard = normalizeWords(heardText);
    if (!expected.length || !heard.length) return null;

    const stop = new Set(['the','a','an','and','or','to','of','in','on','it','i','you','me','my','your','is','are','be','do','not','non','che','di','e','a','il','la','lo','un','una','mi','ti','io','tu','per','con']);
    const keyExpected = expected.filter(w => !stop.has(w));
    const target = keyExpected.length >= 2 ? keyExpected : expected;
    const heardSet = new Set(heard);
    const hits = target.filter(w => heardSet.has(w)).length;
    const recall = hits / Math.max(1, target.length);

    let orderedHits = 0;
    let pos = 0;
    for (const word of target) {
      const idx = heard.indexOf(word, pos);
      if (idx >= 0) { orderedHits++; pos = idx + 1; }
    }
    const order = orderedHits / Math.max(1, target.length);
    return Math.round((recall * 0.72 + order * 0.28) * 100);
  }

  async function singingEvidence(blob) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const decoded = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const src = decoded.getChannelData(0);
    const sr = decoded.sampleRate;
    await ctx.close().catch(() => {});

    const targetSr = 8000;
    const stride = Math.max(1, Math.round(sr / targetSr));
    const dsRate = sr / stride;
    const n = Math.floor(src.length / stride);
    const data = new Float32Array(n);
    let sq = 0;
    for (let i = 0, j = 0; i < n; i++, j += stride) {
      const v = src[j] || 0;
      data[i] = v;
      sq += v * v;
    }
    const globalRms = Math.sqrt(sq / Math.max(1, n));
    if (globalRms < 0.004) return { score: 0, coverage: 0, stability: 0, harmonicity: 0, range: 0 };

    const frameSize = Math.max(256, Math.round(dsRate * 0.05));
    const hop = Math.max(128, Math.round(dsRate * 0.025));
    const pitches = [];
    const confs = [];
    let voicedFrames = 0;

    for (let pos = 0; pos + frameSize < data.length; pos += hop) {
      const frame = data.subarray(pos, pos + frameSize);
      let e = 0;
      for (let i = 0; i < frame.length; i++) e += frame[i] * frame[i];
      const rms = Math.sqrt(e / frame.length);
      if (rms < Math.max(0.005, globalRms * 0.24)) {
        pitches.push(0); confs.push(0); continue;
      }
      voicedFrames++;

      const minLag = Math.max(2, Math.floor(dsRate / 700));
      const maxLag = Math.min(frame.length - 2, Math.floor(dsRate / 80));
      let best = 0, bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let num = 0, a = 0, b = 0;
        const len = frame.length - lag;
        for (let i = 0; i < len; i += 2) {
          const x = frame[i], y = frame[i + lag];
          num += x * y; a += x * x; b += y * y;
        }
        const c = num / Math.sqrt(a * b + 1e-12);
        if (c > best) { best = c; bestLag = lag; }
      }
      const pitch = best > 0.47 && bestLag ? dsRate / bestLag : 0;
      pitches.push(pitch >= 80 && pitch <= 700 ? pitch : 0);
      confs.push(pitch ? best : 0);
    }

    const valid = pitches.filter(Boolean);
    if (!valid.length) return { score: 0, coverage: 0, stability: 0, harmonicity: 0, range: 0 };
    const coverage = valid.length / Math.max(1, pitches.length);
    const harmonicity = confs.filter(Boolean).reduce((s, x) => s + x, 0) / Math.max(1, confs.filter(Boolean).length);

    const sorted = [...valid].sort((a,b)=>a-b);
    const med = sorted[Math.floor(sorted.length / 2)] || valid[0];
    const semis = valid.map(x => 12 * Math.log2(x / med));
    const meanSemi = semis.reduce((s,x)=>s+x,0) / semis.length;
    const variance = semis.reduce((s,x)=>s+(x-meanSemi)*(x-meanSemi),0) / semis.length;
    const range = Math.sqrt(variance);

    let stable = 0, transitions = 0, run = 0, maxRun = 0;
    for (let i = 1; i < pitches.length; i++) {
      if (pitches[i] && pitches[i-1]) {
        transitions++;
        const diff = Math.abs(12 * Math.log2(pitches[i] / pitches[i-1]));
        if (diff < 0.55) { stable++; run++; maxRun = Math.max(maxRun, run); }
        else run = 0;
      } else run = 0;
    }
    const stability = stable / Math.max(1, transitions);
    const sustain = Math.min(1, maxRun / 8);
    const melody = Math.min(1, range / 2.2);
    const harmonicScore = Math.max(0, Math.min(1, (harmonicity - 0.42) / 0.38));
    const coverageScore = Math.min(1, coverage / 0.62);
    const score = Math.round(100 * (harmonicScore * 0.28 + stability * 0.26 + sustain * 0.18 + melody * 0.16 + coverageScore * 0.12));
    return { score: Math.max(0, Math.min(100, score)), coverage, stability, harmonicity, range };
  }

  async function playSilentSongWhileRecording(prompt) {
    if (!prompt?.youtubeId) return;
    await ytReady;
    const pl = performPlayer;
    stopPlayer('perform');
    playback.perform = {
      started: false,
      prompt,
      durationMs: durationOf(prompt) * 1000,
      audio: null,
      timer: null,
      onEnd: () => stopRecording()
    };
    try {
      pl.mute();
      pl.loadVideoById({ videoId: prompt.youtubeId, startSeconds: Number(prompt.start)||0, endSeconds: Number(prompt.end)||10 });
      tryCaptions(pl, prompt);
    } catch {
      // Recording continues with the safety timer even if YouTube fails.
    }
  }

  // Make stopping always stop video + speech as well.
  stopRecording = function () {
    clearTimeout(recordTimer); recordTimer = null;
    try { speechRec?.stop(); } catch {}
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.requestData(); } catch {}
      try { mediaRecorder.stop(); } catch {}
    }
    mediaStream?.getTracks().forEach(t => t.stop());
    mediaStream = null;
    try { playerFor('perform')?.pauseVideo(); } catch {}
  };

  // During imitation the same clip now runs muted, with captions visible.
  const recordBtn = $('#recordBtn');
  if (recordBtn) recordBtn.onclick = async () => {
    if (!hasListened || isRecording || state?.phase !== 'perform' || state.currentPerformerId !== me) return;
    stopPlayer('perform');
    recordBtn.disabled = true;
    $('#listenBtn').disabled = true;
    $('#micHelpBtn').classList.add('hidden');
    $('#micHelp').classList.add('hidden');
    $('#recordStatus').textContent = 'Richiedo accesso al microfono…';

    try { mediaStream = await acquireMicrophone(); }
    catch (err) {
      recordBtn.disabled = false;
      $('#listenBtn').disabled = false;
      const msg = err?.name === 'NotAllowedError' ? 'Permesso microfono negato.' : (err?.message || 'Impossibile usare il microfono.');
      $('#recordStatus').textContent = msg;
      showMicHelp(msg);
      return;
    }

    await countdown();
    const mime = bestMimeType();
    try { mediaRecorder = mime ? new MediaRecorder(mediaStream, { mimeType:mime }) : new MediaRecorder(mediaStream); }
    catch {
      mediaStream.getTracks().forEach(t=>t.stop()); mediaStream = null;
      recordBtn.disabled = false; $('#listenBtn').disabled = false;
      showMicHelp('Il browser non riesce a creare la registrazione audio.');
      return;
    }

    chunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onerror = () => toast('Errore durante la registrazione.');
    mediaRecorder.onstop = finishRecording;

    try { mediaRecorder.start(250); }
    catch {
      mediaStream.getTracks().forEach(t=>t.stop()); mediaStream = null;
      recordBtn.disabled = false; $('#listenBtn').disabled = false;
      showMicHelp('La registrazione non è riuscita ad avviarsi.');
      return;
    }

    startSpeechCheck(state.currentPrompt);
    isRecording = true;
    const ms = durationOf(state.currentPrompt) * 1000;
    recordBtn.classList.add('recording');
    $('#recordStatus').textContent = 'REC • Il video è muto: canta seguendo immagini e sottotitoli';
    startProgress(ms);
    recordTimer = setTimeout(stopRecording, ms + 900);
    playSilentSongWhileRecording(state.currentPrompt);
  };

  // Stricter judge: base DSP + singing evidence + word match when browser recognition works.
  analyzeRecording = async function (blob, prompt) {
    await finishSpeechCheck();
    const base = await BaseAnalyze(blob, prompt);
    let singing;
    try { singing = await singingEvidence(blob); }
    catch { singing = { score: 35 }; }

    const lyricScore = speechHadResult ? lyricMatchScore(prompt?.lyricCue, speechTranscript) : null;
    const baseScore = Math.max(0, Math.min(100, Number(base?.score) || 0));
    const singingScore = Math.max(0, Math.min(100, Number(singing?.score) || 0));

    // Speaking instead of singing must no longer earn a normal score.
    let final = baseScore * 0.48 + singingScore * 0.52;

    if (singingScore < 18) final = Math.min(final, 8);
    else if (singingScore < 30) final = Math.min(final, 18);
    else if (singingScore < 42) final = Math.min(final, 35);

    // If speech recognition clearly heard different words, apply a very strong content penalty.
    if (lyricScore !== null) {
      if (lyricScore < 8) final = Math.min(final, 3);
      else if (lyricScore < 20) final = Math.min(final, 10);
      else if (lyricScore < 35) final = Math.min(final, 25);
      else if (lyricScore < 50) final = Math.min(final, 45);
      else final = final * 0.72 + lyricScore * 0.28;
    }

    final = Math.max(0, Math.min(100, Math.round(final)));
    const ratio = baseScore > 0 ? Math.min(1, final / baseScore) : 0;
    const breakdown = { ...(base?.breakdown || {}) };
    for (const key of Object.keys(breakdown)) {
      breakdown[key] = Math.round(Math.max(0, Math.min(100, Number(breakdown[key]) || 0)) * Math.max(0.15, ratio));
    }
    // Make the visible diagnostics reflect obvious non-singing/content failures.
    if (singingScore < 35) {
      breakdown.intonation = Math.min(breakdown.intonation ?? 100, singingScore);
      breakdown.voice = Math.min(breakdown.voice ?? 100, singingScore);
    }
    if (lyricScore !== null && lyricScore < 35) {
      breakdown.rhythm = Math.min(breakdown.rhythm ?? 100, Math.max(3, lyricScore));
      breakdown.voice = Math.min(breakdown.voice ?? 100, Math.max(3, lyricScore));
    }

    console.info('[Choicer AI]', {
      base: baseScore,
      singing: singingScore,
      lyricMatch: lyricScore,
      transcript: speechHadResult ? speechTranscript : '(not available)',
      speechSupported,
      final
    });

    return {
      ...base,
      score: final,
      breakdown,
      metrics: {
        ...(base?.metrics || {}),
        singingScore,
        lyricScore: lyricScore ?? -1,
        speechRecognized: speechHadResult ? 1 : 0
      }
    };
  };
})();
