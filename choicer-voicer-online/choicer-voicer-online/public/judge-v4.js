// Choicer Voicer AI Judge v4
// Conservative design: capture a temporary acoustic reference while the original plays,
// compare the imitation against it, and refuse to invent an AI score when confidence is low.
(function () {
  const PreviousAnalyze = analyzeRecording;

  let referenceBlob = null;
  let referenceSignature = null;
  let referenceStatus = 'none'; // none | capturing | ready | weak | unavailable
  let referenceMessage = '';
  let referenceRecorder = null;
  let referenceStream = null;
  let referenceChunks = [];
  let referenceStopPromise = null;
  let referenceStopResolve = null;

  function clamp(v, lo = 0, hi = 100) {
    return Math.max(lo, Math.min(hi, Number(v) || 0));
  }

  function median(values) {
    if (!values.length) return 0;
    const x = [...values].sort((a, b) => a - b);
    const m = Math.floor(x.length / 2);
    return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
  }

  function mean(values) {
    return values.length ? values.reduce((s, x) => s + x, 0) / values.length : 0;
  }

  function std(values, m = mean(values)) {
    return values.length ? Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length) : 0;
  }

  function pearson(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 4) return 0;
    const aa = a.slice(0, n), bb = b.slice(0, n);
    const ma = mean(aa), mb = mean(bb);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const x = aa[i] - ma, y = bb[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    if (da < 1e-9 || db < 1e-9) return 0;
    return Math.max(-1, Math.min(1, num / Math.sqrt(da * db)));
  }

  function resample(values, count = 48) {
    if (!values.length) return Array(count).fill(0);
    if (values.length === 1) return Array(count).fill(values[0]);
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = (i / (count - 1)) * (values.length - 1);
      const a = Math.floor(p), b = Math.min(values.length - 1, a + 1), t = p - a;
      out.push(values[a] * (1 - t) + values[b] * t);
    }
    return out;
  }

  function normalizeEnvelope(values) {
    const m = mean(values), s = std(values, m) || 1;
    return values.map(v => Math.max(-3, Math.min(3, (v - m) / s)));
  }

  function estimatePitch(frame, sr) {
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    if (energy / frame.length < 0.00005) return { hz: 0, conf: 0 };

    const minLag = Math.max(2, Math.floor(sr / 700));
    const maxLag = Math.min(frame.length - 2, Math.floor(sr / 75));
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag += 2) {
      let num = 0, a = 0, b = 0;
      const n = frame.length - lag;
      for (let i = 0; i < n; i += 2) {
        const x = frame[i], y = frame[i + lag];
        num += x * y; a += x * x; b += y * y;
      }
      const c = num / Math.sqrt(a * b + 1e-12);
      if (c > best) { best = c; bestLag = lag; }
    }
    const hz = best > 0.42 && bestLag ? sr / bestLag : 0;
    return { hz: hz >= 75 && hz <= 700 ? hz : 0, conf: best };
  }

  async function signatureFromBlob(blob) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio non disponibile');
    const ctx = new AC();
    const decoded = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const src = decoded.getChannelData(0);
    const sr = decoded.sampleRate;
    await ctx.close().catch(() => {});

    const targetRate = 8000;
    const stride = Math.max(1, Math.round(sr / targetRate));
    const rate = sr / stride;
    const n = Math.floor(src.length / stride);
    const data = new Float32Array(n);
    let totalSq = 0, peak = 0;
    for (let i = 0, j = 0; i < n; i++, j += stride) {
      const v = src[j] || 0;
      data[i] = v;
      totalSq += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const globalRms = Math.sqrt(totalSq / Math.max(1, n));

    const frameSize = Math.max(320, Math.round(rate * 0.08));
    const hop = Math.max(160, Math.round(rate * 0.04));
    const energies = [], zcrs = [], pitches = [], pitchConfs = [];

    for (let pos = 0; pos + frameSize <= data.length; pos += hop) {
      const frame = data.subarray(pos, pos + frameSize);
      let sq = 0, crossings = 0;
      for (let i = 0; i < frame.length; i++) {
        const v = frame[i]; sq += v * v;
        if (i && ((v >= 0) !== (frame[i - 1] >= 0))) crossings++;
      }
      const rms = Math.sqrt(sq / frame.length);
      energies.push(rms);
      zcrs.push(crossings / frame.length);
      const pitch = estimatePitch(frame, rate);
      pitches.push(pitch.hz);
      pitchConfs.push(pitch.conf);
    }

    const activeThreshold = Math.max(0.0035, globalRms * 0.23);
    const activeRatio = energies.filter(x => x > activeThreshold).length / Math.max(1, energies.length);
    const validPitches = pitches.filter(Boolean);
    const medianPitch = median(validPitches);
    const pitchRelative = pitches.map(hz => hz && medianPitch ? 12 * Math.log2(hz / medianPitch) : NaN);
    const pitchCoverage = validPitches.length / Math.max(1, pitches.length);
    const harmonicity = mean(pitchConfs.filter((c, i) => pitches[i] && c > 0));

    const energyEnv = resample(normalizeEnvelope(energies), 48);
    const onsetRaw = energies.map((x, i) => i ? Math.max(0, x - energies[i - 1]) : 0);
    const onsetEnv = resample(normalizeEnvelope(onsetRaw), 48);
    const zcrEnv = resample(normalizeEnvelope(zcrs), 48);

    // Interpolate pitch only where each local region has a usable estimate.
    const pitchEnv = [];
    for (let bin = 0; bin < 48; bin++) {
      const from = Math.floor((bin / 48) * pitchRelative.length);
      const to = Math.max(from + 1, Math.floor(((bin + 1) / 48) * pitchRelative.length));
      const vals = pitchRelative.slice(from, to).filter(Number.isFinite);
      pitchEnv.push(vals.length ? median(vals) : NaN);
    }

    return {
      duration: decoded.duration,
      globalRms,
      peak,
      activeRatio,
      pitchCoverage,
      harmonicity,
      energyEnv,
      onsetEnv,
      zcrEnv,
      pitchEnv
    };
  }

  function referenceQuality(sig) {
    if (!sig) return 0;
    const loud = Math.min(1, Math.max(0, (sig.globalRms - 0.004) / 0.035));
    const active = Math.min(1, sig.activeRatio / 0.60);
    const pitched = Math.min(1, sig.pitchCoverage / 0.42);
    const harmonic = Math.min(1, Math.max(0, (sig.harmonicity - 0.35) / 0.35));
    return loud * 0.35 + active * 0.30 + pitched * 0.20 + harmonic * 0.15;
  }

  function pitchSimilarity(a, b) {
    const diffs = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
        // Relative pitch contour: octave errors are less severe than completely unrelated contours.
        let d = Math.abs(a[i] - b[i]);
        d = Math.min(d, Math.abs(d - 12), Math.abs(d - 24));
        diffs.push(Math.min(12, d));
      }
    }
    if (diffs.length < 8) return null;
    const mae = mean(diffs);
    return Math.max(0, Math.min(100, 100 * Math.exp(-mae / 4.2)));
  }

  function compareSignatures(ref, user, prompt) {
    const energy = clamp(((pearson(ref.energyEnv, user.energyEnv) + 1) / 2) * 100);
    const onset = clamp(((pearson(ref.onsetEnv, user.onsetEnv) + 1) / 2) * 100);
    const zcr = clamp(((pearson(ref.zcrEnv, user.zcrEnv) + 1) / 2) * 100);
    const pitch = pitchSimilarity(ref.pitchEnv, user.pitchEnv);
    const expected = durationOf(prompt);
    const duration = clamp(100 - Math.abs(user.duration - expected) / Math.max(1, expected) * 180);

    const weighted = [];
    weighted.push([energy, 0.28], [onset, 0.24], [zcr, 0.10], [duration, 0.08]);
    if (pitch !== null) weighted.push([pitch, 0.30]);
    else weighted.push([0, 0.30]);

    const totalW = weighted.reduce((s, x) => s + x[1], 0);
    const score = weighted.reduce((s, x) => s + x[0] * x[1], 0) / totalW;
    return { score: Math.round(clamp(score)), energy:Math.round(energy), onset:Math.round(onset), zcr:Math.round(zcr), pitch:pitch === null ? null : Math.round(pitch), duration:Math.round(duration) };
  }

  async function startReferenceCapture() {
    referenceBlob = null;
    referenceSignature = null;
    referenceStatus = 'capturing';
    referenceMessage = '';
    referenceChunks = [];
    referenceStopPromise = null;
    referenceStopResolve = null;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      referenceStatus = 'unavailable';
      referenceMessage = 'Il browser non può creare il riferimento audio.';
      return false;
    }

    try {
      referenceStream = await navigator.mediaDevices.getUserMedia({
        audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false },
        video:false
      });
      const mime = bestMimeType();
      referenceRecorder = mime ? new MediaRecorder(referenceStream, { mimeType:mime }) : new MediaRecorder(referenceStream);
      referenceRecorder.ondataavailable = e => { if (e.data && e.data.size) referenceChunks.push(e.data); };
      referenceRecorder.onstop = async () => {
        try {
          const type = referenceRecorder?.mimeType || referenceChunks[0]?.type || 'audio/webm';
          referenceBlob = new Blob(referenceChunks, { type });
          if (referenceBlob.size < 700) throw new Error('riferimento vuoto');
          referenceSignature = await signatureFromBlob(referenceBlob);
          const q = referenceQuality(referenceSignature);
          if (q < 0.44) {
            referenceStatus = 'weak';
            referenceMessage = 'Il telefono non ha sentito abbastanza bene l’originale. Il voto IA verrà disattivato per questo round.';
          } else {
            referenceStatus = 'ready';
            referenceMessage = 'Riferimento IA acquisito.';
          }
        } catch {
          referenceStatus = 'weak';
          referenceMessage = 'Riferimento originale non abbastanza affidabile.';
        }
        if (referenceStopResolve) referenceStopResolve();
        referenceStopResolve = null;
      };
      referenceRecorder.start(200);
      return true;
    } catch {
      referenceStatus = 'unavailable';
      referenceMessage = 'Permesso microfono non disponibile durante l’ascolto. L’IA non inventerà un voto.';
      referenceStream?.getTracks().forEach(t => t.stop());
      referenceStream = null;
      return false;
    }
  }

  async function stopReferenceCapture() {
    if (!referenceRecorder || referenceRecorder.state === 'inactive') {
      referenceStream?.getTracks().forEach(t => t.stop());
      referenceStream = null;
      return;
    }
    referenceStopPromise = new Promise(resolve => { referenceStopResolve = resolve; });
    try { referenceRecorder.requestData(); } catch {}
    try { referenceRecorder.stop(); } catch { referenceStopResolve?.(); }
    referenceStream?.getTracks().forEach(t => t.stop());
    referenceStream = null;
    await Promise.race([referenceStopPromise, sleep(1200)]).catch(() => {});
  }

  // Replace the listen step: while the real clip plays, capture a private temporary reference.
  const listenBtn = $('#listenBtn');
  if (listenBtn) listenBtn.onclick = async () => {
    if (state?.phase !== 'perform' || state.currentPerformerId !== me || isRecording) return;
    const p = state.currentPrompt;
    listenBtn.disabled = true;
    $('#recordBtn').disabled = true;
    $('#recordStatus').textContent = 'Preparazione giudice IA… tieni il telefono in vivavoce e non parlare durante l’originale.';

    await startReferenceCapture();
    $('#recordStatus').textContent = 'Ascolta l’originale. Sto creando il riferimento per confrontare davvero la tua imitazione.';

    await playSong('perform', p, {
      onEnd: async () => {
        await stopReferenceCapture();
        hasListened = true;
        listenBtn.disabled = false;
        $('#recordBtn').disabled = false;
        if (referenceStatus === 'ready') {
          $('#recordStatus').textContent = `Riferimento IA pronto ✓ Ora imita per ${durationOf(p)} secondi.`;
        } else {
          $('#recordStatus').textContent = `${referenceMessage} Puoi comunque giocare: conterà il voto dell’avversario.`;
        }
        beep('turn');
        cueSong('perform', p);
      }
    });
  };

  // Rebuild the automatic score around actual reference similarity.
  analyzeRecording = async function (blob, prompt) {
    let strict;
    try { strict = await PreviousAnalyze(blob, prompt); }
    catch { strict = { score:null, breakdown:{}, metrics:{} }; }

    if (referenceStatus !== 'ready' || !referenceSignature) {
      return {
        score:null,
        available:false,
        reason: referenceMessage || 'Riferimento originale non disponibile.',
        breakdown: strict?.breakdown || {},
        metrics:{ ...(strict?.metrics || {}), referenceAvailable:0 }
      };
    }

    let userSignature;
    try { userSignature = await signatureFromBlob(blob); }
    catch {
      return { score:null, available:false, reason:'Non riesco ad analizzare la registrazione.', breakdown:strict?.breakdown||{}, metrics:strict?.metrics||{} };
    }

    const quality = referenceQuality(referenceSignature);
    const comparison = compareSignatures(referenceSignature, userSignature, prompt);
    const strictScore = Number.isFinite(Number(strict?.score)) ? clamp(strict.score) : null;
    const singingScore = Number(strict?.metrics?.singingScore);
    const lyricScoreRaw = Number(strict?.metrics?.lyricScore);
    const speechRecognized = Number(strict?.metrics?.speechRecognized) === 1;
    const lyricScore = speechRecognized && lyricScoreRaw >= 0 ? clamp(lyricScoreRaw) : null;

    // Conservative confidence: without either recognized words or a strong acoustic match,
    // refuse to generate a pseudo-scientific score.
    const contentEvidence = lyricScore !== null;
    if (!contentEvidence && comparison.score < 48) {
      return {
        score:null,
        available:false,
        reason:'Il confronto non è abbastanza sicuro per dare un voto IA. Userò solo il voto dell’avversario.',
        breakdown:strict?.breakdown||{},
        metrics:{ ...(strict?.metrics||{}), referenceAvailable:1, referenceSimilarity:comparison.score, referenceQuality:+quality.toFixed(2) }
      };
    }

    let final = comparison.score * 0.55 + (strictScore ?? comparison.score) * 0.45;

    // Hard anti-cheat / anti-nonsense gates.
    if (Number.isFinite(singingScore)) {
      if (singingScore < 18) final = Math.min(final, 3);
      else if (singingScore < 30) final = Math.min(final, 10);
      else if (singingScore < 42) final = Math.min(final, 24);
    }
    if (lyricScore !== null) {
      if (lyricScore < 8) final = 0;
      else if (lyricScore < 20) final = Math.min(final, 5);
      else if (lyricScore < 35) final = Math.min(final, 18);
      else if (lyricScore < 50) final = Math.min(final, 38);
      else final = final * 0.80 + lyricScore * 0.20;
    }
    if (comparison.score < 18) final = Math.min(final, 4);
    else if (comparison.score < 28) final = Math.min(final, 12);
    else if (comparison.score < 38) final = Math.min(final, 28);

    final = Math.round(clamp(final));

    const breakdown = { ...(strict?.breakdown || {}) };
    if ('intonation' in breakdown && comparison.pitch !== null) breakdown.intonation = Math.round((clamp(breakdown.intonation) + comparison.pitch) / 2);
    if ('rhythm' in breakdown) breakdown.rhythm = Math.round((clamp(breakdown.rhythm) + comparison.onset) / 2);
    if ('dynamics' in breakdown) breakdown.dynamics = Math.round((clamp(breakdown.dynamics) + comparison.energy) / 2);

    return {
      ...strict,
      score:final,
      available:true,
      reason:'Confronto effettuato con il riferimento originale acquisito durante l’ascolto.',
      breakdown,
      metrics:{
        ...(strict?.metrics || {}),
        referenceAvailable:1,
        referenceSimilarity:comparison.score,
        referencePitch:comparison.pitch ?? -1,
        referenceRhythm:comparison.onset,
        referenceEnergy:comparison.energy,
        referenceQuality:+quality.toFixed(2)
      }
    };
  };

  // Make the result screen honest when AI confidence was insufficient.
  const PreviousRenderResult = renderResult;
  renderResult = function () {
    PreviousRenderResult();
    const r = state?.lastResult;
    if (!r) return;
    const aiEl = $('#aiScore');
    const note = $('#aiResultNote');
    if (r.aiScore === null || r.aiScore === undefined || r.aiUsed === false) {
      if (aiEl) aiEl.textContent = 'N/D';
      if (note) note.textContent = 'IA non usata: riferimento non abbastanza affidabile. Il punteggio del round deriva solo dall’avversario.';
      const box = $('#aiBreakdown');
      if (box) box.innerHTML = '<p class="hint">Nessun voto automatico inventato: analisi non sufficientemente affidabile.</p>';
    } else if (note) {
      note.textContent = 'IA usata: confronto con un riferimento dell’originale acquisito sul dispositivo.';
    }
  };

  const oldReset = resetLocalRound;
  resetLocalRound = function () {
    referenceBlob = null;
    referenceSignature = null;
    referenceStatus = 'none';
    referenceMessage = '';
    referenceChunks = [];
    try { referenceRecorder?.stop(); } catch {}
    referenceStream?.getTracks().forEach(t => t.stop());
    referenceStream = null;
    oldReset();
  };

  window.addEventListener('beforeunload', () => {
    referenceStream?.getTracks().forEach(t => t.stop());
  });
})();