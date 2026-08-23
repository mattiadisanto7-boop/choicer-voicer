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
let recordingUrl = '';
let soundOn = true;
let hasWatched = false;
let recordTimer = null;
let previewTimer = null;
let busyDub = false;

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
    const notes = type === 'turn' ? [440,660] : type === 'win' ? [523,659,784] : [520];
    notes.forEach((f,i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(.0001, now+i*.1);
      g.gain.exponentialRampToValueAtTime(.08, now+i*.1+.015);
      g.gain.exponentialRampToValueAtTime(.0001, now+i*.1+.11);
      o.connect(g).connect(ctx.destination);
      o.start(now+i*.1);
      o.stop(now+i*.1+.13);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {}
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function normalizeCode(v){ return v.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5); }
function sceneDuration(p){ return Math.max(1, Number(p?.duration || (p?.end-p?.start) || 10)); }
function sceneUrl(p, { autoplay=false, muted=false } = {}) {
  if (!p?.youtubeId) return '';
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    mute: muted ? '1' : '0',
    controls: '0',
    disablekb: '1',
    fs: '0',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    start: String(Math.max(0, Number(p.start)||0)),
    end: String(Math.max(1, Number(p.end)||10))
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(p.youtubeId)}?${params.toString()}`;
}
function playScene(frame, p, muted=false) {
  if (!frame || !p) return;
  frame.src = 'about:blank';
  setTimeout(() => { frame.src = sceneUrl(p, { autoplay:true, muted }); }, 20);
}
function stopScene(frame) {
  if (frame) frame.src = 'about:blank';
}
function stopAllPreviewAudio(){
  ['myRecording','judgeRecording'].forEach(id => {
    const a = $('#' + id);
    if (a) { a.pause(); try { a.currentTime = 0; } catch {} }
  });
  clearTimeout(previewTimer);
}

$('#roomInput').addEventListener('input', e => e.target.value = normalizeCode(e.target.value));
$('#createBtn').onclick = () => {
  $('#homeError').textContent='';
  socket.emit('create-room',{name:$('#nameInput').value},r=>{
    if(!r.ok) return $('#homeError').textContent=r.error||'Errore.';
    me=r.playerId; showScreen('lobby');
  });
};
$('#joinBtn').onclick = () => {
  $('#homeError').textContent='';
  socket.emit('join-room',{code:normalizeCode($('#roomInput').value),name:$('#nameInput').value},r=>{
    if(!r.ok) return $('#homeError').textContent=r.error||'Errore.';
    me=r.playerId; showScreen('lobby');
  });
};
$('#leaveBtn').onclick=()=>location.reload();
$('#copyCode').onclick=async()=>{ if(state){ await navigator.clipboard?.writeText(state.code); toast('Codice copiato'); } };
$('#readyBtn').onclick=()=>{ ready=!ready; socket.emit('set-ready',{ready}); };
$('#roundsSelect').onchange=e=>socket.emit('update-settings',{rounds:Number(e.target.value)});
$('#startBtn').onclick=()=>socket.emit('start-game');
$('#muteBtn').onclick=()=>{soundOn=!soundOn;$('#muteBtn').textContent=soundOn?'🔊':'🔇';};
$('#rematchBtn').onclick=()=>socket.emit('rematch');

socket.on('state',s=>{state=s;render();});
socket.on('round-start',({performerId})=>{resetLocalRound();beep(performerId===me?'turn':'tap');});
socket.on('game-finished',()=>beep('win'));
socket.on('disconnect',()=>toast('Connessione persa…'));

function render(){
  if(!state)return;
  if(state.phase==='lobby'){showScreen('lobby');renderLobby();return;}
  showScreen('game');renderGame();
}
function renderLobby(){
  $('#copyCode').textContent=state.code;
  $('#roundsSelect').value=String(state.settings.rounds);
  $('#roundsSelect').disabled=state.hostId!==me;
  $('#playersLobby').innerHTML=[0,1].map(i=>{
    const p=state.players[i];
    if(!p)return `<div class="player-card"><div class="avatar">…</div><strong>In attesa</strong><small>Condividi il codice</small></div>`;
    return `<div class="player-card ${p.id===me?'me':''}">${p.ready?'<span class="ready-chip">PRONTO</span>':''}<div class="avatar">${p.id===state.hostId?'👑':'🎬'}</div><strong>${escapeHtml(p.name)}</strong><small>${p.id===me?'Tu':p.id===state.hostId?'Host':'Ospite'}</small></div>`;
  }).join('');
  const mine=state.players.find(p=>p.id===me); ready=!!mine?.ready;
  $('#readyBtn').textContent=ready?'✓ Pronto':'Sono pronto';
  const canStart=state.hostId===me&&state.players.length===2&&state.players.every(p=>p.ready);
  $('#startBtn').disabled=!canStart;
  $('#startBtn').style.display=state.hostId===me?'block':'none';
}
function renderGame(){
  $('#roundLabel').textContent=`${Math.max(1,state.round)}/${state.settings.rounds}`;
  $('#gameRoomCode').textContent=state.code;
  $('#scoreboard').innerHTML=state.players.map(p=>`<div class="score-pill ${p.id===state.currentPerformerId?'active':''}"><span>${escapeHtml(p.name)}${p.id===me?' (tu)':''}</span><strong>${p.score}</strong></div>`).join('');
  if(state.phase==='perform')renderPerform();
  else if(state.phase==='judge')renderJudge();
  else if(state.phase==='result')renderResult();
  else if(state.phase==='finished')renderFinished();
}

function renderPerform(){
  showPhase('phasePerform');
  const p=state.currentPrompt;
  const isMe=state.currentPerformerId===me;
  $('#promptEmoji').textContent=p?.emoji||'🎬';
  $('#promptLabel').textContent='PERSONAGGIO DA DOPPIARE';
  $('#promptMovie').textContent=p?.movie||'Film';
  $('#promptText').textContent=p?.text||'La parte da imitare è già scelta.';
  $('#sceneCharacter').textContent=`🎭 ${p?.label||'Personaggio'}`;
  $('#sceneDuration').textContent=`⏱ ${sceneDuration(p)} s`;
  $('#referenceVideoWrap').classList.remove('hidden');
  $('#roleBadge').textContent=isMe?'IL TUO TURNO':'TURNO AVVERSARIO';
  $('#performControls').classList.toggle('hidden',!isMe);
  $('#waitingPerformer').classList.toggle('hidden',isMe);
  $('#listenBtn').classList.toggle('hidden',!isMe);
  if(!isMe){
    const perf=state.players.find(x=>x.id===state.currentPerformerId);
    $('#waitingText').textContent=`${perf?.name||'L’altro giocatore'} sta doppiando ${p?.label||'il personaggio'}…`;
    stopScene($('#referenceVideo'));
  } else if(!hasWatched && !busyDub && !recordingBlob) {
    $('#referenceVideo').src=sceneUrl(p,{autoplay:false,muted:false});
  }
}

$('#listenBtn').onclick=()=>{
  if(state?.phase!=='perform'||state.currentPerformerId!==me)return;
  stopAllPreviewAudio();
  const p=state.currentPrompt;
  playScene($('#referenceVideo'),p,false);
  hasWatched=true;
  $('#recordBtn').disabled=false;
  $('#recordStatus').textContent=`Ora doppia ${p.label}: la registrazione durerà ${sceneDuration(p)} secondi`;
  setTimeout(()=>stopScene($('#referenceVideo')),sceneDuration(p)*1000+700);
};

$('#recordBtn').onclick=async()=>{
  if(!hasWatched||busyDub||state?.phase!=='perform'||state.currentPerformerId!==me)return;
  await startDubbing();
};

async function startDubbing(){
  busyDub=true;
  clearTimeout(recordTimer);
  stopAllPreviewAudio();
  try{
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  }catch{
    busyDub=false; toast('Serve il permesso del microfono'); return;
  }
  $('#recordBtn').disabled=true;
  $('#afterRecordActions').classList.add('hidden');
  const cd=$('#countdown');
  cd.classList.remove('hidden');
  for(const n of ['3','2','1','VIA!']){ cd.textContent=n; beep('tap'); await sleep(n==='VIA!'?350:700); }
  cd.classList.add('hidden');

  chunks=[];
  const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'';
  mediaRecorder=new MediaRecorder(mediaStream,mime?{mimeType:mime}:undefined);
  mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  mediaRecorder.onstop=finishDubbing;
  mediaRecorder.start(100);
  $('#recordBtn').classList.add('recording');
  $('#recordStatus').textContent='REC • Doppia seguendo il video: si fermerà da solo';
  playScene($('#referenceVideo'),state.currentPrompt,true);
  recordTimer=setTimeout(()=>stopDubbing(),sceneDuration(state.currentPrompt)*1000+250);
}
function stopDubbing(){
  clearTimeout(recordTimer);
  if(mediaRecorder?.state==='recording')mediaRecorder.stop();
  mediaStream?.getTracks().forEach(t=>t.stop());
  mediaStream=null;
  stopScene($('#referenceVideo'));
}
function finishDubbing(){
  recordingBlob=new Blob(chunks,{type:mediaRecorder?.mimeType||'audio/webm'});
  if(recordingUrl)URL.revokeObjectURL(recordingUrl);
  recordingUrl=URL.createObjectURL(recordingBlob);
  $('#myRecording').src=recordingUrl;
  $('#recordBtn').classList.remove('recording');
  $('#recordStatus').textContent='Doppiaggio registrato. Rivedilo dentro la scena.';
  $('#afterRecordActions').classList.remove('hidden');
  $('#recordBtn').disabled=true;
  busyDub=false;
}

$('#previewDubBtn').onclick=()=>previewDub($('#referenceVideo'),$('#myRecording'));
$('#retryDubBtn').onclick=()=>{
  stopAllPreviewAudio();
  recordingBlob=null;
  $('#afterRecordActions').classList.add('hidden');
  $('#recordBtn').disabled=false;
  $('#recordStatus').textContent='Premi Inizia doppiaggio per rifare la stessa scena';
  $('#referenceVideo').src=sceneUrl(state.currentPrompt,{autoplay:false,muted:true});
};
async function previewDub(frame,audio){
  if(!recordingBlob&&!audio.src)return;
  stopAllPreviewAudio();
  playScene(frame,state.currentPrompt,true);
  try{audio.currentTime=0; await audio.play();}catch{}
  previewTimer=setTimeout(()=>{audio.pause();stopScene(frame);},sceneDuration(state.currentPrompt)*1000+500);
}

$('#sendPerformanceBtn').onclick=async()=>{
  if(!recordingBlob)return;
  stopAllPreviewAudio();
  const audioDataUrl=await fileToDataUrl(recordingBlob);
  $('#sendPerformanceBtn').disabled=true;
  socket.emit('submit-performance',{audioDataUrl},r=>{
    $('#sendPerformanceBtn').disabled=false;
    if(!r.ok)toast(r.error||'Invio non riuscito');
  });
};

function renderJudge(){
  showPhase('phaseJudge');
  const p=state.currentPrompt;
  const isPerformer=state.currentPerformerId===me;
  $('#judgeMovieTitle').textContent=p?.movie||'Scena';
  $('#judgeCharacterText').textContent=`Doppiaggio di ${p?.label||'personaggio'} • ${sceneDuration(p)} secondi`;
  $('#judgeControls').classList.toggle('hidden',isPerformer);
  $('#waitingJudge').classList.toggle('hidden',!isPerformer);
  $('#judgeBadge').textContent=isPerformer?'DOPPIAGGIO INVIATO':'SEI IL GIUDICE';
  $('#judgeReferenceVideo').src=sceneUrl(p,{autoplay:false,muted:true});
  if(state.performance?.audioDataUrl)$('#judgeRecording').src=state.performance.audioDataUrl;
  renderJudgeScale();
}
$('#judgeReferenceBtn').onclick=()=>{
  stopAllPreviewAudio();
  playScene($('#judgeReferenceVideo'),state.currentPrompt,false);
  previewTimer=setTimeout(()=>stopScene($('#judgeReferenceVideo')),sceneDuration(state.currentPrompt)*1000+700);
};
$('#judgePerformanceBtn').onclick=async()=>{
  stopAllPreviewAudio();
  const audio=$('#judgeRecording');
  playScene($('#judgeReferenceVideo'),state.currentPrompt,true);
  try{audio.currentTime=0;await audio.play();}catch{}
  previewTimer=setTimeout(()=>{audio.pause();stopScene($('#judgeReferenceVideo'));},sceneDuration(state.currentPrompt)*1000+500);
};
function renderJudgeScale(){
  $('#judgeScale').innerHTML=Array.from({length:10},(_,i)=>`<button class="judge-num ${selectedJudge===i+1?'selected':''}" data-v="${i+1}">${i+1}</button>`).join('');
  $$('.judge-num').forEach(b=>b.onclick=()=>{selectedJudge=Number(b.dataset.v);renderJudgeScale();$('#submitJudgeBtn').disabled=false;beep('tap');});
}
$('#submitJudgeBtn').onclick=()=>{
  if(!selectedJudge)return;
  $('#submitJudgeBtn').disabled=true;
  socket.emit('submit-judge-score',{score:selectedJudge},r=>{if(!r.ok){$('#submitJudgeBtn').disabled=false;toast(r.error||'Errore');}});
};

function renderResult(){
  showPhase('phaseResult');
  const r=state.lastResult;if(!r)return;
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
  clearTimeout(recordTimer);clearTimeout(previewTimer);stopAllPreviewAudio();
  if(mediaRecorder?.state==='recording')try{mediaRecorder.stop()}catch{}
  mediaStream?.getTracks().forEach(t=>t.stop());
  mediaStream=null;mediaRecorder=null;chunks=[];recordingBlob=null;busyDub=false;hasWatched=false;selectedJudge=null;
  if(recordingUrl){URL.revokeObjectURL(recordingUrl);recordingUrl='';}
  $('#recordBtn').disabled=true;$('#recordBtn').classList.remove('recording');
  $('#recordStatus').textContent='Guarda prima la scena';
  $('#afterRecordActions').classList.add('hidden');
  $('#submitJudgeBtn').disabled=true;
  $('#myRecording').removeAttribute('src');$('#judgeRecording').removeAttribute('src');
  stopScene($('#referenceVideo'));stopScene($('#judgeReferenceVideo'));
  $('#countdown').classList.add('hidden');
}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fileToDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
