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
import { firebaseConfig } from "./firebase-config.js?v=9";

// ── Configuration and shared helpers ────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const ar = (v) => String(v).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
const enDigits = (v) => String(v).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

const configured = !Object.values(firebaseConfig).some(v => String(v).includes("PASTE_"));
let app, auth, db;
let uid = null;

// ── State ────────────────────────────────────────────────────────────────────
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
let resumeAttempted = false;
let activeAvatarId = "scientist";
let renderedPlayerQuestionKey = null;

const SESSION_KEY = "mathBattleV9Session";

const state = {
  hostTables: new Set([1,2,3,4,5,6,7,8,9,10]),
};

const avatarCatalog = [
  { id: "scientist", src: "./assets/avatars/scientist.webp?v=9", label: "العالِم الصغير", theme: "avatar-theme-1" },
  { id: "inventor", src: "./assets/avatars/inventor.webp?v=9", label: "المخترعة الصغيرة", theme: "avatar-theme-2" },
  { id: "robot", src: "./assets/avatars/robot.webp?v=9", label: "الروبوت الذكي", theme: "avatar-theme-3" },
  { id: "astronaut", src: "./assets/avatars/astronaut.webp?v=9", label: "رائدة الفضاء", theme: "avatar-theme-4" },
  { id: "chess", src: "./assets/avatars/chess.webp?v=9", label: "خبير الشطرنج", theme: "avatar-theme-5" },
  { id: "detective", src: "./assets/avatars/detective.webp?v=9", label: "المحققة الصغيرة", theme: "avatar-theme-6" },
  { id: "coder", src: "./assets/avatars/coder.webp?v=9", label: "المبرمج الصغير", theme: "avatar-theme-7" },
  { id: "knowledge", src: "./assets/avatars/knowledge.webp?v=9", label: "حارسة المعرفة", theme: "avatar-theme-8" }
];

let pendingJoin = null;
let avatarChoiceTimer = null;
let avatarChoiceRemaining = 10;
let avatarChoiceLocked = false;

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
  document.body.dataset.view = id;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({top:0,behavior:smooth ? "smooth" : "auto"});
}
function saveSession(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {}
}
function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (_) { return null; }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

// ── Navigation ───────────────────────────────────────────────────────────────
function clearSubscriptions() {
  if (roomUnsub) { roomUnsub(); roomUnsub = null; }
  if (hostPlayersUnsub) { hostPlayersUnsub(); hostPlayersUnsub = null; }
  if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }
}
function home() {
  clearSubscriptions();
  resetAvatarTimer();
  pendingJoin = null;
  activeRoomPin = null;
  currentRole = null;
  activeAvatarId = "scientist";
  renderedPlayerQuestionKey = null;
  clearSession();
  history.replaceState(null, "", location.pathname);
  showView("homeView");
}

$$("[data-nav]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.nav)));
$$(".back").forEach(btn => btn.addEventListener("click", home));
$("#avatarBackBtn")?.addEventListener("click", () => { resetAvatarTimer(); pendingJoin = null; showView("joinView"); });
$("#finalHomeBtn").addEventListener("click", exitToHome);

async function exitToHome() {
  const pin = activeRoomPin;
  const role = currentRole;
  clearSubscriptions();
  try {
    if (configured && pin && uid) {
      await cancelPresence(pin, role);
      if (role === "host") await remove(ref(db, `rooms/${pin}`));
      if (role === "player") await remove(ref(db, `rooms/${pin}/players/${uid}`));
    }
  } catch (err) {
    console.warn("تعذر تنظيف الغرفة عند الخروج", err);
  }
  history.replaceState(null, "", location.pathname);
  activeRoomPin = null;
  currentRole = null;
  activeAvatarId = "scientist";
  renderedPlayerQuestionKey = null;
  clearSession();
  showView("homeView");
}
$("#brandHomeBtn").addEventListener("click", exitToHome);

// ── Practice mode ────────────────────────────────────────────────────────────
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
  $("#togglePracticeAnswers").textContent=practiceHidden?"إظهار النتائج":"إخفاء النتائج";
}
$("#togglePracticeAnswers").addEventListener("click",()=>{practiceHidden=!practiceHidden;renderPractice();});
$("#shufflePractice").addEventListener("click",()=>{practiceShuffle=true;renderPractice();});
renderPracticePicker(); renderPractice();

// ── Avatar system ────────────────────────────────────────────────────────────
function avatarById(id) {
  return avatarCatalog.find(a => a.id === id) || avatarCatalog[0];
}
function renderAvatarBubble(avatarId, className = "rank-avatar") {
  const avatar = avatarById(avatarId);
  const bubble = document.createElement("div");
  bubble.className = `${className} ${avatar.theme}`;
  const img = document.createElement("img");
  img.className = "avatar-image";
  img.src = avatar.src;
  img.alt = "";
  img.decoding = "async";
  bubble.appendChild(img);
  return bubble;
}
function applyAvatarToElement(target, avatarId, className) {
  const avatar = avatarById(avatarId);
  target.innerHTML = "";
  target.className = `${className} ${avatar.theme}`;
  const img = document.createElement("img");
  img.className = "avatar-image";
  img.src = avatar.src;
  img.alt = avatar.label;
  img.decoding = "async";
  target.appendChild(img);
}
function stopAvatarTimer() {
  if (avatarChoiceTimer) { clearInterval(avatarChoiceTimer); avatarChoiceTimer = null; }
}
function resetAvatarTimer() {
  stopAvatarTimer();
  avatarChoiceRemaining = 10;
  avatarChoiceLocked = false;
}
function updateAvatarTimerUi() {
  const t = ar(avatarChoiceRemaining);
  if ($("#avatarCountdown")) $("#avatarCountdown").textContent = t;
  if ($("#avatarCountdownBadge")) $("#avatarCountdownBadge").textContent = t;
}
function renderAvatarCatalog() {
  const holder = $("#avatarCatalog");
  if (!holder) return;
  holder.innerHTML = "";
  avatarCatalog.forEach((avatar) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `avatar-card ${avatar.theme}`;
    btn.setAttribute("aria-label", `اختيار ${avatar.label}`);
    const img = document.createElement("img");
    img.className = "avatar-image";
    img.src = avatar.src;
    img.alt = "";
    img.decoding = "async";
    btn.appendChild(img);
    btn.addEventListener("click", () => completeJoinWithAvatar(avatar.id));
    holder.appendChild(btn);
  });
}
async function completeJoinWithAvatar(avatarId) {
  if (!pendingJoin || avatarChoiceLocked) return;
  avatarChoiceLocked = true;
  stopAvatarTimer();
  const { pin, name } = pendingJoin;
  try {
    await ensureAuth();
    const roomSnap = await get(ref(db, `rooms/${pin}`));
    const room = roomSnap.val();
    if (!room) throw new Error("الغرفة غير موجودة.");
    if (room.status !== "lobby") throw new Error("المسابقة بدأت بالفعل.");
    const names = playerArray(room).map(p => (p.name || "").toLowerCase());
    if (names.includes(name.toLowerCase())) throw new Error("الاسم مستخدم داخل الغرفة.");
    activeRoomPin = pin; currentRole = "player"; localPlayerName = name; activeAvatarId = avatarId;
    await set(ref(db, `rooms/${pin}/players/${uid}`), {
      name,
      avatar: avatarId,
      score: 0,
      correct: 0,
      connected: true,
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });
    await armPlayerPresence(pin);
    saveSession({ role: "player", pin, name, avatar: avatarId });
    history.replaceState(null,"",`${location.pathname}?pin=${pin}`);
    applyAvatarToElement($("#playerLobbyAvatar"), avatarId, "player-waiting-avatar");
    $("#playerLobbyName").textContent = name;
    $("#playerLobbyPin").textContent = pin;
    pendingJoin = null;
    subscribePlayerRoom(pin);
    showView("playerLobbyView");
  } catch (err) {
    console.error(err);
    avatarChoiceLocked = false;
    pendingJoin = { pin, name };
    $("#joinMessage").textContent = err.message || "تعذر الانضمام.";
    showView("joinView");
  }
}
function beginAvatarChoice(pin, name) {
  pendingJoin = { pin, name };
  resetAvatarTimer();
  renderAvatarCatalog();
  updateAvatarTimerUi();
  showView("avatarSelectView");
  avatarChoiceTimer = setInterval(() => {
    avatarChoiceRemaining -= 1;
    updateAvatarTimerUi();
    if (avatarChoiceRemaining <= 0) {
      const auto = avatarCatalog[Math.floor(Math.random() * avatarCatalog.length)];
      completeJoinWithAvatar(auto.id);
    }
  }, 1000);
}

// ── Firebase authentication, presence, and session recovery ─────────────────
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
    if (uid && !resumeAttempted) {
      resumeAttempted = true;
      resumeSession().catch(err => console.warn("تعذر استعادة الجلسة", err));
    }
  });

  onValue(ref(db, ".info/connected"), snap => {
    if (snap.val() === true) {
      hideBanner();
      if (activeRoomPin && currentRole === "player") armPlayerPresence(activeRoomPin).catch(() => {});
      if (activeRoomPin && currentRole === "host") armHostPresence(activeRoomPin).catch(() => {});
    } else {
      showBanner("الاتصال متوقف مؤقتًا — سنعيد مزامنة اللعبة تلقائيًا عند عودة الشبكة.");
    }
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

async function armPlayerPresence(pin) {
  if (!db || !uid || !pin) return;
  const playerRef = ref(db, `rooms/${pin}/players/${uid}`);
  await onDisconnect(playerRef).update({ connected: false, lastSeen: serverTimestamp() });
  await update(playerRef, { connected: true, lastSeen: serverTimestamp() });
}

async function armHostPresence(pin) {
  if (!db || !uid || !pin) return;
  const connectedRef = ref(db, `rooms/${pin}/hostConnected`);
  await onDisconnect(connectedRef).set(false);
  await update(ref(db, `rooms/${pin}`), { hostConnected: true, hostLastSeen: serverTimestamp() });
}

async function cancelPresence(pin, role) {
  if (!db || !uid || !pin) return;
  if (role === "player") await onDisconnect(ref(db, `rooms/${pin}/players/${uid}`)).cancel();
  if (role === "host") await onDisconnect(ref(db, `rooms/${pin}/hostConnected`)).cancel();
}

async function resumeSession() {
  const saved = readSession();
  if (!saved || !/^\d{6}$/.test(String(saved.pin || "")) || !["host", "player"].includes(saved.role)) return;

  const pin = String(saved.pin);
  const roomSnap = await get(ref(db, `rooms/${pin}`));
  const room = roomSnap.val();
  if (!room) { clearSession(); return; }

  if (saved.role === "host" && room.hostUid === uid) {
    activeRoomPin = pin;
    currentRole = "host";
    $("#hostPin").textContent = pin;
    renderRoomQr(pin);
    history.replaceState(null, "", `${location.pathname}?pin=${pin}`);
    await armHostPresence(pin);
    if (room.status === "lobby") {
      subscribeHostLobby(pin);
      showView("hostLobbyView");
    } else if (room.status === "playing") {
      subscribeHostGame(pin);
      showView("hostGameView");
    } else if (room.status === "finished") {
      showFinal(room);
    }
    return;
  }

  const me = room.players?.[uid];
  if (saved.role === "player" && me) {
    activeRoomPin = pin;
    currentRole = "player";
    localPlayerName = me.name || saved.name || "لاعب";
    activeAvatarId = me.avatar || saved.avatar || "scientist";
    applyAvatarToElement($("#playerLobbyAvatar"), activeAvatarId, "player-waiting-avatar");
    $("#playerLobbyName").textContent = localPlayerName;
    $("#playerLobbyPin").textContent = pin;
    history.replaceState(null, "", `${location.pathname}?pin=${pin}`);
    await armPlayerPresence(pin);
    subscribePlayerRoom(pin);
    return;
  }

  clearSession();
}

// ── Question generation and scoring ─────────────────────────────────────────
function randomPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function shuffleArray(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function buildQuestionPool(tables) {
  const pool = [];
  tables.forEach(a => { for (let b = 1; b <= 10; b++) pool.push({a, b, answer: a*b}); });
  return shuffleArray(pool);
}
function publicQuestion(q) {
  return {a:q.a,b:q.b};
}
function scoreFor(elapsedMs, maxMs) {
  const ratio = Math.max(0, Math.min(1, 1 - elapsedMs/maxMs));
  return 100 + Math.round(100 * ratio);
}
function updateTimerBar(bar, remain, maxMs) {
  const ratio = maxMs > 0 ? Math.max(0, Math.min(1, remain / maxMs)) : 0;
  bar.style.width = `${ratio * 100}%`;
  bar.dataset.level = ratio <= .25 ? "danger" : ratio <= .55 ? "warn" : "safe";
}
function playerArray(room) {
  return Object.entries(room?.players || {}).map(([id,p]) => ({id,...p}));
}
function roundAnswers(room, idx) {
  return room?.answers?.[idx] || {};
}

// ── Leaderboards ─────────────────────────────────────────────────────────────
function sortPlayers(players) {
  return [...players].sort((a,b)=>(b.score||0)-(a.score||0) || (b.correct||0)-(a.correct||0) || (a.joinedAt||0)-(b.joinedAt||0) || String(a.id||"").localeCompare(String(b.id||"")));
}
function renderLeaderboard(target, players) {
  const sorted=sortPlayers(players);
  target.innerHTML="";
  sorted.forEach((p,i)=>{
    const row=document.createElement("div");
    row.className=`rank-row${i<3?` top-${i+1}`:""}`;
    const rank=document.createElement("div");
    rank.className="rank-no";
    rank.textContent=ar(i+1);
    const main=document.createElement("div");
    main.className="rank-main";
    main.appendChild(renderAvatarBubble(p.avatar, "rank-avatar"));
    const nameWrap=document.createElement("div");
    nameWrap.className="rank-name-wrap";
    const name=document.createElement("div");
    name.className="rank-name"; name.textContent=p.name||"لاعب";
    const correct=document.createElement("small");
    correct.className="rank-correct";
    correct.textContent=`${ar(p.correct||0)} صحيحة`;
    nameWrap.append(name,correct);
    main.appendChild(nameWrap);
    const score=document.createElement("div");
    score.className="rank-score"; score.textContent=ar(p.score||0);
    row.append(rank,main,score);
    target.appendChild(row);
  });
}

function roomJoinUrl(pin) {
  return `${location.origin}${location.pathname}?pin=${pin}`;
}

function renderRoomQr(pin) {
  const holder = $("#roomQr");
  if (!holder) return;
  holder.innerHTML = "";
  const url = roomJoinUrl(pin);
  if (window.QRCode) {
    new window.QRCode(holder, {
      text: url,
      width: 180,
      height: 180,
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } else {
    holder.textContent = "QR غير متاح";
  }
}

// ── Host flow ────────────────────────────────────────────────────────────────
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
          hostConnected:true,
          hostLastSeen:serverTimestamp(),
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
    saveSession({ role: "host", pin });
    await armHostPresence(pin);
    $("#hostPin").textContent=pin;
    renderRoomQr(pin);
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
    const connectedPlayers=players.filter(p=>p.connected!==false);
    renderRoomQr(pin);
    $("#playerCountBadge").textContent=ar(connectedPlayers.length);
    $("#emptyLobby").classList.toggle("hidden",players.length>0);
    $("#startLiveGameBtn").disabled=connectedPlayers.length<1;
    const holder=$("#hostPlayers"); holder.innerHTML="";
    players.forEach(p=>{
      const d=document.createElement("div");
      d.className=`player-card${p.connected===false?" offline":""}`;
      if(p.connected===false)d.title="غير متصل مؤقتًا";
      const wrap=document.createElement("div");
      wrap.className="player-mini";
      wrap.appendChild(renderAvatarBubble(p.avatar, "player-avatar-mini"));
      const name=document.createElement("div");
      name.className="player-name-only";
      name.textContent=p.name||"لاعب";
      wrap.appendChild(name);
      d.appendChild(wrap);
      holder.appendChild(d);
    });
  });
}

$("#shareRoomBtn").addEventListener("click", async ()=>{
  if(!activeRoomPin)return;
  const url=roomJoinUrl(activeRoomPin);
  const text=`انضم إلى Math Battle\nPIN: ${activeRoomPin}\n${url}`;
  if(navigator.share){
    try{await navigator.share({title:"Math Battle",text,url});return;}catch(_){}
  }
  prompt("انسخ رابط المشاركة:",text);
});


$("#copyPinBtn").addEventListener("click", async ()=>{
  if(!activeRoomPin)return;
  try{
    await navigator.clipboard.writeText(activeRoomPin);
    $("#copyPinBtn").textContent="تم النسخ ✓";
    setTimeout(()=>$("#copyPinBtn").textContent="نسخ PIN",1200);
  }catch(_){
    prompt("انسخ رقم الغرفة:",activeRoomPin);
  }
});

$("#closeRoomBtn").addEventListener("click",async()=>{
  if(activeRoomPin && configured){
    try{
      await cancelPresence(activeRoomPin,"host");
      await remove(ref(db,`rooms/${activeRoomPin}`));
    }catch(_){}
  }
  history.replaceState(null,"",location.pathname);
  home();
});

async function startGameAsHost() {
  if(!activeRoomPin)return;
  const snap=await get(ref(db,`rooms/${activeRoomPin}`));
  const room=snap.val();
  if(!room || room.hostUid!==uid)return;
  const requestedCount=room.settings.questionCount;
  const pool=buildQuestionPool(room.settings.tables);
  const questions=pool.slice(0, Math.min(requestedCount, pool.length));
  const scoreReset={};
  Object.keys(room.players||{}).forEach(pid=>{
    scoreReset[`players/${pid}/score`]=0;
    scoreReset[`players/${pid}/correct`]=0;
  });
  await update(ref(db,`rooms/${activeRoomPin}`),{
    ...scoreReset,
    answers:null,
    "settings/questionCount": questions.length,
    status:"playing",
    phase:"question",
    questions,
    currentQuestionIndex:0,
    questionPublic:publicQuestion(questions[0]),
    questionStartedAt:serverTimestamp()
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
    const answers=Object.keys(roundAnswers(room,idx));
    const players=playerArray(room);
    const connectedPlayers=players.filter(p=>p.connected!==false);
    const connectedAnswers=connectedPlayers.filter(p=>answers.includes(p.id)).length;
    $("#hostAnsweredCount").textContent=`${ar(connectedAnswers)}/${ar(connectedPlayers.length)}`;
    renderLeaderboard($("#hostMiniLeaderboard"),players);
    const nextBtn=$("#hostNextQuestionBtn");
    if(room.phase==="results"){
      if(timerRAF){cancelAnimationFrame(timerRAF);timerRAF=null;}
      $("#hostTimer").textContent="٠٫٠";
      updateTimerBar($("#hostTimerBar"),0,1);
      $("#hostRoundStatus").textContent="انتهت الجولة — اضغط للانتقال عندما تكون جاهزًا.";
      const last=idx>=total-1;
      nextBtn.textContent=last?"عرض النتيجة النهائية":"السؤال التالي";
      nextBtn.classList.remove("hidden");
    }else{
      nextBtn.classList.add("hidden");
      $("#hostRoundStatus").textContent="";
      runHostTimer(room);
    }
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
    updateTimerBar($("#hostTimerBar"),remain,maxMs);
    const activePlayers=playerArray(room).filter(p=>p.connected!==false);
    const answeredIds=new Set(Object.keys(roundAnswers(room,idx)));
    const all=activePlayers.length>0 && activePlayers.every(p=>answeredIds.has(p.id));
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
    const answers=roundAnswers(room,idx);
    const updates={phase:"results"};
    Object.entries(room.players||{}).forEach(([pid,p])=>{
      const a=answers[pid];
      if(a && Number(a.value)===Number(q.answer)){
        const submittedElapsed=Number(a.elapsedMs);
        const elapsed=Math.max(0,Math.min(maxMs,Number.isFinite(submittedElapsed)?submittedElapsed:maxMs));
        updates[`players/${pid}/score`]=(p.score||0)+scoreFor(elapsed,maxMs);
        updates[`players/${pid}/correct`]=(p.correct||0)+1;
      }
    });
    await update(ref(db,`rooms/${activeRoomPin}`),updates);
    const resultSnap=await get(ref(db,`rooms/${activeRoomPin}`));
    const resultRoom=resultSnap.val();
    renderLeaderboard($("#hostMiniLeaderboard"),playerArray(resultRoom));
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


$("#hostQuitGameBtn").addEventListener("click", async()=>{
  if(!activeRoomPin)return;
  try{
    await update(ref(db,`rooms/${activeRoomPin}`),{
      status:"finished",
      phase:"finished",
      finishedAt:serverTimestamp()
    });
  }catch(err){
    console.error(err);
    await exitToHome();
  }
});

$("#hostNextQuestionBtn").addEventListener("click", async()=>{
  if(!activeRoomPin)return;
  const btn=$("#hostNextQuestionBtn");
  btn.disabled=true;
  try{
    const snap=await get(ref(db,`rooms/${activeRoomPin}`));
    const room=snap.val();
    if(!room || room.hostUid!==uid || room.phase!=="results")return;
    await advanceHostRound(room);
  }catch(err){
    console.error(err);
    $("#hostRoundStatus").textContent="تعذر الانتقال للسؤال التالي، حاول مرة أخرى.";
  }finally{
    btn.disabled=false;
  }
});

// ── Player flow ──────────────────────────────────────────────────────────────
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
    beginAvatarChoice(pin, name);
  }catch(err){
    console.error(err);
    $("#joinMessage").textContent=err.message||"تعذر الانتقال لاختيار الشخصية.";
  }
});

function subscribePlayerRoom(pin){
  clearSubscriptions();
  roomUnsub=onValue(ref(db,`rooms/${pin}`),snap=>{
    const room=snap.val();
    if(!room){showBanner("تم إنهاء الغرفة بواسطة المضيف.");home();return;}
    const me=room.players?.[uid];
    if(!me){return;}
    activeAvatarId = me.avatar || activeAvatarId;
    localPlayerName = me.name || localPlayerName || "لاعب";
    applyAvatarToElement($("#playerLobbyAvatar"), activeAvatarId, "player-waiting-avatar");
    $("#playerLobbyName").textContent = localPlayerName;
    $("#playerLobbyPin").textContent = pin;
    if(room.status==="lobby"){showView("playerLobbyView");return;}
    if(room.status==="finished"){showFinal(room);return;}
    if(room.status==="playing"){
      if(room.phase==="results"){
        if(room.settings.showRoundLeaderboard){
          $("#roundLeaderboardTitle").textContent="ترتيب الجولة";
          renderLeaderboard($("#roundLeaderboard"),playerArray(room));
        }else{
          $("#roundLeaderboardTitle").textContent="بانتظار المضيف";
          $("#roundLeaderboard").innerHTML="";
        }
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
  const questionKey=`${idx}:${room.questionStartedAt||0}`;
  const isNewQuestion=questionKey!==renderedPlayerQuestionKey;
  if(isNewQuestion)renderedPlayerQuestionKey=questionKey;
  $("#playerScore").textContent=ar(me.score||0);
  $("#playerQuestionProgress").textContent=`${ar(idx+1)}/${ar(total)}`;
  $("#playerQuestionText").textContent=`${ar(q.a)} × ${ar(q.b)} = ؟`;
  const existing=room.answers?.[idx]?.[uid];
  answerLocked=Boolean(existing);
  $("#answerInput").disabled=answerLocked;
  $("#answerForm button").disabled=answerLocked;
  $("#answerFeedback").textContent=answerLocked?"تم تسجيل إجابتك ✓":"";
  if(isNewQuestion && !answerLocked){$("#answerInput").value="";setTimeout(()=>$("#answerInput").focus(),60);}
  if(isNewQuestion)runPlayerTimer(room);
}

function runPlayerTimer(room){
  if(timerRAF){cancelAnimationFrame(timerRAF);timerRAF=null;}
  const maxMs=room.settings.seconds*1000;
  const start=Number(room.questionStartedAt||Date.now());
  const tick=()=>{
    const elapsed=Date.now()-start;
    const remain=Math.max(0,maxMs-elapsed);
    $("#playerTimer").textContent=ar((remain/1000).toFixed(1));
    updateTimerBar($("#playerTimerBar"),remain,maxMs);
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
    if(!room || room.phase!=="question"){
      $("#answerFeedback").textContent="انتهى الوقت ⏰";
      return;
    }
    const idx=room.currentQuestionIndex;
    const start=Number(room.questionStartedAt||Date.now());
    const elapsedMs=Math.max(0,Date.now()-start);
    if(elapsedMs>room.settings.seconds*1000+800){
      $("#answerFeedback").textContent="انتهى الوقت ⏰";
      return;
    }
    const ansRef=ref(db,`rooms/${activeRoomPin}/answers/${idx}/${uid}`);
    const existing=await get(ansRef);
    if(existing.exists()){
      $("#answerFeedback").textContent="تم تسجيل إجابة سابقة.";
      return;
    }
    await set(ansRef,{
      value:Number(raw),
      elapsedMs,
      submittedAt:serverTimestamp()
    });
    $("#answerFeedback").textContent="تم تسجيل إجابتك ✓";
  }catch(err){
    console.error(err);
    answerLocked=false;
    $("#answerInput").disabled=false;
    $("#answerForm button").disabled=false;
    $("#answerFeedback").textContent=`تعذر إرسال الإجابة: ${err.code || err.message || "خطأ غير معروف"}`;
  }
});

$("#leaveRoomBtn").addEventListener("click",async()=>{
  if(activeRoomPin && uid && configured){
    try{
      await cancelPresence(activeRoomPin,"player");
      await remove(ref(db,`rooms/${activeRoomPin}/players/${uid}`));
    }catch(_){}
  }
  home();
});

// ── Final results and replay ─────────────────────────────────────────────────
function sortFinalPlayers(players){
  return sortPlayers(players);
}

function podiumCard(player, place, totalQuestions){
  const card=document.createElement("div");
  card.className=`podium-card place-${place}`;

  const medal=document.createElement("div");
  medal.className="podium-medal";
  medal.textContent=ar(place);

  const placeLabel=document.createElement("div");
  placeLabel.className="podium-place";
  placeLabel.textContent=place===1?"الأول":place===2?"الثاني":"الثالث";

  const avatar=renderAvatarBubble(player?.avatar, "podium-avatar");

  const name=document.createElement("div");
  name.className="podium-name";
  name.textContent=player?.name||"لاعب";

  const score=document.createElement("div");
  score.className="podium-score";
  score.textContent=`${ar(player?.score||0)} نقطة`;

  const correct=document.createElement("div");
  correct.className="podium-correct";
  correct.textContent=`${ar(player?.correct||0)} / ${ar(totalQuestions)} صحيحة`;

  card.append(medal,avatar,placeLabel,name,score,correct);
  return card;
}

function renderFinalRest(players,totalQuestions){
  const holder=$("#finalLeaderboard");
  holder.innerHTML="";
  players.forEach((p,i)=>{
    const row=document.createElement("div");
    row.className="rank-row final-rank-row";

    const rank=document.createElement("div");
    rank.className="rank-no";
    rank.textContent=ar(i+4);

    const info=document.createElement("div");
    info.className="rank-final-info";
    info.appendChild(renderAvatarBubble(p.avatar, "rank-avatar"));
    const nameWrap=document.createElement("div");
    nameWrap.className="rank-name-wrap";
    const name=document.createElement("div");
    name.className="rank-name";
    name.textContent=p.name||"لاعب";
    const correct=document.createElement("small");
    correct.className="rank-correct";
    correct.textContent=`${ar(p.correct||0)} / ${ar(totalQuestions)} صحيحة`;
    nameWrap.append(name,correct);
    info.appendChild(nameWrap);

    const score=document.createElement("div");
    score.className="rank-score";
    score.textContent=`${ar(p.score||0)} نقطة`;

    row.append(rank,info,score);
    holder.appendChild(row);
  });
}

function showFinal(room){
  if(timerRAF){cancelAnimationFrame(timerRAF);timerRAF=null;}
  const players=sortFinalPlayers(playerArray(room));
  const totalQuestions=Number(room?.settings?.questionCount||0);
  const podium=$("#finalPodium");
  podium.innerHTML="";

  // ترتيب المنصة بصريًا: الثاني — الأول — الثالث، مع رفع الأول للأعلى.
  const top3=players.slice(0,3);
  if(top3[1]) podium.appendChild(podiumCard(top3[1],2,totalQuestions));
  if(top3[0]) podium.appendChild(podiumCard(top3[0],1,totalQuestions));
  if(top3[2]) podium.appendChild(podiumCard(top3[2],3,totalQuestions));
  podium.classList.toggle("single-winner",top3.length===1);
  podium.classList.toggle("two-winners",top3.length===2);

  const rest=players.slice(3);
  $("#finalRestSection").classList.toggle("hidden",rest.length===0);
  renderFinalRest(rest,totalQuestions);

  if(players[0]){
    $("#winnerLine").textContent=`الفائز: ${players[0].name} — ${ar(players[0].score||0)} نقطة — ${ar(players[0].correct||0)}/${ar(totalQuestions)} صحيحة`;
  }else{
    $("#winnerLine").textContent="انتهت المسابقة";
  }
  $("#finalReplayBtn").disabled=false;
  $("#finalReplayBtn").textContent="العب مرة أخرى";
  showView("finalView");
}

async function replayGame(){
  if(!activeRoomPin || !currentRole){
    home();
    return;
  }

  if(currentRole==="player"){
    $("#playerLobbyName").textContent=localPlayerName||"لاعب";
    $("#playerLobbyPin").textContent=activeRoomPin;
    applyAvatarToElement($("#playerLobbyAvatar"),activeAvatarId,"player-waiting-avatar");
    showView("playerLobbyView");
    return;
  }

  const btn=$("#finalReplayBtn");
  btn.disabled=true;
  btn.textContent="جاري تجهيز الجولة…";
  try{
    const snap=await get(ref(db,`rooms/${activeRoomPin}`));
    const room=snap.val();
    if(!room || room.hostUid!==uid)throw new Error("تعذر العثور على الغرفة.");
    const updates={
      status:"lobby",
      phase:"lobby",
      currentQuestionIndex:-1,
      questions:null,
      questionPublic:null,
      questionStartedAt:null,
      answers:null,
      finishedAt:null
    };
    Object.keys(room.players||{}).forEach(pid=>{
      updates[`players/${pid}/score`]=0;
      updates[`players/${pid}/correct`]=0;
    });
    await update(ref(db,`rooms/${activeRoomPin}`),updates);
    subscribeHostLobby(activeRoomPin);
    showView("hostLobbyView");
  }catch(err){
    console.error(err);
    btn.disabled=false;
    btn.textContent="العب مرة أخرى";
    $("#winnerLine").textContent=err.message||"تعذر بدء جولة جديدة.";
  }
}

$("#finalReplayBtn").addEventListener("click",replayGame);

const urlPin=new URLSearchParams(location.search).get("pin");
if(urlPin && /^\d{6}$/.test(urlPin)){
  $("#joinPin").value=urlPin;
  showView("joinView");
}
