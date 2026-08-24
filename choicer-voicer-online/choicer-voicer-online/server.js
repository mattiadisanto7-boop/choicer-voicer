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

// Frammenti brevi da video YouTube. Le clip restano su YouTube: il progetto memorizza solo ID, tempi e brevi parole-guida.
const DEFAULT_PROMPTS = [
  // Italiano
  { id:'song-sinceramente', title:'Sinceramente', artist:'Annalisa', language:'IT', youtubeId:'NfEp5l0UMBE', start:46, end:56, emoji:'💎', lyricCue:'Sinceramente, quando, quando, quando, quando piango' },
  { id:'song-monamour', title:'Mon Amour', artist:'Annalisa', language:'IT', youtubeId:'RzyD08-w-tk', start:49, end:59, emoji:'💋', lyricCue:'Ho visto lei che bacia lui' },
  { id:'song-duevite', title:'Due Vite', artist:'Marco Mengoni', language:'IT', youtubeId:'_iS4STWKSvk', start:60, end:71, emoji:'🌙', lyricCue:"Siamo i soli svegli in tutto l'universo" },
  { id:'song-italodisco', title:'ITALODISCO', artist:'The Kolors', language:'IT', youtubeId:'cIkXBFACp4s', start:56, end:66, emoji:'🪩', lyricCue:'Questa non è Ibiza' },
  { id:'song-lanoia', title:'La noia', artist:'Angelina Mango', language:'IT', youtubeId:'psiytW9Or2s', start:51, end:61, emoji:'🍊', lyricCue:'È la cumbia della noia' },
  { id:'song-giovani', title:'Giovani Wannabe', artist:'Pinguini Tattici Nucleari', language:'IT', youtubeId:'4GXDFtuG9Xo', start:50, end:60, emoji:'🐧', lyricCue:'Siamo giovani wannabe' },
  { id:'song-vai', title:'Vai!', artist:'ALFA', language:'IT', youtubeId:'Z6X3K13EqQI', start:38, end:48, emoji:'🚀', lyricCue:'Vai, vai, vai' },
  { id:'song-mntlv', title:'Ma non tutta la vita', artist:'Ricchi e Poveri', language:'IT', youtubeId:'lhmB3KIXchA', start:47, end:57, emoji:'❤️', lyricCue:'Ma non tutta la vita' },
  { id:'song-clickboom', title:'CLICK BOOM!', artist:'Rose Villain', language:'IT', youtubeId:'8mCBkGR_PRc', start:50, end:60, emoji:'💥', lyricCue:'Click boom boom boom' },
  { id:'song-geolier', title:"I P' ME, TU P' TE", artist:'Geolier', language:'IT', youtubeId:'Ulwjcz49qNk', start:45, end:55, emoji:'🎧', lyricCue:"I p' me, tu p' te" },

  // Inglese / internazionale
  { id:'song-espresso', title:'Espresso', artist:'Sabrina Carpenter', language:'EN', youtubeId:'eVli-tstM5E', start:46, end:56, emoji:'☕', lyricCue:"Now he's thinkin' 'bout me every night" },
  { id:'song-birds', title:'BIRDS OF A FEATHER', artist:'Billie Eilish', language:'EN', youtubeId:'V9PVRfjEBTI', start:65, end:75, emoji:'🪶', lyricCue:"I want you to stay 'til I'm in the grave" },
  { id:'song-diewithasmile', title:'Die With A Smile', artist:'Lady Gaga & Bruno Mars', language:'EN', youtubeId:'kPa7bsKwL-c', start:70, end:80, emoji:'🌹', lyricCue:"If the world was ending, I'd wanna be" },
  { id:'song-blindinglights', title:'Blinding Lights', artist:'The Weeknd', language:'EN', youtubeId:'4NRXx6U8ABQ', start:55, end:65, emoji:'🌃', lyricCue:"I said, ooh, I'm blinded by the lights" },
  { id:'song-levitating', title:'Levitating', artist:'Dua Lipa', language:'EN', youtubeId:'TUVcZfQe-Kw', start:51, end:61, emoji:'✨', lyricCue:'You want me, I want you, baby' },
  { id:'song-shapeofyou', title:'Shape of You', artist:'Ed Sheeran', language:'EN', youtubeId:'JGwWNGJdvx8', start:44, end:54, emoji:'🕺', lyricCue:"I'm in love with the shape of you" },
  { id:'song-asitwas', title:'As It Was', artist:'Harry Styles', language:'EN', youtubeId:'H5v3kku4y6Q', start:45, end:55, emoji:'🌀', lyricCue:"You know it's not the same as it was" },
  { id:'song-shakeitoff', title:'Shake It Off', artist:'Taylor Swift', language:'EN', youtubeId:'nfWlot6h_JM', start:52, end:62, emoji:'💃', lyricCue:'Players gonna play, play, play, play, play' },
  { id:'song-rolling', title:'Rolling in the Deep', artist:'Adele', language:'EN', youtubeId:'rYEDA3JcQqw', start:53, end:63, emoji:'🔥', lyricCue:'We could have had it all' },
  { id:'song-lockedout', title:'Locked Out of Heaven', artist:'Bruno Mars', language:'EN', youtubeId:'e-fA-gBCkj0', start:60, end:70, emoji:'🌤️', lyricCue:"I've been locked out of heaven for too long" },
  { id:'song-vampire', title:'vampire', artist:'Olivia Rodrigo', language:'EN', youtubeId:'RlPNh_PBZb4', start:62, end:72, emoji:'🧛', lyricCue:'You only come out at night' },
  { id:'song-apt', title:'APT.', artist:'ROSÉ & Bruno Mars', language:'EN', youtubeId:'ekr2nIex040', start:40, end:50, emoji:'🎉', lyricCue:"Don't you want me like I want you, baby" },
  { id:'song-bohemian', title:'Bohemian Rhapsody', artist:'Queen', language:'EN', youtubeId:'fJ9rUzIMcZQ', start:78, end:88, emoji:'👑', lyricCue:'Mama, just killed a man' },
  { id:'song-nevergonna', title:'Never Gonna Give You Up', artist:'Rick Astley', language:'EN', youtubeId:'dQw4w9WgXcQ', start:42, end:52, emoji:'🕺', lyricCue:'Never gonna give you up' },
  { id:'song-takeonme', title:'Take On Me', artist:'a-ha', language:'EN', youtubeId:'djV11Xbc914', start:58, end:68, emoji:'✏️', lyricCue:'Take on me, take me on' },
  { id:'song-smells', title:'Smells Like Teen Spirit', artist:'Nirvana', language:'EN', youtubeId:'hTWKbfoikeg', start:68, end:78, emoji:'🎸', lyricCue:"With the lights out, it's less dangerous" },
  { id:'song-numb', title:'Numb', artist:'Linkin Park', language:'EN', youtubeId:'kXYiU_JCYtU', start:61, end:71, emoji:'⚡', lyricCue:"I've become so numb, I can't feel you there" },
  { id:'song-vivalavida', title:'Viva La Vida', artist:'Coldplay', language:'EN', youtubeId:'dvgZkm1xWPE', start:48, end:58, emoji:'🏰', lyricCue:'I hear Jerusalem bells are ringing' },
  { id:'song-believer', title:'Believer', artist:'Imagine Dragons', language:'EN', youtubeId:'7wtfhZwyrcc', start:70, end:80, emoji:'🐉', lyricCue:'Pain! You made me a, you made me a believer' },
  { id:'song-countingstars', title:'Counting Stars', artist:'OneRepublic', language:'EN', youtubeId:'hT_nvWreIhg', start:54, end:64, emoji:'⭐', lyricCue:"Lately, I've been, I've been losing sleep" },
  { id:'song-sugar', title:'Sugar', artist:'Maroon 5', language:'EN', youtubeId:'09R8_2nJtjg', start:72, end:82, emoji:'🍬', lyricCue:"Sugar, yes please, won't you come and put it down" },
  { id:'song-chandelier', title:'Chandelier', artist:'Sia', language:'EN', youtubeId:'2vjPBrBU-TM', start:60, end:70, emoji:'💡', lyricCue:"I'm gonna swing from the chandelier" },
  { id:'song-badromance', title:'Bad Romance', artist:'Lady Gaga', language:'EN', youtubeId:'qrO4YZeyl0I', start:53, end:63, emoji:'🖤', lyricCue:'I want your love and I want your revenge' },
  { id:'song-flowers', title:'Flowers', artist:'Miley Cyrus', language:'EN', youtubeId:'G7KNmW9a75Y', start:56, end:66, emoji:'🌸', lyricCue:'I can buy myself flowers' }
].map(p => ({
  ...p,
  type:'youtube-song',
  duration:p.end-p.start,
  text:`Ascolta questi ${p.end-p.start} secondi e prova a imitarli nel modo più fedele possibile.`
}));

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

  socket.on('add-custom-song',({title,artist,youtubeUrl,start,end,lyrics}={},ack=()=>{})=>{
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
      youtubeId,
      start:s,
      end:e,
      duration:e-s,
      emoji:'🎵',
      custom:true,
      lyricCue:String(lyrics||'').trim().slice(0,500),
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