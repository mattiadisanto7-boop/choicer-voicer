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

const SONGS = [
  // Italiano
  ['sinceramente','Sinceramente','Annalisa','IT','NfEp5l0UMBE',46,56,'💎','pop','Sinceramente, quando, quando, quando, quando piango'],
  ['monamour','Mon Amour','Annalisa','IT','RzyD08-w-tk',49,59,'💋','dance','Ho visto lei che bacia lui'],
  ['duevite','Due Vite','Marco Mengoni','IT','_iS4STWKSvk',60,71,'🌙','ballad',"Siamo i soli svegli in tutto l'universo"],
  ['italodisco','ITALODISCO','The Kolors','IT','cIkXBFACp4s',56,66,'🪩','dance','Questa non è Ibiza'],
  ['lanoia','La noia','Angelina Mango','IT','psiytW9Or2s',51,61,'🍊','dance','È la cumbia della noia'],
  ['giovani','Giovani Wannabe','Pinguini Tattici Nucleari','IT','4GXDFtuG9Xo',50,60,'🐧','pop','Siamo giovani wannabe'],
  ['vai','Vai!','ALFA','IT','Z6X3K13EqQI',38,48,'🚀','pop','Vai, vai, vai'],
  ['mntlv','Ma non tutta la vita','Ricchi e Poveri','IT','lhmB3KIXchA',47,57,'❤️','dance','Ma non tutta la vita'],
  ['clickboom','CLICK BOOM!','Rose Villain','IT','8mCBkGR_PRc',50,60,'💥','pop','Click boom boom boom'],
  ['geolier',"I P' ME, TU P' TE",'Geolier','IT','Ulwjcz49qNk',45,55,'🎧','rap',"I p' me, tu p' te"],
  ['cenere','CENERE','Lazza','IT','A5ab7U9RVLE',55,65,'🌫️','rap','Come cenere'],
  ['bellissima','Bellissima','Annalisa','IT','qz88Dx-_lA4',54,64,'✨','pop','Ero bellissima'],
  ['due-elodie','Due','Elodie','IT','wMohbrKCAkM',54,64,'💔','pop','Le cose sono due'],
  ['ragazzo-ragazza','Un ragazzo una ragazza','The Kolors','IT','L6c_NhXeGYo',54,64,'🌙','dance','Un ragazzo incontra una ragazza'],
  ['brividi','Brividi','Mahmood & BLANCO','IT','MA_5P3u0apQ',56,66,'🥶','ballad','Nudo con i brividi'],

  // Inglese / internazionale
  ['espresso','Espresso','Sabrina Carpenter','EN','eVli-tstM5E',46,56,'☕','pop',"Now he's thinkin' 'bout me every night"],
  ['birds','BIRDS OF A FEATHER','Billie Eilish','EN','V9PVRfjEBTI',65,75,'🪶','ballad',"I want you to stay 'til I'm in the grave"],
  ['diewithasmile','Die With A Smile','Lady Gaga & Bruno Mars','EN','kPa7bsKwL-c',70,80,'🌹','ballad',"If the world was ending, I'd wanna be"],
  ['blindinglights','Blinding Lights','The Weeknd','EN','4NRXx6U8ABQ',55,65,'🌃','dance',"I'm blinded by the lights"],
  ['levitating','Levitating','Dua Lipa','EN','TUVcZfQe-Kw',51,61,'✨','dance','You want me, I want you, baby'],
  ['shapeofyou','Shape of You','Ed Sheeran','EN','JGwWNGJdvx8',44,54,'🕺','pop',"I'm in love with the shape of you"],
  ['asitwas','As It Was','Harry Styles','EN','H5v3kku4y6Q',45,55,'🌀','pop',"You know it's not the same as it was"],
  ['shakeitoff','Shake It Off','Taylor Swift','EN','nfWlot6h_JM',52,62,'💃','dance','Shake it off'],
  ['rolling','Rolling in the Deep','Adele','EN','rYEDA3JcQqw',53,63,'🔥','power','We could have had it all'],
  ['lockedout','Locked Out of Heaven','Bruno Mars','EN','e-fA-gBCkj0',60,70,'🌤️','pop',"I've been locked out of heaven"],
  ['vampire','vampire','Olivia Rodrigo','EN','RlPNh_PBZb4',62,72,'🧛','power','Vampire'],
  ['apt','APT.','ROSÉ & Bruno Mars','EN','ekr2nIex040',40,50,'🎉','dance','APT.'],
  ['bohemian','Bohemian Rhapsody','Queen','EN','fJ9rUzIMcZQ',78,88,'👑','power','Mama, just killed a man'],
  ['nevergonna','Never Gonna Give You Up','Rick Astley','EN','dQw4w9WgXcQ',42,52,'🕺','dance','Never gonna give you up'],
  ['takeonme','Take On Me','a-ha','EN','djV11Xbc914',58,68,'✏️','power','Take on me, take me on'],
  ['smells','Smells Like Teen Spirit','Nirvana','EN','hTWKbfoikeg',68,78,'🎸','rock','With the lights out'],
  ['numb','Numb','Linkin Park','EN','kXYiU_JCYtU',61,71,'⚡','rock',"I've become so numb"],
  ['vivalavida','Viva La Vida','Coldplay','EN','dvgZkm1xWPE',48,58,'🏰','pop','I hear Jerusalem bells are ringing'],
  ['believer','Believer','Imagine Dragons','EN','7wtfhZwyrcc',70,80,'🐉','rock','You made me a believer'],
  ['countingstars','Counting Stars','OneRepublic','EN','hT_nvWreIhg',54,64,'⭐','pop',"I've been losing sleep"],
  ['sugar','Sugar','Maroon 5','EN','09R8_2nJtjg',72,82,'🍬','pop','Sugar, yes please'],
  ['chandelier','Chandelier','Sia','EN','2vjPBrBU-TM',60,70,'💡','power',"I'm gonna swing from the chandelier"],
  ['badromance','Bad Romance','Lady Gaga','EN','qrO4YZeyl0I',53,63,'🖤','dance','I want your love'],
  ['flowers','Flowers','Miley Cyrus','EN','G7KNmW9a75Y',56,66,'🌸','pop','I can buy myself flowers'],
  ['cheapthrills','Cheap Thrills','Sia','EN','nYh-n7EOtMA',52,62,'💸','dance','Cheap thrills'],
  ['titanium','Titanium','David Guetta feat. Sia','EN','JRfuAukYTKg',58,68,'🛡️','power','I am titanium'],
  ['dancemonkey','Dance Monkey','Tones and I','EN','q0hyYWKXF0Q',48,58,'🐒','pop','Dance for me'],
  ['wakawaka','Waka Waka','Shakira','EN','pRpeEdMmmQ0',54,64,'⚽','dance','This time for Africa'],
  ['uptownfunk','Uptown Funk','Mark Ronson feat. Bruno Mars','EN','OPf0YbXqDm0',55,65,'🕺','dance','Uptown funk'],
  ['happy','Happy','Pharrell Williams','EN','ZbZSe6N_BXs',48,58,'😄','dance','Because I am happy'],
  ['roar','Roar','Katy Perry','EN','CevxZvSJLk8',58,68,'🦁','power','I got the eye of the tiger'],
  ['firework','Firework','Katy Perry','EN','QGJuMBdaqIw',62,72,'🎆','power','Baby, you are a firework'],
  ['radioactive','Radioactive','Imagine Dragons','EN','ktvTqknDobU',54,64,'☢️','rock','Welcome to the new age'],
  ['demons','Demons','Imagine Dragons','EN','mWRsgZuwf_8',50,60,'😈','rock','This is my kingdom come'],
  ['thunder','Thunder','Imagine Dragons','EN','fKopy74weus',50,60,'⛈️','rock','Thunder, feel the thunder'],
  ['someoneyouloved','Someone You Loved','Lewis Capaldi','EN','zABLecsR5UE',50,60,'💔','ballad','Now the day bleeds'],
  ['perfect','Perfect','Ed Sheeran','EN','2Vv-BfVoq4g',58,68,'💞','ballad','Darling, you look perfect tonight'],
  ['thinkingoutloud','Thinking Out Loud','Ed Sheeran','EN','lp-EO5I60KA',58,68,'💍','ballad','Take me into your loving arms'],
  ['senorita','Señorita','Shawn Mendes & Camila Cabello','EN','Pkh8UtuejGw',50,60,'🌴','pop','I love it when you call me señorita'],
  ['havana','Havana','Camila Cabello','EN','BQ0mxQXmLsk',56,66,'🌺','pop','Havana, ooh na-na'],
  ['stay','STAY','The Kid LAROI & Justin Bieber','EN','kTJczUoc26U',45,55,'⏳','pop','I need you to stay'],
  ['sorry','Sorry','Justin Bieber','EN','fRh_vgS2dFE',48,58,'🙏','dance','Is it too late now to say sorry'],
  ['wmuby','What Makes You Beautiful','One Direction','EN','QJO3ROT-A4E',55,65,'💫','pop','You do not know you are beautiful'],
  ['storyofmylife','Story of My Life','One Direction','EN','W-TE_Ys4iwM',52,62,'📖','ballad','The story of my life'],
  ['watermelon','Watermelon Sugar','Harry Styles','EN','E07s5ZYygMg',50,60,'🍉','pop','Watermelon sugar high'],
  ['adoreyou','Adore You','Harry Styles','EN','VF-r5TtlT9w',54,64,'🐟','pop','I would walk through fire for you'],
  ['wreckingball','Wrecking Ball','Miley Cyrus','EN','My2FRPA3Gf8',58,68,'🔨','power','I came in like a wrecking ball'],
  ['pokerface','Poker Face','Lady Gaga','EN','bESGLojNYSo',50,60,'♠️','dance','Poker face'],
  ['justdance','Just Dance','Lady Gaga','EN','2Abk1jAONjw',50,60,'🪩','dance','Just dance'],
  ['telephone','Telephone','Lady Gaga feat. Beyoncé','EN','EVBsypHzF3U',80,90,'☎️','dance','Stop calling'],
  ['newrules','New Rules','Dua Lipa','EN','k2qgadSvNyU',52,62,'📏','pop','I got new rules'],
  ['dontstartnow','Don’t Start Now','Dua Lipa','EN','oygrmJFKYZY',50,60,'🛼','dance','Do not start caring about me now'],
  ['shallow','Shallow','Lady Gaga & Bradley Cooper','EN','bo_efYhYU2A',80,90,'🎤','power','I am off the deep end'],
  ['despacito','Despacito','Luis Fonsi feat. Daddy Yankee','ES','kJQP7kiw5Fk',54,64,'🌴','dance','Despacito'],
  ['gangnam','Gangnam Style','PSY','KO','9bZkp7q19f0',60,70,'🕶️','dance','Oppan Gangnam Style'],
  ['dynamite','Dynamite','BTS','EN','gdZLi9oWNZg',50,60,'🧨','dance','Light it up like dynamite']
].map(([id,title,artist,language,youtubeId,start,end,emoji,style,lyricCue]) => ({
  id:`song-${id}`, title, artist, language, youtubeId, start, end, emoji, style, lyricCue,
  type:'youtube-song', duration:end-start,
  text:`Ascolta questi ${end-start} secondi e prova a imitarli nel modo più fedele possibile.`
}));

function makeCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  do{ code=Array.from({length:5},()=>chars[Math.floor(Math.random()*chars.length)]).join(''); }while(rooms.has(code));
  return code;
}
function publicPerformance(performance){
  if(!performance)return null;
  return { performerId:performance.performerId, audioDataUrl:performance.audioDataUrl };
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
    performance:publicPerformance(room.performance),
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
  room.phase='finished'; room.currentPrompt=null; room.performance=null;
  emitState(room); io.to(room.code).emit('game-finished');
}
function normalizeName(name){ return String(name||'').trim().slice(0,20)||'Giocatore'; }
function youtubeIdFrom(value){
  const raw=String(value||'').trim();
  if(/^[A-Za-z0-9_-]{11}$/.test(raw))return raw;
  const m=raw.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/i);
  return m?.[1]||null;
}
function cleanBreakdown(value){
  const src=value&&typeof value==='object'?value:{};
  const out={};
  for(const key of ['intonation','rhythm','voice','dynamics','cleanliness']){
    out[key]=Math.max(0,Math.min(100,Math.round(Number(src[key])||0)));
  }
  return out;
}

io.on('connection',socket=>{
  socket.on('create-room',({name}={},ack=()=>{})=>{
    const code=makeCode();
    const room={
      code, hostId:socket.id,
      players:[{id:socket.id,name:normalizeName(name),score:0,ready:false,connected:true}],
      settings:{rounds:8,aiWeight:0.5},
      phase:'lobby',round:0,currentPerformerId:null,currentPrompt:null,performance:null,lastResult:null,
      prompts:SONGS.map(x=>({...x})),usedPromptIds:new Set(),cleanupTimer:null
    };
    rooms.set(code,room); socket.join(code); socket.data.roomCode=code;
    ack({ok:true,code,playerId:socket.id}); emitState(room);
  });

  socket.on('join-room',({code,name}={},ack=()=>{})=>{
    code=String(code||'').trim().toUpperCase();
    const room=rooms.get(code);
    if(!room)return ack({ok:false,error:'Stanza non trovata.'});
    if(room.players.length>=2)return ack({ok:false,error:'La stanza è già piena.'});
    if(room.phase!=='lobby')return ack({ok:false,error:'La partita è già iniziata.'});
    room.players.push({id:socket.id,name:normalizeName(name),score:0,ready:false,connected:true});
    socket.join(code); socket.data.roomCode=code;
    ack({ok:true,code,playerId:socket.id}); emitState(room);
  });

  socket.on('set-ready',({ready}={})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=='lobby')return;
    const player=room.players.find(p=>p.id===socket.id);
    if(!player)return;
    player.ready=!!ready; emitState(room);
  });

  socket.on('update-settings',({rounds}={})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.hostId!==socket.id||room.phase!=='lobby')return;
    const allowed=[6,8,10,12,16];
    if(allowed.includes(Number(rounds)))room.settings.rounds=Number(rounds);
    emitState(room);
  });

  socket.on('add-custom-song',({title,artist,youtubeUrl,start,end,lyrics,style}={},ack=()=>{})=>{
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
      type:'youtube-song', title:String(title||'Canzone personalizzata').trim().slice(0,60),
      artist:String(artist||'Artista').trim().slice(0,50), language:'CUSTOM', youtubeId,
      start:s,end:e,duration:e-s,emoji:'🎵',custom:true,
      lyricCue:String(lyrics||'').trim().slice(0,500),
      style:['pop','dance','ballad','rap','rock','power'].includes(style)?style:'pop',
      text:`Ascolta questi ${e-s} secondi e prova a imitarli nel modo più fedele possibile.`
    });
    ack({ok:true}); emitState(room);
  });

  socket.on('start-game',()=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.hostId!==socket.id||room.phase!=='lobby')return;
    if(room.players.length!==2||!room.players.every(p=>p.ready))return;
    room.players.forEach(p=>p.score=0); room.round=0; room.usedPromptIds.clear();
    resetRoundData(room); beginRound(room);
  });

  socket.on('submit-performance',({audioDataUrl,aiScore,aiBreakdown}={},ack=()=>{})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=='perform'||room.currentPerformerId!==socket.id)return ack({ok:false,error:'Non è il tuo turno.'});
    if(!audioDataUrl||typeof audioDataUrl!=='string'||audioDataUrl.length>2500000)return ack({ok:false,error:'Registrazione non valida o troppo grande.'});
    const aiAvailable = aiScore !== null && aiScore !== undefined && aiScore !== '' && Number.isFinite(Number(aiScore));
    room.performance={
      performerId:socket.id,
      audioDataUrl,
      aiScore:aiAvailable ? Math.max(0,Math.min(100,Math.round(Number(aiScore)))) : null,
      aiBreakdown:cleanBreakdown(aiBreakdown)
    };
    room.phase='judge'; ack({ok:true}); emitState(room);
  });

  socket.on('submit-judge-score',({score}={},ack=()=>{})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=='judge'||!room.performance)return ack({ok:false});
    if(socket.id===room.currentPerformerId)return ack({ok:false,error:'Non puoi votarti.'});
    const judgeScore=Math.max(1,Math.min(10,Number(score)||1));
    const human100=Math.round(judgeScore*10);
    const aiScore=room.performance.aiScore;
    const aiUsed=aiScore !== null && aiScore !== undefined && Number.isFinite(Number(aiScore));
    const w=room.settings.aiWeight;
    const finalScore=aiUsed ? Math.round(human100*(1-w)+aiScore*w) : human100;
    const performer=room.players.find(p=>p.id===room.currentPerformerId);
    if(performer)performer.score+=finalScore;
    room.lastResult={
      performerId:room.currentPerformerId, judgeScore, humanScore:human100,
      aiScore:aiUsed ? aiScore : null, aiUsed,
      aiBreakdown:room.performance.aiBreakdown, finalScore
    };
    room.phase='result'; ack({ok:true}); emitState(room);
    setTimeout(()=>{
      if(!rooms.has(room.code)||room.phase!=='result')return;
      if(room.round>=room.settings.rounds)finishGame(room); else beginRound(room);
    },4600);
  });

  socket.on('rematch',()=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=='finished')return;
    room.phase='lobby'; room.round=0; room.currentPerformerId=null;
    room.players.forEach(p=>{p.score=0;p.ready=false});
    room.usedPromptIds.clear(); resetRoundData(room); emitState(room);
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

server.listen(PORT,'0.0.0.0',()=>console.log(`Choicer Voicer online on port ${PORT} • ${SONGS.length} songs`));