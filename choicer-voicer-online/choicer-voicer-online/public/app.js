const socket = io();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let me = null;
let state = null;
let ready = false;
let selectedJudge = null;
let soundOn = true;
let hasListened = false;
let isRecording = false;
let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let recordingBlob = null;
let recordingUrl = '';
let recordTimer = null;
let progressRaf = null;
let performPlayer = null;
let judgePlayer = null;
let ytResolve;
const ytReady = new Promise(r => ytResolve = r);
const playerTimers = { perform:null, judge:null };
const pendingPlayback = { perform:null, judge:null };

function showScreen(id){ $$('.screen').forEach(x=>x.classList.remove('active')); $('#'+id)?.classList.add('active'); }
function showPhase(id){ ['phasePerform','phaseJudge','phaseResult','phaseFinished'].forEach(x=>$('#'+x)?.classList.add('hidden')); $('#'+id)?.classList.remove('hidden'); }
function toast(msg){ const t=$('#toast'); if(!t)return; t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2400); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function normalizeCode(v){ return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5); }
function durationOf(p){ return Math.max(4,Math.min(15,Number(p?.duration)||((Number(p?.end)||0)-(Number(p?.start)||0))||10)); }
function escapeHtml(v){ return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function fileToDataUrl(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
function setLyrics(el,p){
  if(!el)return;
  const txt=String(p?.lyricCue||'').trim();
  el.textContent=txt;
  el.classList.toggle('hidden',!txt);
}
function beep(type='tap'){
  if(!soundOn)return;
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const now=ctx.currentTime;
    const notes=type==='turn'?[440,660]:type==='win'?[523,659,784]:[520];
    notes.forEach((f,i)=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.frequency.value=f;
      g.gain.setValueAtTime(.0001,now+i*.1);
      g.gain.exponentialRampToValueAtTime(.07,now+i*.1+.015);
      g.gain.exponentialRampToValueAtTime(.0001,now+i*.1+.11);
      o.connect(g).connect(ctx.destination); o.start(now+i*.1); o.stop(now+i*.1+.13);
    });
    setTimeout(()=>ctx.close(),700);
  }catch{}
}

function loadYouTubeApi(){
  if(window.YT?.Player){ initYouTubePlayers(); return; }
  window.onYouTubeIframeAPIReady = initYouTubePlayers;
  const s=document.createElement('script');
  s.src='https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}
function initYouTubePlayers(){
  if(performPlayer&&judgePlayer)return;
  let readyCount=0;
  const onReady=()=>{ readyCount++; if(readyCount===2)ytResolve(); };
  const make=(id,key)=>new YT.Player(id,{
    height:'100%',width:'100%',
    playerVars:{controls:0,disablekb:1,fs:0,playsinline:1,rel:0,iv_load_policy:3,modestbranding:1,origin:location.origin},
    events:{
      onReady,
      onError:()=>toast('Questo video YouTube non è riproducibile qui.'),
      onStateChange:e=>handlePlayerState(key,e)
    }
  });
  performPlayer=make('songPlayer','perform');
  judgePlayer=make('judgeSongPlayer','judge');
}
function handlePlayerState(key,e){
  const pending=pendingPlayback[key];
  if(!pending||pending.started||e.data!==YT.PlayerState.PLAYING)return;
  pending.started=true;
  pending.onPlaying?.();
  clearPlayerTimer(key);
  playerTimers[key]=setTimeout(()=>finishPlayback(key),pending.durationMs+250);
}
function finishPlayback(key){
  const pending=pendingPlayback[key];
  clearPlayerTimer(key);
  if(!pending)return;
  pendingPlayback[key]=null;
  try{playerFor(key)?.pauseVideo();}catch{}
  try{pending.audio?.pause(); if(pending.audio)pending.audio.currentTime=0;}catch{}
  pending.onEnd?.();
}
function playerFor(key){ return key==='judge'?judgePlayer:performPlayer; }
function clearPlayerTimer(key){ if(playerTimers[key])clearTimeout(playerTimers[key]); playerTimers[key]=null; }
function stopPlayer(key){
  clearPlayerTimer(key);
  const pending=pendingPlayback[key];
  pendingPlayback[key]=null;
  try{pending?.audio?.pause(); if(pending?.audio)pending.audio.currentTime=0;}catch{}
  try{playerFor(key)?.stopVideo();}catch{}
}
async function cueSong(key,p){
  if(!p?.youtubeId)return;
  await ytReady;
  const pl=playerFor(key);
  try{
    pl.mute();
    pl.cueVideoById({videoId:p.youtubeId,startSeconds:Number(p.start)||0,endSeconds:Number(p.end)||10});
  }catch{}
}
async function playSong(key,p,{onEnd}={}){
  if(!p?.youtubeId)return;
  await ytReady;
  const pl=playerFor(key);
  stopPlayer(key);
  pendingPlayback[key]={started:false,durationMs:durationOf(p)*1000,audio:null,onEnd};
  try{
    pl.unMute();
    pl.setVolume(100);
    pl.loadVideoById({videoId:p.youtubeId,startSeconds:Number(p.start)||0,endSeconds:Number(p.end)||10});
  }catch{
    pendingPlayback[key]=null;
    toast('Non riesco ad avviare questo pezzo.');
    onEnd?.();
  }
}
async function playDubbedSong(key,p,audio,{onEnd}={}){
  if(!p?.youtubeId||!audio)return;
  await ytReady;
  const pl=playerFor(key);
  stopPlayer(key);
  try{audio.pause(); audio.currentTime=0;}catch{}
  pendingPlayback[key]={
    started:false,
    durationMs:durationOf(p)*1000,
    audio,
    onPlaying:async()=>{
      try{audio.currentTime=0; await audio.play();}
      catch{toast('Non riesco a riprodurre la registrazione.');}
    },
    onEnd
  };
  try{
    pl.mute();
    pl.loadVideoById({videoId:p.youtubeId,startSeconds:Number(p.start)||0,endSeconds:Number(p.end)||10});
  }catch{
    pendingPlayback[key]=null;
    toast('Non riesco ad avviare il video.');
    onEnd?.();
  }
}
loadYouTubeApi();

$('#roomInput').addEventListener('input',e=>e.target.value=normalizeCode(e.target.value));
$('#createBtn').onclick=()=>{
  $('#homeError').textContent='';
  socket.emit('create-room',{name:$('#nameInput').value},r=>{
    if(!r.ok)return $('#homeError').textContent=r.error||'Errore.';
    me=r.playerId; showScreen('lobby');
  });
};
$('#joinBtn').onclick=()=>{
  $('#homeError').textContent='';
  socket.emit('join-room',{code:normalizeCode($('#roomInput').value),name:$('#nameInput').value},r=>{
    if(!r.ok)return $('#homeError').textContent=r.error||'Errore.';
    me=r.playerId; showScreen('lobby');
  });
};
$('#leaveBtn').onclick=()=>location.reload();
$('#copyCode').onclick=async()=>{ if(state){ await navigator.clipboard?.writeText(state.code); toast('Codice copiato'); } };
$('#readyBtn').onclick=()=>{ ready=!ready; socket.emit('set-ready',{ready}); };
$('#roundsSelect').onchange=e=>socket.emit('update-settings',{rounds:Number(e.target.value)});
$('#startBtn').onclick=()=>socket.emit('start-game');
$('#muteBtn').onclick=()=>{ soundOn=!soundOn; $('#muteBtn').textContent=soundOn?'🔊':'🔇'; };
$('#rematchBtn').onclick=()=>socket.emit('rematch');

$('#addSongBtn').onclick=()=>{
  const payload={
    title:$('#customTitle').value.trim(),
    artist:$('#customArtist').value.trim(),
    youtubeUrl:$('#customYoutube').value.trim(),
    start:Number($('#customStart').value),
    end:Number($('#customEnd').value),
    lyrics:$('#customLyrics').value.trim()
  };
  if(!payload.title||!payload.youtubeUrl){ $('#customStatus').textContent='Inserisci almeno titolo e link YouTube.'; return; }
  socket.emit('add-custom-song',payload,r=>{
    $('#customStatus').textContent=r.ok?'Frammento aggiunto ✓':(r.error||'Errore');
    if(r.ok){
      $('#customTitle').value=''; $('#customArtist').value=''; $('#customYoutube').value=''; $('#customLyrics').value='';
    }
  });
};

socket.on('state',s=>{ state=s; render(); });
socket.on('round-start',({performerId})=>{ resetLocalRound(); beep(performerId===me?'turn':'tap'); render(); });
socket.on('game-finished',()=>beep('win'));
socket.on('disconnect',()=>toast('Connessione persa…'));

function render(){
  if(!state)return;
  if(state.phase==='lobby'){ showScreen('lobby'); renderLobby(); return; }
  showScreen('game'); renderGame();
}
function renderLobby(){
  $('#copyCode').textContent=state.code;
  $('#roundsSelect').value=String(state.settings.rounds);
  $('#roundsSelect').disabled=state.hostId!==me;
  $('#customPack').style.display=state.hostId===me?'block':'none';
  $('#playersLobby').innerHTML=[0,1].map(i=>{
    const p=state.players[i];
    if(!p)return `<div class="player-card"><div class="avatar">…</div><strong>In attesa</strong><small>Condividi il codice</small></div>`;
    return `<div class="player-card ${p.id===me?'me':''}">${p.ready?'<span class="ready-chip">PRONTO</span>':''}<div class="avatar">${p.id===state.hostId?'👑':'🎤'}</div><strong>${escapeHtml(p.name)}</strong><small>${p.id===me?'Tu':p.id===state.hostId?'Host':'Ospite'}</small></div>`;
  }).join('');
  const mine=state.players.find(p=>p.id===me);
  ready=!!mine?.ready;
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
  $('#promptEmoji').textContent=p?.emoji||'🎵';
  $('#songTitle').textContent=p?.title||'Canzone';
  $('#songArtist').textContent=p?.artist||'';
  $('#promptText').textContent=p?.text||'Ascolta e imita.';
  $('#songDuration').textContent=`⏱ ${durationOf(p)} secondi`;
  $('#songLanguage').textContent=`🌍 ${p?.language||'MIX'}`;
  setLyrics($('#songLyrics'),p);
  $('#songPlayerWrap').classList.remove('hidden');
  $('#roleBadge').textContent=isMe?'IL TUO TURNO':'TURNO AVVERSARIO';
  $('#performControls').classList.toggle('hidden',!isMe);
  $('#waitingPerformer').classList.toggle('hidden',isMe);
  $('#listenBtn').classList.toggle('hidden',!isMe);
  if(isMe&&!isRecording)cueSong('perform',p);
  if(!isMe){
    stopPlayer('perform');
    const perf=state.players.find(x=>x.id===state.currentPerformerId);
    $('#waitingText').textContent=`${perf?.name||'L’altro giocatore'} sta imitando ${p?.title||'la canzone'}…`;
  }
}

$('#listenBtn').onclick=async()=>{
  if(state?.phase!=='perform'||state.currentPerformerId!==me||isRecording)return;
  const p=state.currentPrompt;
  $('#listenBtn').disabled=true;
  $('#recordBtn').disabled=true;
  $('#recordStatus').textContent='Ascolta bene questo pezzetto…';
  await playSong('perform',p,{onEnd:()=>{
    hasListened=true;
    $('#listenBtn').disabled=false;
    $('#recordBtn').disabled=false;
    $('#recordStatus').textContent=`Ora imitalo: registrazione automatica di ${durationOf(p)} secondi.`;
    beep('turn');
    cueSong('perform',p);
  }});
};

function showMicHelp(message){
  $('#micHelpBtn').classList.remove('hidden');
  const box=$('#micHelp');
  box.innerHTML=`<strong>Microfono non disponibile</strong><p>${escapeHtml(message)}</p><p>Controlla che il sito abbia il permesso Microfono nelle impostazioni del browser e poi ricarica la pagina.</p>`;
  box.classList.remove('hidden');
}
$('#micHelpBtn').onclick=()=>$('#micHelp').classList.toggle('hidden');

async function acquireMicrophone(){
  if(!window.isSecureContext)throw new Error('Il microfono funziona solo su una connessione HTTPS sicura.');
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Questo browser non espone l’accesso al microfono. Prova Chrome o Safari aggiornato.');
  if(!window.MediaRecorder)throw new Error('Il browser non supporta la registrazione audio MediaRecorder.');
  const stream=await navigator.mediaDevices.getUserMedia({
    audio:{echoCancellation:true,noiseSuppression:false,autoGainControl:true},
    video:false
  });
  if(!stream.getAudioTracks().length){ stream.getTracks().forEach(t=>t.stop()); throw new Error('Nessun microfono rilevato.'); }
  return stream;
}
function bestMimeType(){
  const types=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'];
  return types.find(t=>{try{return MediaRecorder.isTypeSupported(t)}catch{return false}})||'';
}
async function countdown(){
  const el=$('#countdown');
  el.classList.remove('hidden');
  for(const value of ['3','2','1','VIA!']){
    el.textContent=value;
    beep('tap');
    await sleep(value==='VIA!'?300:650);
  }
  el.classList.add('hidden');
}
function startProgress(durationMs){
  const wrap=$('#recordProgress'),bar=$('#recordProgressBar');
  wrap.classList.remove('hidden');
  const start=performance.now();
  const draw=now=>{
    const pct=Math.min(100,((now-start)/durationMs)*100);
    bar.style.width=pct+'%';
    if(pct<100&&isRecording)progressRaf=requestAnimationFrame(draw);
  };
  bar.style.width='0%';
  progressRaf=requestAnimationFrame(draw);
}
function stopProgress(){
  if(progressRaf)cancelAnimationFrame(progressRaf);
  progressRaf=null;
  $('#recordProgress').classList.add('hidden');
}

$('#recordBtn').onclick=async()=>{
  if(!hasListened||isRecording||state?.phase!=='perform'||state.currentPerformerId!==me)return;
  stopPlayer('perform');
  $('#recordBtn').disabled=true;
  $('#listenBtn').disabled=true;
  $('#micHelpBtn').classList.add('hidden');
  $('#micHelp').classList.add('hidden');
  $('#recordStatus').textContent='Richiedo accesso al microfono…';
  try{
    mediaStream=await acquireMicrophone();
  }catch(err){
    $('#recordBtn').disabled=false;
    $('#listenBtn').disabled=false;
    const msg=err?.name==='NotAllowedError'?'Permesso microfono negato.':(err?.message||'Impossibile usare il microfono.');
    $('#recordStatus').textContent=msg;
    showMicHelp(msg);
    return;
  }

  await countdown();
  const mime=bestMimeType();
  try{
    mediaRecorder=mime?new MediaRecorder(mediaStream,{mimeType:mime}):new MediaRecorder(mediaStream);
  }catch(err){
    mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null;
    $('#recordBtn').disabled=false; $('#listenBtn').disabled=false;
    showMicHelp('Il browser ha dato accesso al microfono, ma non riesce a creare la registrazione audio.');
    return;
  }

  chunks=[];
  mediaRecorder.ondataavailable=e=>{ if(e.data&&e.data.size>0)chunks.push(e.data); };
  mediaRecorder.onerror=()=>{ toast('Errore durante la registrazione.'); };
  mediaRecorder.onstop=finishRecording;

  try{
    mediaRecorder.start(250);
  }catch(err){
    mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null;
    $('#recordBtn').disabled=false; $('#listenBtn').disabled=false;
    showMicHelp('La registrazione non è riuscita ad avviarsi.');
    return;
  }

  isRecording=true;
  const ms=durationOf(state.currentPrompt)*1000;
  $('#recordBtn').classList.add('recording');
  $('#recordStatus').textContent='REC • Imita adesso il pezzetto che hai appena ascoltato';
  startProgress(ms);
  recordTimer=setTimeout(stopRecording,ms);
};

function stopRecording(){
  clearTimeout(recordTimer); recordTimer=null;
  if(mediaRecorder&&mediaRecorder.state!=='inactive'){
    try{mediaRecorder.requestData();}catch{}
    try{mediaRecorder.stop();}catch{}
  }
  mediaStream?.getTracks().forEach(t=>t.stop());
  mediaStream=null;
}
function finishRecording(){
  isRecording=false;
  stopProgress();
  $('#recordBtn').classList.remove('recording');
  $('#listenBtn').disabled=false;
  const type=mediaRecorder?.mimeType||chunks[0]?.type||'audio/webm';
  recordingBlob=new Blob(chunks,{type});
  if(recordingBlob.size<500){
    recordingBlob=null;
    $('#recordBtn').disabled=false;
    $('#recordStatus').textContent='La registrazione è risultata vuota. Riprova.';
    showMicHelp('Il browser ha creato un file audio vuoto. Verifica che il microfono selezionato funzioni e riprova.');
    return;
  }
  if(recordingUrl)URL.revokeObjectURL(recordingUrl);
  recordingUrl=URL.createObjectURL(recordingBlob);
  $('#myRecording').src=recordingUrl;
  $('#myRecording').classList.remove('hidden');
  $('#afterRecordActions').classList.remove('hidden');
  $('#recordStatus').textContent='Registrazione riuscita ✓ Puoi anche provarla direttamente sul video.';
  $('#recordBtn').disabled=true;
  cueSong('perform',state.currentPrompt);
}

$('#previewPerformanceBtn').onclick=async()=>{
  if(!recordingBlob)return;
  const a=$('#myRecording');
  await playDubbedSong('perform',state.currentPrompt,a,{onEnd:()=>cueSong('perform',state.currentPrompt)});
};
$('#retryBtn').onclick=()=>{
  stopPlayer('perform');
  recordingBlob=null;
  if(recordingUrl)URL.revokeObjectURL(recordingUrl);
  recordingUrl='';
  $('#myRecording').pause();
  $('#myRecording').removeAttribute('src');
  $('#myRecording').classList.add('hidden');
  $('#afterRecordActions').classList.add('hidden');
  $('#recordBtn').disabled=false;
  $('#recordStatus').textContent=`Riprova: ${durationOf(state.currentPrompt)} secondi di registrazione.`;
  cueSong('perform',state.currentPrompt);
};
$('#sendPerformanceBtn').onclick=async()=>{
  if(!recordingBlob)return;
  stopPlayer('perform');
  const audioDataUrl=await fileToDataUrl(recordingBlob);
  $('#sendPerformanceBtn').disabled=true;
  socket.emit('submit-performance',{audioDataUrl},r=>{
    $('#sendPerformanceBtn').disabled=false;
    if(!r.ok)toast(r.error||'Invio non riuscito');
  });
};

function renderJudge(){
  showPhase('phaseJudge');
  stopPlayer('perform');
  const p=state.currentPrompt;
  const isPerformer=state.currentPerformerId===me;
  $('#judgeSongTitle').textContent=p?.title||'Canzone';
  $('#judgeSongArtist').textContent=`${p?.artist||''} • ${durationOf(p)} secondi • ${p?.language||''}`;
  setLyrics($('#judgeSongLyrics'),p);
  $('#judgeControls').classList.toggle('hidden',isPerformer);
  $('#waitingJudge').classList.toggle('hidden',!isPerformer);
  $('#judgeBadge').textContent=isPerformer?'IMITAZIONE INVIATA':'SEI IL GIUDICE';
  if(state.performance?.audioDataUrl)$('#judgeRecording').src=state.performance.audioDataUrl;
  cueSong('judge',p);
  renderJudgeScale();
}
$('#judgeReferenceBtn').onclick=async()=>{
  $('#judgeRecording').pause();
  await playSong('judge',state.currentPrompt,{onEnd:()=>cueSong('judge',state.currentPrompt)});
};
$('#judgePerformanceBtn').onclick=async()=>{
  const a=$('#judgeRecording');
  await playDubbedSong('judge',state.currentPrompt,a,{onEnd:()=>cueSong('judge',state.currentPrompt)});
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
    if(!r.ok){ $('#submitJudgeBtn').disabled=false; toast(r.error||'Errore'); }
  });
};

function renderResult(){
  showPhase('phaseResult');
  stopPlayer('perform'); stopPlayer('judge');
  const r=state.lastResult; if(!r)return;
  const p=state.players.find(x=>x.id===r.performerId);
  $('#resultName').textContent=p?.name||'Performance';
  $('#resultScore').textContent=r.finalScore;
  $('#judgeScore').textContent=`${r.judgeScore}/10`;
  $('#resultAvatar').textContent=r.finalScore>=90?'🤯':r.finalScore>=75?'🔥':r.finalScore>=55?'😎':r.finalScore>=35?'😬':'💀';
}
function renderFinished(){
  showPhase('phaseFinished');
  stopPlayer('perform'); stopPlayer('judge');
  const sorted=[...state.players].sort((a,b)=>b.score-a.score);
  const tie=sorted[0]?.score===sorted[1]?.score;
  const winner=sorted[0];
  $('#winnerTitle').textContent=tie?'Pareggio!':winner?.id===me?'Hai vinto!':`${winner?.name||'Avversario'} vince!`;
  $('#winnerText').textContent=tie?'Serve una rivincita.':`Con ${winner?.score||0} punti totali.`;
  $('#finalScores').innerHTML=sorted.map((p,i)=>`<div class="final-row ${i===0&&!tie?'winner':''}"><span>${i===0&&!tie?'🏆 ':''}${escapeHtml(p.name)}</span><strong>${p.score}</strong></div>`).join('');
}

function resetLocalRound(){
  clearTimeout(recordTimer); recordTimer=null;
  if(progressRaf)cancelAnimationFrame(progressRaf); progressRaf=null;
  if(mediaRecorder&&mediaRecorder.state!=='inactive'){try{mediaRecorder.stop()}catch{}}
  mediaStream?.getTracks().forEach(t=>t.stop()); mediaStream=null;
  isRecording=false; hasListened=false; selectedJudge=null; recordingBlob=null; chunks=[];
  if(recordingUrl)URL.revokeObjectURL(recordingUrl); recordingUrl='';
  stopPlayer('perform'); stopPlayer('judge');
  $('#recordBtn').disabled=true; $('#recordBtn').classList.remove('recording');
  $('#listenBtn').disabled=false;
  $('#recordStatus').textContent='Ascolta prima il pezzo';
  $('#recordProgress').classList.add('hidden'); $('#recordProgressBar').style.width='0%';
  $('#myRecording').pause(); $('#myRecording').removeAttribute('src'); $('#myRecording').classList.add('hidden');
  $('#afterRecordActions').classList.add('hidden');
  $('#submitJudgeBtn').disabled=true;
  $('#micHelpBtn').classList.add('hidden'); $('#micHelp').classList.add('hidden');
  setLyrics($('#songLyrics'),null); setLyrics($('#judgeSongLyrics'),null);
}

window.addEventListener('beforeunload',()=>{
  mediaStream?.getTracks().forEach(t=>t.stop());
  if(recordingUrl)URL.revokeObjectURL(recordingUrl);
});