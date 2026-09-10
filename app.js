import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  onDisconnect,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js?v=3";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const ar = (v) => String(v).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
const enDigits = (v) => String(v).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

const configured = !Object.values(firebaseConfig).some(v => String(v).includes("PASTE_"));
let app, auth, db;
let uid = null;

let activeRoomPin = null;
let roomUnsub = null;
let hostPlayersUnsub = null;
let timerRAF = null;
let answerLocked = false;
let currentRole = null;
let localPlayerName = "";
let hostRoundResolving = false;
let practiceNumber = 2;
let practiceHidden = false;
let practiceShuffle = false;

const state = {
  hostTables: new Set([1,2,3,4,5,6,7,8,9,10]),
};

function showBanner(text) {
  const el = $("#connectionBanner");
  el.textContent = text;
  el.classList.remove("hidden");
}
function hideBanner() {
  $("#connectionBanner").classList.add("hidden");
}
function showView(id) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#" + id).classList.add("active");
  window.scrollTo({top:0,behavior:"smooth"});
}
function clearSubscriptions() {
  if (roomUnsub) { roomUnsub(); roomUnsub = null; }
  if (hostPlayersUnsub) { hostPlayersUnsub(); hostPlayersUnsub = null; }
  if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }
}
function home() {
  clearSubscriptions();
  activeRoomPin = null;
  currentRole = null;
  showView("homeView");
}

$$("[data-nav]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.nav)));
$$(".back").forEach(btn => btn.addEventListener("click", home));
$("#finalHomeBtn").addEventListener("click", home);

function makeTablePicker(container, selectedSet, onChange) {
  container.innerHTML = "";
  for (let n = 1; n <= 10; n++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "table-chip" + (selectedSet.has(n) ? " selected" : "");
    b.textContent = ar(n);
    b.addEventListener("click", () => {
      if (selectedSet.has(n)) {
        if (selectedSet.size === 1) return;
        selectedSet.delete(n);
      } else selectedSet.add(n);
      makeTablePicker(container, selectedSet, onChange);
      if (onChange) onChange();
    });
    container.appendChild(b);
  }
}
makeTablePicker($("#hostTables"), state.hostTables);

function renderPracticePicker() {
  const holder = $("#practiceTables");
  holder.innerHTML = "";
  for (let n=1;n<=10;n++) {
    const b=document.createElement("button");
    b.type="button";
    b.className="table-chip"+(n===practiceNumber?" selected":"");
    b.textContent=ar(n);
    b.addEventListener("click",()=>{practiceNumber=n;renderPracticePicker();renderPractice();});
    holder.appendChild(b);
  }
}
function renderPractice() {
  const holder=$("#practiceGrid");
  let rows=[1,2,3,4,5,6,7,8,9,10];
  if(practiceShuffle) rows=rows.sort(()=>Math.random()-.5);
  holder.innerHTML="";
  rows.forEach(n=>{
    const d=document.createElement("div");
    d.className="practice-item";
    d.textContent=`${ar(practiceNumber)} × ${ar(n)} = ${practiceHidden?"؟":ar(practiceNumber*n)}`;
    holder.appendChild(d);
  });
  $("#togglePracticeAnswers").textContent=practiceHidden?"👀 إظهار النتائج":"🙈 إخفاء النتائج";
}
$("#togglePracticeAnswers").addEventListener("click",()=>{practiceHidden=!practiceHidden;renderPractice();});
$("#shufflePractice").addEventListener("click",()=>{practiceShuffle=true;renderPractice();});
renderPracticePicker(); renderPractice();

if (!configured) {
  showBanner("⚙️ المشروع جاهز، لكن يلزم لصق إعدادات Firebase داخل firebase-config.js قبل تشغيل المسابقة الجماعية.");
  $("#createRoomBtn").disabled = true;
  $("#joinForm button[type=submit]").disabled = true;
} else {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);

  onAuthStateChanged(auth, user => {
    uid = user?.uid || null;
  });

  signInAnonymously(auth).catch(err => {
    console.error(err);
    showBanner("تعذر تسجيل الدخول المؤقت. تأكد من تفعيل Anonymous Authentication في Firebase.");
  });
}

async function ensureAuth() {
  if (!configured) throw new Error("Firebase غير مهيأ");
  if (auth.currentUser) {
    uid = auth.currentUser.uid;
    return uid;
  }
  const cred = await signInAnonymously(auth);
  uid = cred.user.uid;
  return uid;
}

function randomPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function randomQuestion(tables) {
  const a = tables[Math.floor(Math.random()*tables.length)];
  const b = 1 + Math.floor(Math.random()*10);
  return {a,b,answer:a*b};
}
function publicQuestion(q) {
  return {a:q.a,b:q.b};
}
function scoreFor(elapsedMs, maxMs) {
  const ratio = Math.max(0, Math.min(1, 1 - elapsedMs/maxMs));
  return 100 + Math.round(100 * ratio);
}
function playerArray(room) {
  return Object.entries(room?.players || {}).map(([id,p]) => ({id,...p}));
}
function renderLeaderboard(target, players) {
  const sorted=[...players].sort((a,b)=>(b.score||0)-(a.score||0) || (a.joinedAt||0)-(b.joinedAt||0));
  target.innerHTML="";
  sorted.forEach((p,i)=>{
    const row=document.createElement("div");
    row.className="rank-row";
    const rank=document.createElement("div");
    rank.className="rank-no";
    rank.textContent=i===0?"🥇":i===1?"🥈":i===2?"🥉":ar(i+1);
    const name=document.createElement("div");
    name.className="rank-name"; name.textContent=p.name||"لاعب";
    const score=document.createElement("div");
    score.className="rank-score"; score.textContent=ar(p.score||0);
    row.append(rank,name,score); target.appendChild(row);
  });
}

async function createRoom() {
  $("#hostSetupMessage").textContent="";
  $("#createRoomBtn").disabled=true;
  try {
    await ensureAuth();
    const settings = {
      tables: [...state.hostTables].sort((a,b)=>a-b),
      questionCount: Number($("#hostQuestionCount").value),
      seconds: Number($("#hostSeconds").value),
      showRoundLeaderboard: $("#showRoundLeaderboard").checked
    };

    let pin=null;
    for(let i=0;i<12;i++){
      const candidate=randomPin();
      const roomRef=ref(db,`rooms/${candidate}`);
      const result=await runTransaction(roomRef,current=>{
        if(current!==null) return;
        return {
          hostUid:uid,
          status:"lobby",
          createdAt:serverTimestamp(),
          settings,
          currentQuestionIndex:-1,
          phase:"lobby",
          players:{}
        };
      },{applyLocally:false});
      if(result.committed){pin=candidate;break;}
    }
    if(!pin) throw new Error("تعذر إنشاء رقم غرفة، حاول مرة أخرى.");
    activeRoomPin=pin; currentRole="host";
    $("#hostPin").textContent=pin;
    history.replaceState(null,"",`${location.pathname}?pin=${pin}`);
    subscribeHostLobby(pin);
    showView("hostLobbyView");
  } catch(err) {
    console.error(err);
    $("#hostSetupMessage").textContent=err.message||"تعذر إنشاء الغرفة.";
  } finally {
    $("#createRoomBtn").disabled=false;
  }
}
$("#createRoomBtn").addEventListener("click",createRoom);

function subscribeHostLobby(pin){
  clearSubscriptions();
  hostPlayersUnsub=onValue(ref(db,`rooms/${pin}`), snap=>{
    const room=snap.val();
    if(!room){home();return;}
    const players=playerArray(room);
    $("#playerCountBadge").textContent=ar(players.length);
    $("#emptyLobby").classList.toggle("hidden",players.length>0);
    $("#startLiveGameBtn").disabled=players.length<1;
    const holder=$("#hostPlayers"); holder.innerHTML="";
    players.forEach(p=>{
      const d=document.createElement("div");
      d.className="player-card"; d.textContent=p.name||"لاعب";
      holder.appendChild(d);
    });
  });
}

$("#shareRoomBtn").addEventListener("click", async ()=>{
  if(!activeRoomPin)return;
  const url=`${location.origin}${location.pathname}?pin=${activeRoomPin}`;
  const text=`انضم إلى Fahad Math Battle\nPIN: ${activeRoomPin}\n${url}`;
  if(navigator.share){
    try{await navigator.share({title:"Fahad Math Battle",text,url});return;}catch(_){}
  }
  prompt("انسخ رابط المشاركة:",text);
});

$("#closeRoomBtn").addEventListener("click",async()=>{
  if(activeRoomPin && configured){
    try{await remove(ref(db,`rooms/${activeRoomPin}`));}catch(_){}
  }
  history.replaceState(null,"",location.pathname);
  home();
});

async function startGameAsHost() {
  if(!activeRoomPin)return;
  const snap=await get(ref(db,`rooms/${activeRoomPin}`));
  const room=snap.val();
  if(!room || room.hostUid!==uid)return;
  const count=room.settings.questionCount;
  const questions=[];
  let last="";
  while(questions.length<count){
    const q=randomQuestion(room.settings.tables);
    const key=q.a+"x"+q.b;
    if(key===last)continue;
    questions.push(q); last=key;
  }
  const scoreReset={};
  Object.keys(room.players||{}).forEach(pid=>{
    scoreReset[`players/${pid}/score`]=0;
    scoreReset[`players/${pid}/correct`]=0;
  });
  await update(ref(db,`rooms/${activeRoomPin}`),{
    ...scoreReset,
    status:"playing",
    phase:"question",
    questions,
    currentQuestionIndex:0,
    questionPublic:publicQuestion(questions[0]),
    questionStartedAt:serverTimestamp(),
    answers:{}
  });
  subscribeHostGame(activeRoomPin);
  showView("hostGameView");
}
$("#startLiveGameBtn").addEventListener("click",startGameAsHost);

function subscribeHostGame(pin){
  clearSubscriptions();
  roomUnsub=onValue(ref(db,`rooms/${pin}`),snap=>{
    const room=snap.val();
    if(!room){home();return;}
    if(room.status==="finished"){showFinal(room);return;}
    if(room.status!=="playing")return;
    const idx=room.currentQuestionIndex||0;
    const total=room.settings.questionCount;
    $("#hostQuestionProgress").textContent=`${ar(idx+1)}/${ar(total)}`;
    const q=room.questionPublic;
    if(q) $("#hostQuestionText").textContent=`${ar(q.a)} × ${ar(q.b)} = ؟`;
    const answers=Object.keys(room.answers?.[idx]||{});
    const players=playerArray(room);
    $("#hostAnsweredCount").textContent=`${ar(answers.length)}/${ar(players.length)}`;
    renderLeaderboard($("#hostMiniLeaderboard"),players);
    runHostTimer(room);
  });
}

function runHostTimer(room){
  if(timerRAF){cancelAnimationFrame(timerRAF);timerRAF=null;}
  if(room.phase!=="question")return;
  const seconds=room.settings.seconds;
  const start=Number(room.questionStartedAt||Date.now());
  const maxMs=seconds*1000;
  const idx=room.currentQuestionIndex;
  const tick=()=>{
    const remain=Math.max(0,maxMs-(Date.now()-start));
    $("#hostTimer").textContent=ar((remain/1000).toFixed(1));
    $("#hostTimerBar").style.width=(remain/maxMs*100)+"%";
    const all=Object.keys(room.answers?.[idx]||{}).length>=Object.keys(room.players||{}).length && Object.keys(room.players||{}).length>0;
    if(remain<=0 || all){
      $("#hostRoundStatus").textContent=all?"جميع المتسابقين أجابوا ✅":"انتهى الوقت ⏰";
      resolveRound(idx).catch(console.error);
      return;
    }
    timerRAF=requestAnimationFrame(tick);
  };
  tick();
}

async function resolveRound(idx){
  if(hostRoundResolving || !activeRoomPin)return;
  hostRoundResolving=true;
  try{
    const snap=await get(ref(db,`rooms/${activeRoomPin}`));
    const room=snap.val();
    if(!room || room.hostUid!==uid || room.phase!=="question" || room.currentQuestionIndex!==idx)return;
    const q=room.questions[idx];
    const maxMs=room.settings.seconds*1000;
    const answers=room.answers?.[idx]||{};
    const updates={phase:"results"};
    Object.entries(room.players||{}).forEach(([pid,p])=>{
      const a=answers[pid];
      if(a && Number(a.value)===Number(q.answer)){
        const elapsed=Math.max(0,Math.min(maxMs,Number(a.elapsedMs)||maxMs));
        updates[`players/${pid}/score`]=(p.score||0)+scoreFor(elapsed,maxMs);
        updates[`players/${pid}/correct`]=(p.correct||0)+1;
      }
    });
    await update(ref(db,`rooms/${activeRoomPin}`),updates);
    const resultSnap=await get(ref(db,`rooms/${activeRoomPin}`));
    const resultRoom=resultSnap.val();
    renderLeaderboard($("#hostMiniLeaderboard"),playerArray(resultRoom));
    await new Promise(r=>setTimeout(r,resultRoom.settings.showRoundLeaderboard?2200:900));
    await advanceHostRound(resultRoom);
  } finally {
    hostRoundResolving=false;
  }
}

async function advanceHostRound(room){
  if(!activeRoomPin)return;
  const next=(room.currentQuestionIndex||0)+1;
  if(next>=room.settings.questionCount){
    await update(ref(db,`rooms/${activeRoomPin}`),{
      status:"finished",phase:"finished",finishedAt:serverTimestamp()
    });
    return;
  }
  await update(ref(db,`rooms/${activeRoomPin}`),{
    phase:"question",
    currentQuestionIndex:next,
    questionPublic:publicQuestion(room.questions[next]),
    questionStartedAt:serverTimestamp()
  });
}

$("#joinForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const pin=enDigits($("#joinPin").value).replace(/\D/g,"").slice(0,6);
  const name=$("#joinName").value.trim().slice(0,20);
  $("#joinMessage").textContent="";
  if(pin.length!==6){$("#joinMessage").textContent="أدخل PIN من ٦ أرقام.";return;}
  if(!name){$("#joinMessage").textContent="اكتب اسم المتسابق.";return;}
  try{
    await ensureAuth();
    const roomSnap=await get(ref(db,`rooms/${pin}`));
    const room=roomSnap.val();
    if(!room){throw new Error("الغرفة غير موجودة.");}
    if(room.status!=="lobby"){throw new Error("المسابقة بدأت بالفعل.");}
    const names=playerArray(room).map(p=>(p.name||"").toLowerCase());
    if(names.includes(name.toLowerCase()))throw new Error("الاسم مستخدم داخل الغرفة.");
    activeRoomPin=pin;currentRole="player";localPlayerName=name;
    await set(ref(db,`rooms/${pin}/players/${uid}`),{
      name,score:0,correct:0,joinedAt:serverTimestamp()
    });
    onDisconnect(ref(db,`rooms/${pin}/players/${uid}`)).remove();
    $("#playerLobbyName").textContent=name;
    $("#playerLobbyPin").textContent=pin;
    subscribePlayerRoom(pin);
    showView("playerLobbyView");
  }catch(err){
    console.error(err);
    $("#joinMessage").textContent=err.message||"تعذر الانضمام.";
  }
});

function subscribePlayerRoom(pin){
  clearSubscriptions();
  roomUnsub=onValue(ref(db,`rooms/${pin}`),snap=>{
    const room=snap.val();
    if(!room){showBanner("تم إنهاء الغرفة بواسطة المضيف.");home();return;}
    const me=room.players?.[uid];
    if(!me){return;}
    if(room.status==="lobby"){showView("playerLobbyView");return;}
    if(room.status==="finished"){showFinal(room);return;}
    if(room.status==="playing"){
      if(room.phase==="results" && room.settings.showRoundLeaderboard){
        renderLeaderboard($("#roundLeaderboard"),playerArray(room));
        showView("roundLeaderboardView");
      }else if(room.phase==="question"){
        renderPlayerQuestion(room,me);
        showView("playerGameView");
      }
    }
  });
}

function renderPlayerQuestion(room,me){
  const idx=room.currentQuestionIndex||0;
  const total=room.settings.questionCount;
  const q=room.questionPublic;
  $("#playerScore").textContent=ar(me.score||0);
  $("#playerQuestionProgress").textContent=`${ar(idx+1)}/${ar(total)}`;
  $("#playerQuestionText").textContent=`${ar(q.a)} × ${ar(q.b)} = ؟`;
  const existing=room.answers?.[idx]?.[uid];
  answerLocked=Boolean(existing);
  $("#answerInput").disabled=answerLocked;
  $("#answerForm button").disabled=answerLocked;
  $("#answerFeedback").textContent=answerLocked?"تم تسجيل إجابتك ✓":"";
  if(!answerLocked){$("#answerInput").value="";setTimeout(()=>$("#answerInput").focus(),60);}
  runPlayerTimer(room);
}

function runPlayerTimer(room){
  if(timerRAF){cancelAnimationFrame(timerRAF);timerRAF=null;}
  const maxMs=room.settings.seconds*1000;
  const start=Number(room.questionStartedAt||Date.now());
  const tick=()=>{
    const elapsed=Date.now()-start;
    const remain=Math.max(0,maxMs-elapsed);
    $("#playerTimer").textContent=ar((remain/1000).toFixed(1));
    $("#playerTimerBar").style.width=(remain/maxMs*100)+"%";
    if(remain<=0){
      $("#answerInput").disabled=true;
      $("#answerForm button").disabled=true;
      if(!answerLocked)$("#answerFeedback").textContent="انتهى الوقت ⏰";
      return;
    }
    timerRAF=requestAnimationFrame(tick);
  };
  tick();
}

$("#answerForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(answerLocked || !activeRoomPin || !uid)return;
  const raw=enDigits($("#answerInput").value).trim();
  if(!/^\d+$/.test(raw))return;
  answerLocked=true;
  $("#answerInput").disabled=true;
  $("#answerForm button").disabled=true;
  try{
    const roomSnap=await get(ref(db,`rooms/${activeRoomPin}`));
    const room=roomSnap.val();
    if(!room || room.phase!=="question")return;
    const idx=room.currentQuestionIndex;
    const start=Number(room.questionStartedAt||Date.now());
    const elapsedMs=Math.max(0,Date.now()-start);
    if(elapsedMs>room.settings.seconds*1000+800)return;
    const ansRef=ref(db,`rooms/${activeRoomPin}/answers/${idx}/${uid}`);
    const result=await runTransaction(ansRef,current=>{
      if(current!==null)return;
      return {value:Number(raw),elapsedMs,submittedAt:serverTimestamp()};
    },{applyLocally:false});
    $("#answerFeedback").textContent=result.committed?"تم تسجيل إجابتك ✓":"تم تسجيل إجابة سابقة.";
  }catch(err){
    console.error(err);
    answerLocked=false;
    $("#answerInput").disabled=false;
    $("#answerForm button").disabled=false;
    $("#answerFeedback").textContent="تعذر إرسال الإجابة، حاول مرة أخرى.";
  }
});

$("#leaveRoomBtn").addEventListener("click",async()=>{
  if(activeRoomPin && uid && configured){
    try{await remove(ref(db,`rooms/${activeRoomPin}/players/${uid}`));}catch(_){}
  }
  home();
});

function showFinal(room){
  if(timerRAF){cancelAnimationFrame(timerRAF);timerRAF=null;}
  const players=playerArray(room).sort((a,b)=>(b.score||0)-(a.score||0));
  renderLeaderboard($("#finalLeaderboard"),players);
  $("#winnerLine").textContent=players[0]?`الفائز: ${players[0].name} — ${ar(players[0].score||0)} نقطة`:"انتهت المسابقة";
  showView("finalView");
}

const urlPin=new URLSearchParams(location.search).get("pin");
if(urlPin && /^\d{6}$/.test(urlPin)){
  $("#joinPin").value=urlPin;
  showView("joinView");
}
