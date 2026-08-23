const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 3e6, pingTimeout: 25000, pingInterval: 10000 });
const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Frammenti brevi preimpostati da video ufficiali YouTube. Non salviamo testi o file musicali nel progetto.
const DEFAULT_PROMPTS = [
  { id:'song-sinceramente', title:'Sinceramente', artist:'Annalisa', youtubeId:'NfEp5l0UMBE', start:46, end:56, emoji:'💎' },
  { id:'song-monamour', title:'Mon Amour', artist:'Annalisa', youtubeId:'RzyD08-w-tk', start:49, end:59, emoji:'💋' },
  { id:'song-duevite', title:'Due Vite', artist:'Marco Mengoni', youtubeId:'_iS4STWKSvk', start:60, end:71, emoji:'🌙' },
  { id:'song-italodisco', title:'ITALODISCO', artist:'The Kolors', youtubeId:'cIkXBFACp4s', start:56, end:66, emoji:'🪩' },
  { id:'song-lanoia', title:'La noia', artist:'Angelina Mango', youtubeId:'psiytW9Or2s', start:51, end:61, emoji:'🍊' },
  { id:'song-giovani', title:'Giovani Wannabe', artist:'Pinguini Tattici Nucleari', youtubeId:'4GXDFtuG9Xo', start:50, end:60, emoji:'🐧' },
  { id:'song-vai', title:'Vai!', artist:'ALFA', youtubeId:'Z6X3K13EqQI', start:38, end:48, emoji:'🚀' },
  { id:'song-mntlv', title:'Ma non tutta la vita', artist:'Ricchi e Poveri', youtubeId:'lhmB3KIXchA', start:47, end:57, emoji:'❤️' },
  { id:'song-clickboom', title:'CLICK BOOM!', artist:'Rose Villain', youtubeId:'8mCBkGR_PRc', start:50, end:60, emoji:'💥' },
  { id:'song-geolier', title:"I P' ME, TU P' TE", artist:'Geolier', youtubeId:'Ulwjcz49qNk', start:45, end:55, emoji:'🎧' }
].map(p => ({ ...p, type:'youtube-song', duration:p.end-p.start, text:`Ascolta questi ${p.end-p.start} secondi e prova a imitarli nel modo più fedele possibile.` }));

function makeCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  do{ code=Array.from({length:5},()=>chars[Math.floor(Math.random()*chars.length)]).join(''); }while(rooms.has(code));
  return code;
}
function publicState(room){
  return {
    code:room.code,
    players:room.players.map(p=>({id:p.id,name:p.name,score:p.score,ready:p.ready,connected:p.connected})),
    hostId:room.hostId,
    settings:room.settings,
    phase:room.phase,
    round:room.round,
    currentPerformerId:room.currentPerformerId,
    currentPrompt:room.currentPrompt,
    performance:room.performance,
    lastResult:room.lastResult,
    promptsCount:room.prompts.length
  };
}
function emitState(room){ io.to(room.code).emit('state', publicState(room)); }
function resetRoundData(room){ room.currentPrompt=null; room.performance=null; room.lastResult=null; }
function pickPrompt(room){
  let available=room.prompts.filter(p=>!room.usedPromptIds.has(p.id));
  if(!available.length){ room.usedPromptIds.clear(); available=[...room.prompts]; }
  const prompt=available[Math.floor(Math.random()*available.length)];
  room.usedPromptIds.add(prompt.id);
  return prompt;
}
function beginRound(room){
  if(room.players.length!==2)return;
  room.round+=1;
  room.phase='perform';
  room.currentPerformerId=room.players[(room.round-1)%2].id;
  room.currentPrompt=pickPrompt(room);
  room.performance=null;
  room.lastResult=null;
  emitState(room);
  io.to(room.code).emit('round-start',{round:room.round,performerId:room.currentPerformerId});
}
function finishGame(room){
  room.phase='finished';
  room.currentPrompt=null;
  room.performance=null;
  emitState(room);
  io.to(room.code).emit('game-finished');
}
function normalizeName(name){ return String(name||'').trim().slice(0,20)||'Giocatore'; }
function youtubeIdFrom(value){
  const raw=String(value||'').trim();
  if(/^[A-Za-z0-9_-]{11}$/.test(raw))return raw;
  const m=raw.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/i);
  return m?.[1]||null;
}

io.on('connection',socket=>{
  socket.on('create-room',({name}={},ack=()=>{})=>{
    const code=makeCode();
    const room={
      code,
      hostId:socket.id,
      players:[{id:socket.id,name:normalizeName(name),score:0,ready:false,connected:true}],
      settings:{rounds:8},
      phase:'lobby',round:0,currentPerformerId:null,currentPrompt:null,performance:null,lastResult:null,
      prompts:DEFAULT_PROMPTS.map(x=>({...x})),usedPromptIds:new Set(),cleanupTimer:null
    };
    rooms.set(code,room);
    socket.join(code);
    socket.data.roomCode=code;
    ack({ok:true,code,playerId:socket.id});
    emitState(room);
  });

  socket.on('join-room',({code,name}={},ack=()=>{})=>{
    code=String(code||'').trim().toUpperCase();
    const room=rooms.get(code);
    if(!room)return ack({ok:false,error:'Stanza non trovata.'});
    if(room.players.length>=2)return ack({ok:false,error:'La stanza è già piena.'});
    if(room.phase!=='lobby')return ack({ok:false,error:'La partita è già iniziata.'});
    room.players.push({id:socket.id,name:normalizeName(name),score:0,ready:false,connected:true});
    socket.join(code);
    socket.data.roomCode=code;
    ack({ok:true,code,playerId:socket.id});
    emitState(room);
  });

  socket.on('set-ready',({ready}={})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=='lobby')return;
    const player=room.players.find(p=>p.id===socket.id);
    if(!player)return;
    player.ready=!!ready;
    emitState(room);
  });

  socket.on('update-settings',({rounds}={})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.hostId!==socket.id||room.phase!=='lobby')return;
    const allowed=[6,8,10,12,16];
    if(allowed.includes(Number(rounds)))room.settings.rounds=Number(rounds);
    emitState(room);
  });

  socket.on('add-custom-song',({title,artist,youtubeUrl,start,end}={},ack=()=>{})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.hostId!==socket.id||room.phase!=='lobby')return ack({ok:false,error:'Operazione non consentita.'});
    const youtubeId=youtubeIdFrom(youtubeUrl);
    const s=Math.max(0,Math.floor(Number(start)||0));
    const e=Math.floor(Number(end)||0);
    if(!youtubeId)return ack({ok:false,error:'Link YouTube non valido.'});
    if(!e||e<=s)return ack({ok:false,error:'Il secondo finale deve essere maggiore di quello iniziale.'});
    if(e-s<4||e-s>15)return ack({ok:false,error:'Il frammento deve durare da 4 a 15 secondi.'});
    room.prompts.push({
      id:`custom-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      type:'youtube-song',
      title:String(title||'Canzone personalizzata').trim().slice(0,60),
      artist:String(artist||'Artista').trim().slice(0,50),
      youtubeId,start:s,end:e,duration:e-s,emoji:'🎵',custom:true,
      text:`Ascolta questi ${e-s} secondi e prova a imitarli nel modo più fedele possibile.`
    });
    ack({ok:true});
    emitState(room);
  });

  socket.on('start-game',()=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.hostId!==socket.id||room.phase!=='lobby')return;
    if(room.players.length!==2||!room.players.every(p=>p.ready))return;
    room.players.forEach(p=>p.score=0);
    room.round=0;
    room.usedPromptIds.clear();
    resetRoundData(room);
    beginRound(room);
  });

  socket.on('submit-performance',({audioDataUrl}={},ack=()=>{})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=='perform'||room.currentPerformerId!==socket.id)return ack({ok:false,error:'Non è il tuo turno.'});
    if(!audioDataUrl||typeof audioDataUrl!=='string'||audioDataUrl.length>2500000)return ack({ok:false,error:'Registrazione non valida o troppo grande.'});
    room.performance={performerId:socket.id,audioDataUrl};
    room.phase='judge';
    ack({ok:true});
    emitState(room);
  });

  socket.on('submit-judge-score',({score}={},ack=()=>{})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=='judge'||!room.performance)return ack({ok:false});
    if(socket.id===room.currentPerformerId)return ack({ok:false,error:'Non puoi votarti.'});
    const judgeScore=Math.max(1,Math.min(10,Number(score)||1));
    const finalScore=Math.round(judgeScore*10);
    const performer=room.players.find(p=>p.id===room.currentPerformerId);
    if(performer)performer.score+=finalScore;
    room.lastResult={performerId:room.currentPerformerId,judgeScore,finalScore};
    room.phase='result';
    ack({ok:true});
    emitState(room);
    setTimeout(()=>{
      if(!rooms.has(room.code)||room.phase!=='result')return;
      if(room.round>=room.settings.rounds)finishGame(room);else beginRound(room);
    },3200);
  });

  socket.on('rematch',()=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=='finished')return;
    room.phase='lobby';room.round=0;room.currentPerformerId=null;
    room.players.forEach(p=>{p.score=0;p.ready=false});
    room.usedPromptIds.clear();
    resetRoundData(room);
    emitState(room);
  });

  socket.on('disconnect',()=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room)return;
    const p=room.players.find(p=>p.id===socket.id);
    if(p)p.connected=false;
    emitState(room);
    if(room.cleanupTimer)clearTimeout(room.cleanupTimer);
    room.cleanupTimer=setTimeout(()=>{if(!room.players.some(p=>p.connected))rooms.delete(room.code)},5*60*1000);
  });
});

server.listen(PORT,'0.0.0.0',()=>console.log(`Choicer Voicer online on port ${PORT}`));
