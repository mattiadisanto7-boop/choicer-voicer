const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, 'server.js');
const generatedPath = path.join(__dirname, 'server.generated.js');
let source = fs.readFileSync(sourcePath, 'utf8');

function replaceOnce(needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Bootstrap patch failed: ${label}`);
  source = source.replace(needle, replacement);
}

// Large extra catalog. Caption availability is verified by the client before the song is accepted for a round.
const extraSongs = `,
  ['hello','Hello','Adele','EN','YQHsXMglC9A',55,65,'👋','power',''],
  ['someonelikeyou','Someone Like You','Adele','EN','hLQl3WQQoQ0',50,60,'🎹','ballad',''],
  ['grenade','Grenade','Bruno Mars','EN','SR6iYWJxHqs',52,62,'💣','power',''],
  ['justtheway','Just the Way You Are','Bruno Mars','EN','LjhCEhWiKXk',55,65,'💛','pop',''],
  ['whenman','When I Was Your Man','Bruno Mars','EN','ekzHIouo8Q4',55,65,'🎹','ballad',''],
  ['24kmagic','24K Magic','Bruno Mars','EN','UqyT8IEBkvY',45,55,'✨','dance',''],
  ['blankspace','Blank Space','Taylor Swift','EN','e-ORhEE9VVg',52,62,'📝','pop',''],
  ['lovestory','Love Story','Taylor Swift','EN','8xg3vE8Ie_E',54,64,'🏰','pop',''],
  ['youbelong','You Belong With Me','Taylor Swift','EN','VuNIsY6JdUw',53,63,'💌','pop',''],
  ['antihero','Anti-Hero','Taylor Swift','EN','b1kbLwvqugk',54,64,'👻','pop',''],
  ['badguy','bad guy','Billie Eilish','EN','DyDfgMOUjCI',48,58,'😈','pop',''],
  ['happierthanever','Happier Than Ever','Billie Eilish','EN','5GJWxDKyk3A',118,128,'⚡','power',''],
  ['saveyourtears','Save Your Tears','The Weeknd','EN','XXYlFuWEuKI',52,62,'💧','pop',''],
  ['starboy','Starboy','The Weeknd','EN','34Na4j8AVgA',53,63,'⭐','pop',''],
  ['cantfeel','Can’t Feel My Face','The Weeknd','EN','KEI4qSrkPAs',52,62,'😎','dance',''],
  ['driverslicense','drivers license','Olivia Rodrigo','EN','ZmDBbnmKpqQ',58,68,'🚗','ballad',''],
  ['good4u','good 4 u','Olivia Rodrigo','EN','gNi_6U5Pm_o',52,62,'🔥','rock',''],
  ['7rings','7 rings','Ariana Grande','EN','QYh6mYIJG2Y',48,58,'💍','pop',''],
  ['thankunext','thank u, next','Ariana Grande','EN','gl1aHhXnN1k',50,60,'💅','pop',''],
  ['intoyou','Into You','Ariana Grande','EN','1ekZEVeXwek',55,65,'💜','power',''],
  ['problem','Problem','Ariana Grande','EN','iS1g8G_njx8',50,60,'❗','pop',''],
  ['loveyourself','Love Yourself','Justin Bieber','EN','oyEuk8j8imI',54,64,'🪞','pop',''],
  ['baby','Baby','Justin Bieber','EN','kffacxfA7G4',52,62,'🍼','pop',''],
  ['stitches','Stitches','Shawn Mendes','EN','VbfpW0pbvaU',52,62,'🩹','pop',''],
  ['physical','Physical','Dua Lipa','EN','9HDEHj2yzew',50,60,'🏃','dance',''],
  ['breakmyheart','Break My Heart','Dua Lipa','EN','Nj2U6rhnucI',51,61,'💔','dance',''],
  ['dancethenight','Dance The Night','Dua Lipa','EN','OiC1rgCPmUQ',48,58,'🪩','dance',''],
  ['photograph','Photograph','Ed Sheeran','EN','nSDgHBxUbVQ',57,67,'📷','ballad',''],
  ['badhabits','Bad Habits','Ed Sheeran','EN','orJSJGHjBLI',48,58,'🌙','dance',''],
  ['shivers','Shivers','Ed Sheeran','EN','Il0S8BoucSA',48,58,'🥶','pop',''],
  ['signofthetimes','Sign of the Times','Harry Styles','EN','qN4ooNx77u0',58,68,'☁️','power',''],
  ['latenighttalking','Late Night Talking','Harry Styles','EN','4VaqA-5aQTM',48,58,'🌃','pop',''],
  ['dragmedown','Drag Me Down','One Direction','EN','Jwgf3wmiA04',52,62,'⬇️','pop',''],
  ['bestsong','Best Song Ever','One Direction','EN','o_v9MY_FMcw',58,68,'🎉','pop',''],
  ['intheend','In the End','Linkin Park','EN','eVTXPUF4Oz4',55,65,'⌛','rock',''],
  ['whativedone','What I’ve Done','Linkin Park','EN','8sgycukafqQ',58,68,'⚡','rock',''],
  ['breakinghabit','Breaking the Habit','Linkin Park','EN','v2H4l9RpkwM',54,64,'🔗','rock',''],
  ['comeasyouare','Come As You Are','Nirvana','EN','vabnZ9-ex7o',50,60,'🎸','rock',''],
  ['dontstopmenow','Don’t Stop Me Now','Queen','EN','HgzGwKwLmgM',55,65,'👑','power',''],
  ['anotherone','Another One Bites the Dust','Queen','EN','rY0WxgSXdEE',52,62,'👑','rock',''],
  ['wewillrock','We Will Rock You','Queen','EN','-tJYN-eG1zk',45,55,'🥁','rock',''],
  ['livinprayer','Livin’ on a Prayer','Bon Jovi','EN','lDK9QqIzhwk',60,70,'🙏','rock',''],
  ['finalcountdown','The Final Countdown','Europe','EN','9jK-NcRmVcw',55,65,'🚀','rock',''],
  ['africa','Africa','Toto','EN','FTQbiNvZqaY',60,70,'🌍','pop',''],
  ['dancingqueen','Dancing Queen','ABBA','EN','xFrGuyw1V8s',55,65,'👑','dance',''],
  ['stayinalive','Stayin’ Alive','Bee Gees','EN','fNFzfwLM72c',50,60,'🕺','dance',''],
  ['toxic','Toxic','Britney Spears','EN','LOZuxwVk7TU',54,64,'☠️','dance',''],
  ['babyonemore','...Baby One More Time','Britney Spears','EN','C-u5WLJ9Yk4',53,63,'💗','pop',''],
  ['wannabe','Wannabe','Spice Girls','EN','gJLIiF15wjQ',50,60,'✌️','pop',''],
  ['iwantit','I Want It That Way','Backstreet Boys','EN','4fndeDfaWCg',58,68,'💙','pop',''],
  ['byebyebye','Bye Bye Bye','NSYNC','EN','Eo-KmOd3i7s',55,65,'👋','dance',''],
  ['complicated','Complicated','Avril Lavigne','EN','5NPBIwQyPWE',53,63,'🛹','rock',''],
  ['sk8erboi','Sk8er Boi','Avril Lavigne','EN','TIy3n2b7V9k',52,62,'🛹','rock',''],
  ['boulevard','Boulevard of Broken Dreams','Green Day','EN','Soa3gO7tL-c',55,65,'🛣️','rock',''],
  ['basketcase','Basket Case','Green Day','EN','NUTGr5t3MoY',50,60,'🧺','rock',''],
  ['bringmetolife','Bring Me to Life','Evanescence','EN','3YxaaGgTQYM',58,68,'🖤','power',''],
  ['miserybusiness','Misery Business','Paramore','EN','aCyGvGEtOwc',52,62,'🔥','rock',''],
  ['stillintoyou','Still Into You','Paramore','EN','ObL3L6MRvN4',52,62,'💗','rock',''],
  ['centuries','Centuries','Fall Out Boy','EN','LBr7kECsjcQ',52,62,'🏛️','rock',''],
  ['highhopes','High Hopes','Panic! At The Disco','EN','IPXIgEAGe4U',52,62,'🎈','power',''],
  ['blackparade','Welcome to the Black Parade','My Chemical Romance','EN','RRKJiM9Njr8',78,88,'🖤','rock',''],
  ['doiwanna','Do I Wanna Know?','Arctic Monkeys','EN','bpOSxM0rNPM',58,68,'🌊','rock',''],
  ['mrbrightside','Mr. Brightside','The Killers','EN','gGdGFtwCNBE',52,62,'✨','rock',''],
  ['wonderwall','Wonderwall','Oasis','EN','bx1Bh8ZvH84',55,65,'🎸','ballad',''],
  ['creep','Creep','Radiohead','EN','XFkzRNyygfk',54,64,'👁️','rock',''],
  ['feelgood','Feel Good Inc.','Gorillaz','EN','HyHNuVaZJ-k',52,62,'😄','rap',''],
  ['getlucky','Get Lucky','Daft Punk','EN','5NV6Rdv1a3I',52,62,'🍀','dance',''],
  ['thriftshop','Thrift Shop','Macklemore & Ryan Lewis','EN','QK8mJJJvaes',48,58,'🛍️','rap',''],
  ['partyrock','Party Rock Anthem','LMFAO','EN','KQ6zr6kCPj8',56,66,'🎉','dance',''],
  ['igottafeeling','I Gotta Feeling','The Black Eyed Peas','EN','uSD4vsh1zDA',58,68,'🙌','dance',''],
  ['timber','Timber','Pitbull feat. Kesha','EN','hHUbLv4ThOo',52,62,'🌲','dance',''],
  ['tiktok','TiK ToK','Kesha','EN','iP6XpLQM2Cs',50,60,'⏰','dance',''],
  ['callmemaybe','Call Me Maybe','Carly Rae Jepsen','EN','fWNaR-rxAic',52,62,'📞','pop',''],
  ['allaboutbass','All About That Bass','Meghan Trainor','EN','7PCkvCPvDXk',50,60,'🎵','pop',''],
  ['faded','Faded','Alan Walker','EN','60ItHLz5WEA',55,65,'🌫️','dance',''],
  ['wakemeup','Wake Me Up','Avicii','EN','IcrbM1l_BoI',55,65,'⏰','dance',''],
  ['thenights','The Nights','Avicii','EN','UtF6Jej8yb4',55,65,'🌙','dance',''],
  ['summer','Summer','Calvin Harris','EN','ebXbLfLACGM',50,60,'☀️','dance',''],
  ['ratherbe','Rather Be','Clean Bandit','EN','m-M1AtrxztU',52,62,'🎻','dance',''],
  ['leanon','Lean On','Major Lazer & DJ Snake','EN','YqeW9_5kURI',52,62,'🌴','dance',''],
  ['hipsdontlie','Hips Don’t Lie','Shakira','EN','DUT5rEU6pqM',55,65,'💃','dance',''],
  ['whenever','Whenever, Wherever','Shakira','EN','weRHyjj34ZE',54,64,'🌎','dance',''],
  ['bailando','Bailando','Enrique Iglesias','ES','NUsoVlDFqZg',55,65,'💃','dance',''],
  ['vidaloca','Livin’ la Vida Loca','Ricky Martin','EN','p47fEXGabaY',52,62,'🔥','dance',''],
  ['onthefloor','On The Floor','Jennifer Lopez','EN','t4H_Zoh7G5A',55,65,'💃','dance',''],
  ['paparazzi','Paparazzi','Lady Gaga','EN','d2smz_1L2_0',54,64,'📸','pop',''],
  ['crazyinlove','Crazy in Love','Beyoncé','EN','ViwtNLUqkMY',52,62,'❤️','dance',''],
  ['halo','Halo','Beyoncé','EN','bnVUHWCynig',55,65,'😇','power',''],
  ['diamonds','Diamonds','Rihanna','EN','lWA2pjMjpBs',54,64,'💎','power',''],
  ['onlygirl','Only Girl (In The World)','Rihanna','EN','pa14VNsdSYM',52,62,'🌍','dance',''],
  ['backtoblack','Back to Black','Amy Winehouse','EN','TJAfLE39ZZ8',55,65,'🖤','ballad',''],
  ['rehab','Rehab','Amy Winehouse','EN','KUmZp8pR1uc',50,60,'🎙️','pop',''],
  ['iwannadance','I Wanna Dance with Somebody','Whitney Houston','EN','eH3giaIzONA',55,65,'💃','power',''],
  ['allofme','All of Me','John Legend','EN','450p7goxZqg',58,68,'❤️','ballad',''],
  ['takemetochurch','Take Me to Church','Hozier','EN','PVjiKRfKpPI',55,65,'⛪','power',''],
  ['staywithme','Stay With Me','Sam Smith','EN','pB-5XG-DbAA',55,65,'🤝','ballad',''],
  ['beforeyougo','Before You Go','Lewis Capaldi','EN','Jtauh8GcxBY',55,65,'🚪','ballad',''],
  ['soldi','Soldi','Mahmood','IT','22lISUXgSUw',55,65,'💸','pop',''],
  ['zittiebuoni','ZITTI E BUONI','Måneskin','IT','QN1odfjtMoo',55,65,'🤫','rock',''],
  ['iwannabeslave','I WANNA BE YOUR SLAVE','Måneskin','EN','yOb9Xaug35M',50,60,'⛓️','rock',''],
  ['loneliest','THE LONELIEST','Måneskin','EN','odWKEfp2QMY',58,68,'🌑','power','']`;

const songMarker = '].map(([id,title,artist,language,youtubeId,start,end,emoji,style,lyricCue]) => ({';
const songIndex = source.indexOf(songMarker);
if (songIndex < 0) throw new Error('Bootstrap patch failed: song marker');
source = source.slice(0, songIndex) + extraSongs + '\n' + source.slice(songIndex);

const oldPicker = `function pickPrompt(room){
  let available=room.prompts.filter(p=>!room.usedPromptIds.has(p.id));
  if(!available.length){ room.usedPromptIds.clear(); available=[...room.prompts]; }
  const prompt=available[Math.floor(Math.random()*available.length)];
  room.usedPromptIds.add(prompt.id);
  return prompt;
}`;
const newPicker = `function pickPrompt(room){
  const rejected=room.captionRejectedIds||new Set();
  let available=room.prompts.filter(p=>!room.usedPromptIds.has(p.id)&&!rejected.has(p.id));
  if(!available.length){
    room.usedPromptIds.clear();
    available=room.prompts.filter(p=>!rejected.has(p.id));
  }
  if(!available.length){
    available=room.prompts.filter(p=>p.custom&&String(p.lyricCue||'').trim());
  }
  if(!available.length) available=[...room.prompts];

  const recent=room.recentPromptIds||[];
  const avoid=new Set(recent.slice(-60));
  const fresh=available.filter(p=>!avoid.has(p.id));
  if(fresh.length) available=fresh;

  const prompt=available[Math.floor(Math.random()*available.length)];
  room.usedPromptIds.add(prompt.id);
  room.recentPromptIds=recent;
  recent.push(prompt.id);
  if(recent.length>80) recent.splice(0,recent.length-80);
  return prompt;
}`;
replaceOnce(oldPicker, newPicker, 'prompt rotation');

replaceOnce(
  'prompts:SONGS.map(x=>({...x})),usedPromptIds:new Set(),cleanupTimer:null',
  'prompts:SONGS.map(x=>({...x})),usedPromptIds:new Set(),recentPromptIds:[],captionRejectedIds:new Set(),cleanupTimer:null',
  'room history'
);

const startGameMarker = "  socket.on('start-game',()=>{";
const rejectHandler = `  socket.on('reject-current-prompt',({promptId,reason}={},ack=()=>{})=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.phase!=='perform'||room.currentPerformerId!==socket.id)return ack({ok:false});
    if(!room.currentPrompt||room.currentPrompt.id!==promptId)return ack({ok:false});
    room.captionRejectedIds.add(promptId);
    room.currentPrompt=pickPrompt(room);
    room.performance=null;
    room.lastResult=null;
    emitState(room);
    io.to(room.code).emit('prompt-replaced',{promptId:room.currentPrompt?.id||null,reason:reason||'captions'});
    ack({ok:true});
  });

`;
replaceOnce(startGameMarker, rejectHandler + startGameMarker, 'caption reject handler');

fs.writeFileSync(generatedPath, source, 'utf8');
console.log('[bootstrap] Expanded catalog + caption filtering + long rotation enabled');
require(generatedPath);
