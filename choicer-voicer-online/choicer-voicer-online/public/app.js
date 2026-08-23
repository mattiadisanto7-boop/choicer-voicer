const socket = io();
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let me=null,state=null,ready=false,selectedJudge=null;
let mediaRecorder=null,mediaStream=null,chunks=[],recordingBlob=null,recordingUrl='';
let soundOn=true,hasWatched=false,busyDub=false,recordTimer=null,previewTimer=null;
let performPlayer=null,judgePlayer=null,ytReadyCount=0,ytReadyResolve;
const ytReady=new Promise(r=>ytReadyResolve=r);
const playerActions={perform:null,judge:null};

function showScreen(id){$$('.screen').forEach(x=>x.classList.remove('active'));$('#'+id).classList.add('active')}
function showPhase(id){['phasePerform','phaseJudge','phaseResult','phaseFinished'].forEach(x=>$('#'+x).classList.add('hidden'));$('#'+id).classList.remove('hidden')}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function normalizeCode(v){return v.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5)}
function sceneDuration(p){return Math.max(1,Number(p?.duration||(p?.end-p?.start)||10))}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fileToDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)})}
function beep(type='tap'){
  if(!soundOn)return;
  try{const ctx=new(window.AudioContext||window.webkitAudioContext)(),now=ctx.currentTime;const notes=type==='turn'?[440,660]:type==='win'?[523,659,784]:[520];notes.forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=f;g.gain.setValueAtTime(.0001,now+i*.1);g.gain.exponentialRampToValueAtTime(.08,now+i*.1+.015);g.gain.exponentialRampToValueAtTime(.0001,now+i*.1+.11);o.connect(g).connect(ctx.destination);o.start(now+i*.1);o.stop(now+i*.1+.13)});setTimeout(()=>ctx.close(),800)}catch{}
}

function replacePlayerTarget(id){const old=$('#'+id);if(!old||old.tagName==='DIV')return;const div=document.createElement('div');div.id=id;old.replaceWith(div)}
replacePlayerTarget('referenceVideo');replacePlayerTarget('judgeReferenceVideo');

function loadYouTubeApi(){
  if(window.YT?.Player){window.onYouTubeIframeAPIReady();return}
  const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s)
}
window.onYouTubeIframeAPIReady=()=>{
  const make=(id,key)=>new YT.Player(id,{height:'100%',width:'100%',playerVars:{controls:0,disablekb:1,fs:0,playsinline:1,rel:0,iv_load_policy:3,modestbranding:1,origin:location.origin},events:{onReady:()=>{ytReadyCount++;if(ytReadyCount>=2)ytReadyResolve()},onStateChange:e=>handlePlayerState(key,e)}});
  performPlayer=make('referenceVideo','perform');judgePlayer=make('judgeReferenceVideo','judge');
};
function getPlayer(key){return key==='perform'?performPlayer:judgePlayer}
function clearPlayerAction(key){const a=playerActions[key];if(a?.timer)clearTimeout(a.timer);playerActions[key]=null}
function finishPlayerAction(key){const a=playerActions[key];if(!a||a.done)return;a.done=true;if(a.timer)clearTimeout(a.timer);try{a.onEnded?.()}catch{};playerActions[key]=null}
function handlePlayerState(key,e){
  const a=playerActions[key];if(!a)return;
  if(e.data===YT.PlayerState.PLAYING&&!a.started){a.started=true;try{a.onPlaying?.()}catch{};a.timer=setTimeout(()=>finishPlayerAction(key),sceneDuration(a.prompt)*1000+650)}
  if(e.data===YT.PlayerState.ENDED)finishPlayerAction(key)
}
async function cueScene(key,p){
  await ytReady;const pl=getPlayer(key);if(!pl||!p)return;
  clearPlayerAction(key);try{pl.mute();pl.cueVideoById({videoId:p.youtubeId,startSeconds:Number(p.start)||0,endSeconds:Number(p.end)||10})}catch{}
}
async function runScene(key,p,{muted=false,onPlaying=null,onEnded=null}={}){
  await ytReady;const pl=getPlayer(key);if(!pl||!p)return;
  clearPlayerAction(key);playerActions[key]={prompt:p,onPlaying,onEnded,started:false,done:false,timer:null};
  try{muted?pl.mute():pl.unMute();pl.loadVideoById({videoId:p.youtubeId,startSeconds:Number(p.start)||0,endSeconds:Number(p.end)||10})}catch{toast('Non riesco ad avviare questa scena')}
}
function stopPlayer(key){clearPlayerAction(key);const pl=getPlayer(key);try{pl?.stopVideo()}catch{}}
function stopAllPreviewAudio(){['myRecording','judgeRecording'].forEach(id=>{const a=$('#'+id);if(a){a.pause();try{a.currentTime=0}catch{}}});clearTimeout(previewTimer)}

loadYouTubeApi();

$('#roomInput').addEventListener('input',e=>e.target.value=normalizeCode(e.target.value));
$('#createBtn').onclick=()=>{ $('#homeError').textContent='';socket.emit('create-room',{name:$('#nameInput').value},r=>{if(!r.ok)return $('#homeError').textContent=r.error||'Errore.';me=r.playerId;showScreen('lobby')}) };
$('#joinBtn').onclick=()=>{ $('#homeError').textContent='';socket.emit('join-room',{code:normalizeCode($('#roomInput').value),name:$('#nameInput').value},r=>{if(!r.ok)return $('#homeError').textContent=r.error||'Errore.';me=r.playerId;showScreen('lobby')}) };
$('#leaveBtn').onclick=()=>location.reload();
$('#copyCode').onclick=async()=>{if(state){await navigator.clipboard?.writeText(state.code);toast('Codice copiato')}};
$('#readyBtn').onclick=()=>{ready=!ready;socket.emit('set-ready',{ready})};
$('#roundsSelect').onchange=e=>socket.emit('update-settings',{rounds:Number(e.target.value)});
$('#startBtn').onclick=()=>socket.emit('start-game');
$('#muteBtn').onclick=()=>{soundOn=!soundOn;$('#muteBtn').textContent=soundOn?'🔊':'🔇'};
$('#rematchBtn').onclick=()=>socket.emit('rematch');

socket.on('state',s=>{state=s;render()});
socket.on('round-start',({performerId})=>{resetLocalRound();beep(performerId===me?'turn':'tap')});
socket.on('game-finished',()=>beep('win'));
socket.on('disconnect',()=>toast('Connessione persa…'));

function render(){if(!state)return;if(state.phase==='lobby'){showScreen('lobby');renderLobby();return}showScreen('game');renderGame()}
function renderLobby(){
  $('#copyCode').textContent=state.code;$('#roundsSelect').value=String(state.settings.rounds);$('#roundsSelect').disabled=state.hostId!==me;
  $('#playersLobby').innerHTML=[0,1].map(i=>{const p=state.players[i];if(!p)return `<div class="player-card"><div class="avatar">…</div><strong>In attesa</strong><small>Condividi il codice</small></div>`;return `<div class="player-card ${p.id===me?'me':''}">${p.ready?'<span class="ready-chip">PRONTO</span>':''}<div class="avatar">${p.id===state.hostId?'👑':'🎬'}</div><strong>${escapeHtml(p.name)}</strong><small>${p.id===me?'Tu':p.id===state.hostId?'Host':'Ospite'}</small></div>`}).join('');
  const mine=state.players.find(p=>p.id===me);ready=!!mine?.ready;$('#readyBtn').textContent=ready?'✓ Pronto':'Sono pronto';const can=state.hostId===me&&state.players.length===2&&state.players.every(p=>p.ready);$('#startBtn').disabled=!can;$('#startBtn').style.display=state.hostId===me?'block':'none'
}
function renderGame(){
  $('#roundLabel').textContent=`${Math.max(1,state.round)}/${state.settings.rounds}`;$('#gameRoomCode').textContent=state.code;$('#scoreboard').innerHTML=state.players.map(p=>`<div class="score-pill ${p.id===state.currentPerformerId?'active':''}"><span>${escapeHtml(p.name)}${p.id===me?' (tu)':''}</span><strong>${p.score}</strong></div>`).join('');
  if(state.phase==='perform')renderPerform();else if(state.phase==='judge')renderJudge();else if(state.phase==='result')renderResult();else if(state.phase==='finished')renderFinished()
}
function renderPerform(){
  showPhase('phasePerform');const p=state.currentPrompt,isMe=state.currentPerformerId===me;
  $('#promptEmoji').textContent=p?.emoji||'🎬';$('#promptLabel').textContent='PERSONAGGIO DA DOPPIARE';$('#promptMovie').textContent=p?.movie||'Film';$('#promptText').textContent=p?.text||'La parte è già scelta.';$('#sceneCharacter').textContent=`🎭 ${p?.label||'Personaggio'}`;$('#sceneDuration').textContent=`⏱ ${sceneDuration(p)} s`;$('#referenceVideoWrap').classList.remove('hidden');
  $('#roleBadge').textContent=isMe?'IL TUO TURNO':'TURNO AVVERSARIO';$('#performControls').classList.toggle('hidden',!isMe);$('#waitingPerformer').classList.toggle('hidden',isMe);$('#listenBtn').classList.toggle('hidden',!isMe);
  if(!isMe){const perf=state.players.find(x=>x.id===state.currentPerformerId);$('#waitingText').textContent=`${perf?.name||'L’altro giocatore'} sta doppiando ${p?.label||'il personaggio'}…`;stopPlayer('perform')}else if(!busyDub&&!recordingBlob)cueScene('perform',p)
}

$('#listenBtn').onclick=async()=>{
  if(state?.phase!=='perform'||state.currentPerformerId!==me)return;
  const p=state.currentPrompt;stopAllPreviewAudio();$('#listenBtn').disabled=true;$('#recordBtn').disabled=true;$('#recordStatus').textContent='Guarda tutta la scena originale…';
  await runScene('perform',p,{muted:false,onEnded:()=>{hasWatched=true;$('#listenBtn').disabled=false;$('#recordBtn').disabled=false;$('#recordStatus').textContent=`Ora doppia ${p.label}: ${sceneDuration(p)} secondi, stop automatico`;beep('turn')}})
};
$('#recordBtn').onclick=async()=>{if(!hasWatched||busyDub||state?.phase!=='perform'||state.currentPerformerId!==me)return;await startDubbing()};
async function startDubbing(){
  busyDub=true;clearTimeout(recordTimer);stopAllPreviewAudio();
  try{mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}})}catch{busyDub=false;toast('Serve il permesso del microfono');return}
  $('#recordBtn').disabled=true;$('#afterRecordActions').classList.add('hidden');const cd=$('#countdown');cd.classList.remove('hidden');
  for(const n of ['3','2','1','VIA!']){cd.textContent=n;beep('tap');await sleep(n==='VIA!'?300:650)}cd.classList.add('hidden');
  chunks=[];const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'';mediaRecorder=new MediaRecorder(mediaStream,mime?{mimeType:mime}:undefined);mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};mediaRecorder.onstop=finishDubbing;
  $('#recordBtn').classList.add('recording');$('#recordStatus').textContent='REC • Il video è muto: sei tu la voce del personaggio';
  await runScene('perform',state.currentPrompt,{muted:true,onPlaying:()=>{if(mediaRecorder?.state==='inactive')mediaRecorder.start(100);recordTimer=setTimeout(()=>stopDubbing(),sceneDuration(state.currentPrompt)*1000+500)},onEnded:()=>stopDubbing()})
}
function stopDubbing(){clearTimeout(recordTimer);if(mediaRecorder?.state==='recording')mediaRecorder.stop();mediaStream?.getTracks().forEach(t=>t.stop());mediaStream=null;stopPlayer('perform')}
function finishDubbing(){
  recordingBlob=new Blob(chunks,{type:mediaRecorder?.mimeType||'audio/webm'});if(recordingUrl)URL.revokeObjectURL(recordingUrl);recordingUrl=URL.createObjectURL(recordingBlob);$('#myRecording').src=recordingUrl;$('#recordBtn').classList.remove('recording');$('#recordStatus').textContent='Doppiaggio registrato. Ora rivedilo dentro la scena.';$('#afterRecordActions').classList.remove('hidden');$('#recordBtn').disabled=true;busyDub=false;cueScene('perform',state.currentPrompt)
}
$('#previewDubBtn').onclick=async()=>{if(!recordingBlob)return;stopAllPreviewAudio();const a=$('#myRecording');await runScene('perform',state.currentPrompt,{muted:true,onPlaying:async()=>{try{a.currentTime=0;await a.play()}catch{}},onEnded:()=>{a.pause();try{a.currentTime=0}catch{}}})};
$('#retryDubBtn').onclick=()=>{stopAllPreviewAudio();stopPlayer('perform');recordingBlob=null;$('#afterRecordActions').classList.add('hidden');$('#recordBtn').disabled=false;$('#recordStatus').textContent='Premi Inizia doppiaggio per rifare esattamente la stessa scena';cueScene('perform',state.currentPrompt)};
$('#sendPerformanceBtn').onclick=async()=>{if(!recordingBlob)return;stopAllPreviewAudio();stopPlayer('perform');const audioDataUrl=await fileToDataUrl(recordingBlob);$('#sendPerformanceBtn').disabled=true;socket.emit('submit-performance',{audioDataUrl},r=>{$('#sendPerformanceBtn').disabled=false;if(!r.ok)toast(r.error||'Invio non riuscito')})};

function renderJudge(){
  showPhase('phaseJudge');const p=state.currentPrompt,isPerformer=state.currentPerformerId===me;$('#judgeMovieTitle').textContent=p?.movie||'Scena';$('#judgeCharacterText').textContent=`Doppiaggio di ${p?.label||'personaggio'} • ${sceneDuration(p)} secondi`;$('#judgeControls').classList.toggle('hidden',isPerformer);$('#waitingJudge').classList.toggle('hidden',!isPerformer);$('#judgeBadge').textContent=isPerformer?'DOPPIAGGIO INVIATO':'SEI IL GIUDICE';if(state.performance?.audioDataUrl)$('#judgeRecording').src=state.performance.audioDataUrl;cueScene('judge',p);renderJudgeScale()
}
$('#judgeReferenceBtn').onclick=async()=>{stopAllPreviewAudio();await runScene('judge',state.currentPrompt,{muted:false,onEnded:()=>cueScene('judge',state.currentPrompt)})};
$('#judgePerformanceBtn').onclick=async()=>{stopAllPreviewAudio();const a=$('#judgeRecording');await runScene('judge',state.currentPrompt,{muted:true,onPlaying:async()=>{try{a.currentTime=0;await a.play()}catch{}},onEnded:()=>{a.pause();try{a.currentTime=0}catch{};cueScene('judge',state.currentPrompt)}})};
function renderJudgeScale(){$('#judgeScale').innerHTML=Array.from({length:10},(_,i)=>`<button class="judge-num ${selectedJudge===i+1?'selected':''}" data-v="${i+1}">${i+1}</button>`).join('');$$('.judge-num').forEach(b=>b.onclick=()=>{selectedJudge=Number(b.dataset.v);renderJudgeScale();$('#submitJudgeBtn').disabled=false;beep('tap')})}
$('#submitJudgeBtn').onclick=()=>{if(!selectedJudge)return;$('#submitJudgeBtn').disabled=true;socket.emit('submit-judge-score',{score:selectedJudge},r=>{if(!r.ok){$('#submitJudgeBtn').disabled=false;toast(r.error||'Errore')}})};

function renderResult(){showPhase('phaseResult');stopPlayer('perform');stopPlayer('judge');const r=state.lastResult;if(!r)return;const p=state.players.find(x=>x.id===r.performerId);$('#resultName').textContent=p?.name||'Performance';$('#resultScore').textContent=r.finalScore;$('#judgeScore').textContent=`${r.judgeScore}/10`;$('#resultAvatar').textContent=r.finalScore>=90?'🤯':r.finalScore>=75?'🔥':r.finalScore>=55?'😎':r.finalScore>=35?'😬':'💀'}
function renderFinished(){showPhase('phaseFinished');stopPlayer('perform');stopPlayer('judge');const sorted=[...state.players].sort((a,b)=>b.score-a.score),tie=sorted[0]?.score===sorted[1]?.score,winner=sorted[0];$('#winnerTitle').textContent=tie?'Pareggio!':winner?.id===me?'Hai vinto!':`${winner?.name||'Avversario'} vince!`;$('#winnerText').textContent=tie?'Serve una rivincita cinematografica.':`Con ${winner?.score||0} punti totali.`;$('#finalScores').innerHTML=sorted.map((p,i)=>`<div class="final-row ${i===0&&!tie?'winner':''}"><span>${i===0&&!tie?'🏆 ':''}${escapeHtml(p.name)}</span><strong>${p.score}</strong></div>`).join('')}
function resetLocalRound(){
  clearTimeout(recordTimer);clearTimeout(previewTimer);stopAllPreviewAudio();stopPlayer('perform');stopPlayer('judge');if(mediaRecorder?.state==='recording')try{mediaRecorder.stop()}catch{};mediaStream?.getTracks().forEach(t=>t.stop());mediaStream=null;mediaRecorder=null;chunks=[];recordingBlob=null;busyDub=false;hasWatched=false;selectedJudge=null;if(recordingUrl){URL.revokeObjectURL(recordingUrl);recordingUrl=''};$('#recordBtn').disabled=true;$('#recordBtn').classList.remove('recording');$('#recordStatus').textContent='Guarda prima la scena';$('#afterRecordActions').classList.add('hidden');$('#submitJudgeBtn').disabled=true;$('#myRecording').removeAttribute('src');$('#judgeRecording').removeAttribute('src');$('#countdown').classList.add('hidden')
}
