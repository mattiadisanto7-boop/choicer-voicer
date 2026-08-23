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
let currentFeatures = null;
let referenceFeatures = null;
let soundOn = true;
let hasListened = false;
let recordingStartedAt = 0;
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
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}
function beep(type='tap') {
  if (!soundOn) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    const now = ctx.currentTime;
    const notes = type === 'turn' ? [440, 660] : type === 'win' ? [523,659,784] : [520];
    notes.forEach((f,i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.frequency.value = f; osc.type = 'sine';
      gain.gain.setValueAtTime(.0001, now + i*.11);
      gain.gain.exponentialRampToValueAtTime(.09, now + i*.11 + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, now + i*.11 + .12);
      osc.connect(gain).connect(ctx.destination); osc.start(now + i*.11); osc.stop(now + i*.11 + .14);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {}
}

function normalizeCode(v){ return v.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5); }
$('#roomInput').addEventListener('input', e => e.target.value = normalizeCode(e.target.value));

$('#createBtn').onclick = () => {
  $('#homeError').textContent='';
  socket.emit('create-room', { name: $('#nameInput').value }, r => {
    if (!r.ok) return $('#homeError').textContent = r.error || 'Errore.';
    me = r.playerId; showScreen('lobby');
  });
};
$('#joinBtn').onclick = () => {
  $('#homeError').textContent='';
  socket.emit('join-room', { code: normalizeCode($('#roomInput').value), name: $('#nameInput').value }, r => {
    if (!r.ok) return $('#homeError').textContent = r.error || 'Errore.';
    me = r.playerId; showScreen('lobby');
  });
};
$('#leaveBtn').onclick = () => location.reload();
$('#copyCode').onclick = async () => { if(state){ await navigator.clipboard?.writeText(state.code); toast('Codice copiato'); } };
$('#readyBtn').onclick = () => { ready = !ready; socket.emit('set-ready',{ready}); };
$('#roundsSelect').onchange = e => socket.emit('update-settings',{rounds:Number(e.target.value)});
$('#startBtn').onclick = () => socket.emit('start-game');
$('#muteBtn').onclick = () => { soundOn=!soundOn; $('#muteBtn').textContent=soundOn?'🔊':'🔇'; };
$('#rematchBtn').onclick = () => socket.emit('rematch');

$('#addClipBtn').onclick = async () => {
  const file = $('#customAudio').files[0];
  if (!file) return $('#customStatus').textContent='Scegli prima un file audio.';
  if (file.size > 1_500_000) return $('#customStatus').textContent='Clip troppo grande: massimo circa 1,5 MB.';
  const data = await fileToDataUrl(file);
  socket.emit('add-custom-prompt', { label: $('#customLabel').value, text: $('#customText').value, audioDataUrl: data }, r => {
    $('#customStatus').textContent = r.ok ? 'Clip aggiunta ✓' : (r.error || 'Errore');
    if(r.ok){ $('#customAudio').value=''; $('#customLabel').value=''; $('#customText').value=''; }
  });
};

socket.on('state', s => { state=s; render(); });
socket.on('round-start', ({ performerId }) => { beep(performerId===me?'turn':'tap'); resetLocalRound(); });
socket.on('game-finished', () => beep('win'));
socket.on('disconnect', () => toast('Connessione persa…'));

function render() {
  if (!state) return;
  if (state.phase === 'lobby') {
    showScreen('lobby'); renderLobby(); return;
  }
  showScreen('game'); renderGame();
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
      <div class="avatar">${p.id===state.hostId?'👑':'🎧'}</div><strong>${escapeHtml(p.name)}</strong><small>${p.id===me?'Tu':p.id===state.hostId?'Host':'Ospite'}</small></div>`;
  }).join('');
  const mine=state.players.find(p=>p.id===me); ready=!!mine?.ready;
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

function setReferenceSource(){
  const p=state.currentPrompt;
  if(!p) return;
  $('#referenceAudio').src=p.audioDataUrl || p.audio;
}

function renderPerform(){
  showPhase('phasePerform');
  setReferenceSource();
  const p=state.currentPrompt;
  $('#promptEmoji').textContent=p?.emoji||'🎙️';
  $('#promptLabel').textContent=(p?.custom?'CLIP PERSONALIZZATA':p?.label||'CLIP').toUpperCase();
  $('#promptText').textContent=p?.text || 'Ascolta bene la voce e imitala.';
  const isMe=state.currentPerformerId===me;
  $('#roleBadge').textContent=isMe?'IL TUO TURNO':'TURNO AVVERSARIO';
  $('#performControls').classList.toggle('hidden',!isMe);
  $('#waitingPerformer').classList.toggle('hidden',isMe);
  if(!isMe){ const perf=state.players.find(x=>x.id===state.currentPerformerId); $('#waitingText').textContent=`${perf?.name||'L’altro giocatore'} sta imitando…`; }
}

$('#listenBtn').onclick = async () => {
  setReferenceSource();
  const a=$('#referenceAudio'); a.currentTime=0; await a.play().catch(()=>{});
  hasListened=true; $('#recordBtn').disabled=false; $('#recordStatus').textContent='Ora imitala tenendo premuto';
  try { referenceFeatures = await extractFeaturesFromUrl(a.src); } catch { referenceFeatures=null; }
};

const recordBtn=$('#recordBtn');
['pointerdown'].forEach(ev=>recordBtn.addEventListener(ev, e=>{ e.preventDefault(); startRecording(); }));
['pointerup','pointercancel','pointerleave'].forEach(ev=>recordBtn.addEventListener(ev, e=>{ if(mediaRecorder?.state==='recording'){e.preventDefault();stopRecording();} }));

async function startRecording(){
  if(!hasListened || state?.currentPerformerId!==me || state?.phase!=='perform') return;
  try{
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'';
    mediaRecorder=new MediaRecorder(mediaStream, mime?{mimeType:mime}:undefined); chunks=[];
    mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    mediaRecorder.onstop=onRecordingStopped;
    mediaRecorder.start(); recordingStartedAt=Date.now();
    recordBtn.classList.add('recording'); $('#recordStatus').textContent='REC • lascia per fermarti'; beep('tap');
    maxRecordTimer=setTimeout(()=>{if(mediaRecorder?.state==='recording')stopRecording()},10000);
  }catch{ toast('Permesso microfono negato'); }
}
function stopRecording(){
  clearTimeout(maxRecordTimer); mediaRecorder.stop(); recordBtn.classList.remove('recording');
  mediaStream?.getTracks().forEach(t=>t.stop());
}
async function onRecordingStopped(){
  recordingBlob=new Blob(chunks,{type:mediaRecorder.mimeType||'audio/webm'});
  $('#myRecording').src=URL.createObjectURL(recordingBlob); $('#myRecording').classList.remove('hidden');
  $('#sendPerformanceBtn').classList.remove('hidden'); $('#recordStatus').textContent='Riascolta oppure invia';
  try{ currentFeatures=await extractFeaturesFromBlob(recordingBlob); }catch{ currentFeatures=null; }
}

$('#sendPerformanceBtn').onclick=async()=>{
  if(!recordingBlob)return;
  const autoScore=calculateSimilarity(referenceFeatures,currentFeatures);
  const audioDataUrl=await fileToDataUrl(recordingBlob);
  $('#sendPerformanceBtn').disabled=true;
  socket.emit('submit-performance',{audioDataUrl,autoScore,features:currentFeatures},r=>{
    $('#sendPerformanceBtn').disabled=false;
    if(!r.ok) toast(r.error||'Invio non riuscito');
  });
};

function renderJudge(){
  showPhase('phaseJudge'); setReferenceSource();
  const isPerformer=state.currentPerformerId===me;
  $('#judgeControls').classList.toggle('hidden',isPerformer);
  $('#waitingJudge').classList.toggle('hidden',!isPerformer);
  $('#judgeBadge').textContent=isPerformer?'IMITAZIONE INVIATA':'SEI IL GIUDICE';
  if(state.performance?.audioDataUrl) $('#judgeRecording').src=state.performance.audioDataUrl;
  renderJudgeScale();
}
$('#judgeReferenceBtn').onclick=()=>{setReferenceSource();const a=$('#referenceAudio');a.currentTime=0;a.play().catch(()=>{})};
$('#judgePerformanceBtn').onclick=()=>{const a=$('#judgeRecording');a.currentTime=0;a.play().catch(()=>{})};
function renderJudgeScale(){
  $('#judgeScale').innerHTML=Array.from({length:10},(_,i)=>`<button class="judge-num ${selectedJudge===i+1?'selected':''}" data-v="${i+1}">${i+1}</button>`).join('');
  $$('.judge-num').forEach(b=>b.onclick=()=>{selectedJudge=Number(b.dataset.v);renderJudgeScale();$('#submitJudgeBtn').disabled=false;beep('tap')});
}
$('#submitJudgeBtn').onclick=()=>{
  if(!selectedJudge)return;
  $('#submitJudgeBtn').disabled=true;
  socket.emit('submit-judge-score',{score:selectedJudge},r=>{if(!r.ok){$('#submitJudgeBtn').disabled=false;toast(r.error||'Errore')}});
};

function renderResult(){
  showPhase('phaseResult');
  const r=state.lastResult; if(!r)return;
  const p=state.players.find(x=>x.id===r.performerId);
  $('#resultName').textContent=p?.name||'Performance';
  $('#resultScore').textContent=r.finalScore;
  $('#autoScore').textContent=r.autoScore;
  $('#judgeScore').textContent=`${r.judgeScore}/10`;
  $('#resultAvatar').textContent=r.finalScore>=90?'🤯':r.finalScore>=75?'🔥':r.finalScore>=55?'😎':r.finalScore>=35?'😬':'💀';
}
function renderFinished(){
  showPhase('phaseFinished');
  const sorted=[...state.players].sort((a,b)=>b.score-a.score);
  const tie=sorted[0]?.score===sorted[1]?.score;
  const winner=sorted[0];
  $('#winnerTitle').textContent=tie?'Pareggio!':winner?.id===me?'Hai vinto!':`${winner?.name||'Avversario'} vince!`;
  $('#winnerText').textContent=tie?'Nessuno può vantarsi. Serve una rivincita.':`Con ${winner?.score||0} punti totali.`;
  $('#finalScores').innerHTML=sorted.map((p,i)=>`<div class="final-row ${i===0&&!tie?'winner':''}"><span>${i===0&&!tie?'🏆 ':''}${escapeHtml(p.name)}</span><strong>${p.score}</strong></div>`).join('');
}

function resetLocalRound(){
  hasListened=false; selectedJudge=null; recordingBlob=null; currentFeatures=null; referenceFeatures=null;
  $('#recordBtn').disabled=true; $('#recordBtn').classList.remove('recording');
  $('#recordStatus').textContent='Ascolta prima la clip';
  $('#myRecording').classList.add('hidden'); $('#myRecording').removeAttribute('src');
  $('#sendPerformanceBtn').classList.add('hidden'); $('#submitJudgeBtn').disabled=true;
}

function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fileToDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}

async function extractFeaturesFromUrl(url){
  const buf=await fetch(url).then(r=>r.arrayBuffer()); return extractFeaturesFromArrayBuffer(buf);
}
async function extractFeaturesFromBlob(blob){ return extractFeaturesFromArrayBuffer(await blob.arrayBuffer()); }
async function extractFeaturesFromArrayBuffer(buf){
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  const audio=await ctx.decodeAudioData(buf.slice(0));
  const data=audio.getChannelData(0); const sr=audio.sampleRate; const bins=24;
  let sum=0,z=0; const env=[]; const step=Math.max(1,Math.floor(data.length/bins));
  for(let i=0;i<data.length;i++){const v=data[i];sum+=v*v;if(i&&((v>=0)!=(data[i-1]>=0)))z++;}
  for(let b=0;b<bins;b++){let s=0,n=0;for(let i=b*step;i<Math.min(data.length,(b+1)*step);i+=2){s+=data[i]*data[i];n++;}env.push(Math.sqrt(s/Math.max(1,n)));}
  const max=Math.max(...env,.0001); const normEnv=env.map(v=>v/max);
  const out={duration:+audio.duration.toFixed(3),rms:+Math.sqrt(sum/data.length).toFixed(5),zcr:+(z/data.length).toFixed(5),env:normEnv.map(v=>+v.toFixed(3))};
  ctx.close(); return out;
}
function calculateSimilarity(a,b){
  if(!a||!b)return 55;
  const dur=Math.max(0,1-Math.abs(a.duration-b.duration)/Math.max(a.duration,b.duration,.1));
  const rms=Math.max(0,1-Math.abs(a.rms-b.rms)/Math.max(a.rms,b.rms,.001));
  const zcr=Math.max(0,1-Math.abs(a.zcr-b.zcr)/Math.max(a.zcr,b.zcr,.001));
  const n=Math.min(a.env?.length||0,b.env?.length||0); let env=0;
  if(n){let mse=0;for(let i=0;i<n;i++)mse+=(a.env[i]-b.env[i])**2;env=Math.max(0,1-Math.sqrt(mse/n));}
  const score=(dur*.34+env*.36+zcr*.18+rms*.12)*100;
  return Math.max(15,Math.min(98,Math.round(score)));
}
