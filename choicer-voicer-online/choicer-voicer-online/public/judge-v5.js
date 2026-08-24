// Choicer Voicer AI Judge v5
// Similarity-first scoring. Cleanliness can only penalize unusable audio; it never raises the score.
(function () {
  const V4Analyze = analyzeRecording;

  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(v) || 0));

  analyzeRecording = async function (blob, prompt) {
    const result = await V4Analyze(blob, prompt);
    if (!result || result.score === null || result.available === false) return result;

    const metrics = result.metrics || {};
    const breakdown = { ...(result.breakdown || {}) };

    const reference = clamp(metrics.referenceSimilarity);
    const pitch = Number(metrics.referencePitch) >= 0
      ? clamp(metrics.referencePitch)
      : clamp(breakdown.intonation);
    const rhythm = Number.isFinite(Number(metrics.referenceRhythm))
      ? clamp(metrics.referenceRhythm)
      : clamp(breakdown.rhythm);
    const singing = Number.isFinite(Number(metrics.singingScore))
      ? clamp(metrics.singingScore)
      : clamp(breakdown.voice);
    const dynamics = Number.isFinite(Number(metrics.referenceEnergy))
      ? clamp(metrics.referenceEnergy)
      : clamp(breakdown.dynamics);
    const cleanliness = clamp(breakdown.cleanliness);

    const speechRecognized = Number(metrics.speechRecognized) === 1;
    const rawLyric = Number(metrics.lyricScore);
    const lyric = speechRecognized && rawLyric >= 0 ? clamp(rawLyric) : null;

    // Core score: actual resemblance dominates. Cleanliness contributes ZERO positive points.
    let final = reference * 0.40 + pitch * 0.25 + rhythm * 0.18 + singing * 0.12 + dynamics * 0.05;

    // Words are a gate and a modest positive signal when recognition is trustworthy.
    if (lyric !== null) final = final * 0.84 + lyric * 0.16;

    // Hard similarity gates: a clean recording that does not resemble the source cannot score high.
    if (reference < 18) final = Math.min(final, 3);
    else if (reference < 28) final = Math.min(final, 10);
    else if (reference < 38) final = Math.min(final, 22);
    else if (reference < 48) final = Math.min(final, 40);
    else if (reference < 58) final = Math.min(final, 58);

    // Melody / singing gates.
    if (singing < 15) final = Math.min(final, 2);
    else if (singing < 25) final = Math.min(final, 8);
    else if (singing < 35) final = Math.min(final, 20);
    else if (singing < 45) final = Math.min(final, 38);

    if (pitch < 18) final = Math.min(final, 8);
    else if (pitch < 30) final = Math.min(final, 20);
    else if (pitch < 42) final = Math.min(final, 38);

    // If the browser clearly recognizes the wrong words, similarity must collapse.
    if (lyric !== null) {
      if (lyric < 8) final = 0;
      else if (lyric < 18) final = Math.min(final, 5);
      else if (lyric < 30) final = Math.min(final, 14);
      else if (lyric < 45) final = Math.min(final, 30);
      else if (lyric < 58) final = Math.min(final, 52);
    }

    // Require several independent signals before allowing a genuinely high score.
    const strongSignals = [reference, pitch, rhythm, singing].filter(v => v >= 58).length;
    if (strongSignals === 0) final = Math.min(final, 35);
    else if (strongSignals === 1) final = Math.min(final, 58);
    if (reference < 62 || pitch < 50) final = Math.min(final, 68);

    // Cleanliness is only a DOWNWARD quality-control penalty.
    if (cleanliness < 8) final *= 0.45;
    else if (cleanliness < 18) final *= 0.62;
    else if (cleanliness < 30) final *= 0.80;

    final = Math.round(clamp(final));

    // Make the visible categories honest: they cannot look excellent when resemblance failed.
    breakdown.intonation = Math.min(clamp(breakdown.intonation), Math.round((pitch * 0.72 + reference * 0.28)));
    breakdown.rhythm = Math.min(clamp(breakdown.rhythm), Math.round((rhythm * 0.75 + reference * 0.25)));
    breakdown.voice = Math.min(clamp(breakdown.voice), Math.round((singing * 0.70 + reference * 0.30)));
    breakdown.dynamics = Math.min(clamp(breakdown.dynamics), Math.round((dynamics * 0.70 + reference * 0.30)));

    return {
      ...result,
      score: final,
      breakdown,
      reason: 'Voto basato soprattutto sulla somiglianza con il riferimento: melodia, ritmo, canto e contenuto. La pulizia non aggiunge punti.',
      metrics: {
        ...metrics,
        v5Reference: reference,
        v5Pitch: pitch,
        v5Rhythm: rhythm,
        v5Singing: singing,
        v5Lyric: lyric ?? -1,
        v5CleanlinessBonus: 0
      }
    };
  };

  const previousRender = renderResult;
  renderResult = function () {
    previousRender();
    const labels = [...document.querySelectorAll('#aiBreakdown .ai-row span')];
    const clean = labels.find(el => /^Pulizia$/i.test((el.textContent || '').trim()));
    if (clean) clean.textContent = 'Pulizia audio (non dà punti)';

    const note = $('#aiResultNote');
    if (note && state?.lastResult?.aiUsed !== false && state?.lastResult?.aiScore != null) {
      note.textContent = 'IA: la pulizia serve solo a capire se l’audio è utilizzabile. Il voto sale per somiglianza, intonazione, ritmo, canto e parole.';
    }
  };
})();
