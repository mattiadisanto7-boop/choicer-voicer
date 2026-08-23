const socket = io();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let me = null;
let state = null;
let ready = false;
let selectedJudge = null;
let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let recordingBlob = null;
let soundOn = true;
let hasListened = false;
let maxRecordTimer = null;

function showScreen(id) {
  $$('.screen').forEach(x => x.classList.remove('active'));
  $('#' + id).classList.add('active');
}
function showPhase(id) {
  ['phasePerform','phaseJudge','phaseResult','phaseFinished'].forEach(x => $('#' + x).classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
function beep(type='tap') {
  if (!soundOn) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = type === 'turn' ? [440, 660] : type === 'win' ? [523,659,784] : [520];
    notes.forEach((f,i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(.0001, now + i*.11);
      gain.gain.exponentialRampToValueAtTime(.09, now + i*.11 + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, now + i*.11 + .12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i*.11);
      osc.stop(now + i*.11 + .14);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {}
}

function normalizeCode(v){ return v.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5); }
function youtubeEmbedUrl(prompt, autoplay=false) {
  if (!prompt?.youtubeId) return '';
  const params = new URLSearchParams({
    rel: '0',
    playsinline: '1',
    modestbranding: '1',
    autoplay: autoplay ? '1' : '0'
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(prompt.youtubeId)}?${params}`;
}
function setYoutubeFrame(frame, prompt, autoplay=false) {
  const url = youtubeEmbedUrl(prompt, autoplay);
  if (url && frame.src !== url) frame.src = url;
}

$('#roomInput').addEventListener('input', e => e.target.value = normalizeCode(e.target.value));

$('#createBtn').onclick = () => {
  $('#homeError').textContent='';
  socket.emit('create-room', { name: $('#nameInput').value }, r => {
    if (!r.ok) return $('#homeError').textContent = r.error || 'Errore.';
    me = r.playerId;
    showScreen('lobby');
  });
};
$('#joinBtn').onclick = () => {
  $('#homeError').textContent='';
  socket.emit('join-room', { code: normalizeCode($('#roomInput').value), name: $('#nameInput').value }, r => {
    if (!r.ok) return $('#homeError').textContent = r.error || 'Errore.';
    me = r.playerId;
    showScreen('lobby');
  });
};
$('#leaveBtn').onclick = () => location.reload();
$('#copyCode').onclick = async () => {
  if (!state) return;
  await navigator.clipboard?.writeText(state.code);
  toast('Codice copiato');
};
$('#readyBtn').onclick = () => {
  ready = !ready;
  socket.emit('set-ready',{ready});
};
$('#roundsSelect').onchange = e => socket.emit('update-settings',{rounds:Number(e.target.value)});
$('#startBtn').onclick = () => socket.emit('start-game');
$('#muteBtn').onclick = () => {
  soundOn=!soundOn;
  $('#muteBtn').textContent=soundOn?'🔊':'🔇';
};
$('#rematchBtn').onclick = () => socket.emit('rematch');

$('#addClipBtn').onclick = () => {
  const movie = $('#customMovie').value.trim();
  const character = $('#customCharacter').value.trim();
  const youtubeUrl = $('#customYoutube').value.trim();
  if (!movie || !youtubeUrl) {
    $('#customStatus').textContent = 'Inserisci almeno film e link YouTube.';
    return;
  }
  socket.emit('add-custom-prompt', { movie, character, youtubeUrl }, r => {
    $('#customStatus').textContent = r.ok ? 'Scena aggiunta al pack ✓' : (r.error || 'Errore');
    if (r.ok) {
      $('#customMovie').value='';
      $('#customCharacter').value='';
      $('#customYoutube').value='';
    }
  });
};

socket.on('state', s => { state=s; render(); });
socket.on('round-start', ({ performerId }) => {
  beep(performerId===me?'turn':'tap');
  resetLocalRound();
});
socket.on('game-finished', () => beep('win'));
socket.on('disconnect', () => toast('Connessione persa…'));

function render() {
  if (!state) return;
  if (state.phase === 'lobby') {
    showScreen('lobby');
    renderLobby();
    return;
  }
  showScreen('game');
  renderGame();
}

function renderLobby() {
  $('#copyCode').textContent=state.code;
  $('#roundsSelect').value=String(state.settings.rounds);
  $('#roundsSelect').disabled=state.hostId!==me;
  $('#customPack').style.display=state.hostId===me?'block':'none';
  $('#playersLobby').innerHTML = [0,1].map(i => {
    const p=state.players[i];
    if(!p) return `<div class="player-card"><div class="avatar">…</div><strong>In attesa</strong><small>Condividi il codice</small></div>`;
    return `<div class="player-card ${p.id===me?'me':''}">
      ${p.ready?'<span class="ready-chip">PRONTO</span>':''}
      <div class="avatar">${p.id===state.hostId?'👑':'🎬'}</div>
      <strong>${escapeHtml(p.name)}</strong>
      <small>${p.id===me?'Tu':p.id===state.hostId?'Host':'Ospite'}</small>
    </div>`;
  }).join('');
  const mine=state.players.find(p=>p.id===me);
  ready=!!mine?.ready;
  $('#readyBtn').textContent=ready?'✓ Pronto':'Sono pronto';
  const canStart=state.hostId===me && state.players.length===2 && state.players.every(p=>p.ready);
  $('#startBtn').disabled=!canStart;
  $('#startBtn').style.display=state.hostId===me?'block':'none';
}

function renderGame(){
  $('#roundLabel').textContent=`${Math.max(1,state.round)}/${state.settings.rounds}`;
  $('#gameRoomCode').textContent=state.code;
  $('#scoreboard').innerHTML=state.players.map(p=>`<div class="score-pill ${p.id===state.currentPerformerId?'active':''}"><span>${escapeHtml(p.name)}${p.id===me?' (tu)':''}</span><strong>${p.score}</strong></div>`).join('');
  if(state.phase==='perform') renderPerform();
  else if(state.phase==='judge') renderJudge();
  else if(state.phase==='result') renderResult();
  else if(state.phase==='finished') renderFinished();
}

function renderPerform(){
  showPhase('phasePerform');
  const p=state.currentPrompt;
  $('#promptEmoji').textContent=p?.emoji||'🎬';
  $('#promptLabel').textContent=(p?.custom?'SCENA AGGIUNTA':p?.label||'SCENA').toUpperCase();
  $('#promptMovie').textContent=p?.movie || 'Scena cinematografica';
  $('#promptText').textContent=p?.text || 'Guarda la scena e imitala nel modo più fedele possibile.';
  $('#referenceVideoWrap').classList.toggle('hidden', !p?.youtubeId);
  if (p?.youtubeId) setYoutubeFrame($('#referenceVideo'), p, false);

  const isMe=state.currentPerformerId===me;
  $('#roleBadge').textContent=isMe?'IL TUO TURNO':'TURNO AVVERSARIO';
  $('#performControls').classList.toggle('hidden',!isMe);
  $('#waitingPerformer').classList.toggle('hidden',isMe);
  $('#listenBtn').classList.toggle('hidden', !isMe);
  if(!isMe){
    const perf=state.players.find(x=>x.id===state.currentPerformerId);
    $('#waitingText').textContent=`${perf?.name||'L’altro giocatore'} sta scegliendo e imitando una battuta…`;
  }
}

$('#listenBtn').onclick = () => {
  const p=state?.currentPrompt;
  if (!p) return;
  if (p.youtubeId) {
    $('#referenceVideoWrap').classList.remove('hidden');
    setYoutubeFrame($('#referenceVideo'), p, true);
  }
  hasListened=true;
  $('#recordBtn').disabled=false;
  $('#recordStatus').textContent='Guarda la scena, poi tieni premuto e imita un passaggio breve';
};

const recordBtn=$('#recordBtn');
recordBtn.addEventListener('pointerdown', e=>{ e.preventDefault(); startRecording(); });
['pointerup','pointercancel','pointerleave'].forEach(ev=>recordBtn.addEventListener(ev, e=>{
  if(mediaRecorder?.state==='recording'){
    e.preventDefault();
    stopRecording();
  }
}));

async function startRecording(){
  if(!hasListened || state?.currentPerformerId!==me || state?.phase!=='perform') return;
  try{
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'';
    mediaRecorder=new MediaRecorder(mediaStream, mime?{mimeType:mime}:undefined);
    chunks=[];
    mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    mediaRecorder.onstop=onRecordingStopped;
    mediaRecorder.start();
    recordBtn.classList.add('recording');
    $('#recordStatus').textContent='REC • lascia per fermarti';
    beep('tap');
    maxRecordTimer=setTimeout(()=>{if(mediaRecorder?.state==='recording')stopRecording()},20000);
  }catch{
    toast('Permesso microfono negato');
  }
}
function stopRecording(){
  clearTimeout(maxRecordTimer);
  mediaRecorder.stop();
  recordBtn.classList.remove('recording');
  mediaStream?.getTracks().forEach(t=>t.stop());
}
function onRecordingStopped(){
  recordingBlob=new Blob(chunks,{type:mediaRecorder.mimeType||'audio/webm'});
  $('#myRecording').src=URL.createObjectURL(recordingBlob);
  $('#myRecording').classList.remove('hidden');
  $('#sendPerformanceBtn').classList.remove('hidden');
  $('#recordStatus').textContent='Riascolta oppure invia';
}

$('#sendPerformanceBtn').onclick=async()=>{
  if(!recordingBlob)return;
  const audioDataUrl=await fileToDataUrl(recordingBlob);
  $('#sendPerformanceBtn').disabled=true;
  socket.emit('submit-performance',{audioDataUrl,autoScore:0,features:null},r=>{
    $('#sendPerformanceBtn').disabled=false;
    if(!r.ok) toast(r.error||'Invio non riuscito');
  });
};

function renderJudge(){
  showPhase('phaseJudge');
  const p=state.currentPrompt;
  const isPerformer=state.currentPerformerId===me;
  $('#judgeControls').classList.toggle('hidden',isPerformer);
  $('#waitingJudge').classList.toggle('hidden',!isPerformer);
  $('#judgeBadge').textContent=isPerformer?'IMITAZIONE INVIATA':'SEI IL GIUDICE';
  $('#judgeVideoWrap').classList.toggle('hidden', !p?.youtubeId);
  if(p?.youtubeId) setYoutubeFrame($('#judgeReferenceVideo'), p, false);
  if(state.performance?.audioDataUrl) $('#judgeRecording').src=state.performance.audioDataUrl;
  renderJudgeScale();
}
$('#judgeReferenceBtn').onclick=()=>{
  const p=state?.currentPrompt;
  if (p?.youtubeId) {
    $('#judgeVideoWrap').classList.remove('hidden');
    setYoutubeFrame($('#judgeReferenceVideo'), p, true);
  }
};
$('#judgePerformanceBtn').onclick=()=>{
  const a=$('#judgeRecording');
  a.currentTime=0;
  a.play().catch(()=>{});
};
function renderJudgeScale(){
  $('#judgeScale').innerHTML=Array.from({length:10},(_,i)=>`<button class="judge-num ${selectedJudge===i+1?'selected':''}" data-v="${i+1}">${i+1}</button>`).join('');
  $$('.judge-num').forEach(b=>b.onclick=()=>{
    selectedJudge=Number(b.dataset.v);
    renderJudgeScale();
    $('#submitJudgeBtn').disabled=false;
    beep('tap');
  });
}
$('#submitJudgeBtn').onclick=()=>{
  if(!selectedJudge)return;
  $('#submitJudgeBtn').disabled=true;
  socket.emit('submit-judge-score',{score:selectedJudge},r=>{
    if(!r.ok){
      $('#submitJudgeBtn').disabled=false;
      toast(r.error||'Errore');
    }
  });
};

function renderResult(){
  showPhase('phaseResult');
  const r=state.lastResult;
  if(!r)return;
  const p=state.players.find(x=>x.id===r.performerId);
  $('#resultName').textContent=p?.name||'Performance';
  $('#resultScore').textContent=r.finalScore;
  $('#judgeScore').textContent=`${r.judgeScore}/10`;
  $('#resultAvatar').textContent=r.finalScore>=90?'🤯':r.finalScore>=75?'🔥':r.finalScore>=55?'😎':r.finalScore>=35?'😬':'💀';
}
function renderFinished(){
  showPhase('phaseFinished');
  const sorted=[...state.players].sort((a,b)=>b.score-a.score);
  const tie=sorted[0]?.score===sorted[1]?.score;
  const winner=sorted[0];
  $('#winnerTitle').textContent=tie?'Pareggio!':winner?.id===me?'Hai vinto!':`${winner?.name||'Avversario'} vince!`;
  $('#winnerText').textContent=tie?'Serve una rivincita cinematografica.':`Con ${winner?.score||0} punti totali.`;
  $('#finalScores').innerHTML=sorted.map((p,i)=>`<div class="final-row ${i===0&&!tie?'winner':''}"><span>${i===0&&!tie?'🏆 ':''}${escapeHtml(p.name)}</span><strong>${p.score}</strong></div>`).join('');
}

function resetLocalRound(){
  hasListened=false;
  selectedJudge=null;
  recordingBlob=null;
  $('#recordBtn').disabled=true;
  $('#recordBtn').classList.remove('recording');
  $('#recordStatus').textContent='Guarda prima la scena';
  $('#myRecording').classList.add('hidden');
  $('#myRecording').removeAttribute('src');
  $('#sendPerformanceBtn').classList.add('hidden');
  $('#submitJudgeBtn').disabled=true;
  $('#referenceVideo').removeAttribute('src');
  $('#judgeReferenceVideo').removeAttribute('src');
}

function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fileToDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
