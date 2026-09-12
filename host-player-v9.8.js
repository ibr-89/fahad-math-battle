import { getApps, getApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

// Math Race v9.8 — Playing Host patch
// The host can optionally join the competition as a normal scored player while
// retaining host-only controls. Minimum competition size is two competitors.

const $ = (s) => document.querySelector(s);
const ar = (v) => String(v).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
const enDigits = (v) => String(v).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

const HOST_INTENT_KEY = "mathRaceV98HostIntent";
const HOST_NAME_KEY = "mathRaceV98HostName";

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

let watchedPin = null;
let roomUnsub = null;
let latestRoom = null;
let hostQuestionKey = null;
let applyingIntent = false;

function randomAvatarId() {
  return avatarCatalog[Math.floor(Math.random() * avatarCatalog.length)].id;
}

function saveHostIntent(intent) {
  try { localStorage.setItem(HOST_INTENT_KEY, JSON.stringify(intent)); } catch (_) {}
}
function readHostIntent() {
  try { return JSON.parse(localStorage.getItem(HOST_INTENT_KEY) || "null"); } catch (_) { return null; }
}
function clearHostIntent() {
  try { localStorage.removeItem(HOST_INTENT_KEY); } catch (_) {}
}

async function waitForFirebase(timeoutMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getApps().length) {
      const app = getApp();
      const auth = getAuth(app);
      if (auth.currentUser) return { app, auth, db: getDatabase(app) };
    }
    await new Promise(r => setTimeout(r, 60));
  }
  throw new Error("Firebase is not ready");
}

function injectStyles() {
  if ($("#v98HostPlayerStyles")) return;
  const style = document.createElement("style");
  style.id = "v98HostPlayerStyles";
  style.textContent = `
    .host-play-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}
    .host-play-copy strong{font-size:.98rem}
    .host-play-copy small{color:#9eb0dc;font-size:.76rem;font-weight:700;line-height:1.45}
    .host-player-setup{margin-top:-4px;padding:14px;border:1px solid rgba(0,234,255,.26);border-radius:18px;background:rgba(4,17,66,.46);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
    .host-player-setup.hidden{display:none!important}
    .host-player-name-field{display:grid;gap:7px}
    .host-player-name-field>span{color:#dbe5ff;font-size:.83rem;font-weight:900}
    .host-player-name-field input{width:100%;min-height:48px;padding:10px 13px;border:1px solid rgba(83,176,255,.38);border-radius:14px;outline:none;color:#fff;background:rgba(3,12,48,.82);font:inherit;font-weight:800}
    .host-player-name-field input:focus{border-color:#00eaff;box-shadow:0 0 0 3px rgba(0,234,255,.1),0 0 18px rgba(0,234,255,.13)}
    .host-player-setup .helper{margin:9px 0 0}
    .host-control-badge{display:inline-flex;flex:0 0 auto;align-items:center;gap:4px;margin-inline-start:7px;padding:3px 8px;border:1px solid rgba(95,117,255,.42);border-radius:999px;color:#aeeeff;background:linear-gradient(135deg,rgba(0,234,255,.11),rgba(124,60,255,.16));box-shadow:0 0 12px rgba(87,91,255,.12);font-size:.65rem;font-weight:900;line-height:1.2;vertical-align:middle;white-space:nowrap}
    .rank-name:has(.host-control-badge),.podium-name:has(.host-control-badge),.player-name-only:has(.host-control-badge){display:flex;align-items:center;flex-wrap:wrap;gap:3px}
    .host-card-v98 .player-avatar-mini{cursor:pointer;transition:transform .18s,box-shadow .18s}
    .host-card-v98 .player-avatar-mini:hover{transform:scale(1.06);box-shadow:0 0 24px rgba(0,234,255,.4)}
    .host-card-v98 .player-avatar-mini::after{content:"✎";position:absolute;inset:auto 0 0 auto;display:grid;width:18px;height:18px;place-items:center;border-radius:50%;color:#07113f;background:#8ef5ff;font-size:.65rem;font-weight:900;box-shadow:0 0 10px rgba(0,234,255,.5)}
    .v98-min-players{margin:10px 0 0;text-align:center}
    .v98-min-players.ready{color:#8fffd1}
    .v98-min-players.waiting{color:#ffe5a4}
    .host-player-answer-area{position:relative;margin-top:16px}
    .host-player-answer-area.hidden{display:none!important}
    .host-answer-form{max-width:520px;margin-inline:auto}
    .host-answer-result{display:inline-flex;min-height:40px;align-items:center;justify-content:center;margin-top:12px;padding:8px 14px;border-radius:999px;font-weight:900}
    .host-answer-result.correct{color:#8fffd1;border:1px solid rgba(25,209,136,.35);background:rgba(25,209,136,.13)}
    .host-answer-result.wrong{color:#ffd0d9;border:1px solid rgba(255,74,112,.34);background:rgba(255,74,112,.13)}
    .host-answer-result.timeout{color:#ffe5a4;border:1px solid rgba(255,190,55,.3);background:rgba(255,190,55,.12)}
    .v98-avatar-overlay{position:fixed;z-index:9999;inset:0;display:grid;place-items:center;padding:18px;background:rgba(1,5,28,.78);backdrop-filter:blur(10px)}
    .v98-avatar-overlay.hidden{display:none!important}
    .v98-avatar-modal{width:min(100%,620px);max-height:min(90vh,720px);overflow:auto;padding:18px;border:1px solid rgba(0,234,255,.34);border-radius:26px;background:linear-gradient(155deg,rgba(7,24,83,.98),rgba(35,13,90,.98));box-shadow:0 24px 80px rgba(0,0,30,.55),0 0 34px rgba(0,234,255,.13)}
    .v98-avatar-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
    .v98-avatar-head h3{margin:0;font-size:1.25rem}
    .v98-avatar-close{display:grid;width:40px;height:40px;place-items:center;border:1px solid rgba(255,255,255,.13);border-radius:13px;color:#fff;background:rgba(255,255,255,.06);font-size:1.3rem}
    .v98-avatar-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .v98-avatar-option{aspect-ratio:1;overflow:hidden;padding:4px;border:2px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(5,15,60,.7)}
    .v98-avatar-option.current{border-color:#00eaff;box-shadow:0 0 20px rgba(0,234,255,.35)}
    .v98-avatar-option img{width:100%;height:100%;object-fit:contain;object-position:center bottom}
    @media(max-width:560px){.v98-avatar-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.host-play-copy small{font-size:.72rem}}
  `;
  document.head.appendChild(style);
}

function injectSetupUi() {
  if ($("#hostParticipates")) return;
  const roundToggle = $("#showRoundLeaderboard")?.closest(".switch-row");
  if (!roundToggle) return;

  const toggle = document.createElement("label");
  toggle.className = "switch-row host-play-switch";
  toggle.innerHTML = `
    <input id="hostParticipates" type="checkbox" />
    <span class="switch-ui" aria-hidden="true"></span>
    <span class="host-play-copy">
      <strong>🎮 المضيف يشارك في المسابقة</strong>
      <small>يلعب ويُحسب في النقاط والترتيب مع بقاء التحكم بالسؤال التالي لديه.</small>
    </span>
  `;

  const setup = document.createElement("div");
  setup.id = "hostPlayerSetup";
  setup.className = "host-player-setup hidden";
  const rememberedName = (() => { try { return localStorage.getItem(HOST_NAME_KEY) || ""; } catch (_) { return ""; } })();
  setup.innerHTML = `
    <label class="host-player-name-field">
      <span>اسمك في المسابقة</span>
      <input id="hostPlayerName" maxlength="20" autocomplete="nickname" placeholder="اكتب اسم المضيف" value="${rememberedName.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\"/g,"&quot;")}" />
    </label>
    <p class="helper">سيتم اختيار شخصية عشوائية، ويمكنك تغييرها بالضغط عليها داخل غرفة الانتظار.</p>
  `;

  roundToggle.insertAdjacentElement("afterend", toggle);
  toggle.insertAdjacentElement("afterend", setup);

  const checkbox = $("#hostParticipates");
  checkbox.addEventListener("change", () => {
    setup.classList.toggle("hidden", !checkbox.checked);
    if (checkbox.checked) setTimeout(() => $("#hostPlayerName")?.focus(), 50);
  });
}

function injectHostAnswerUi() {
  if ($("#hostPlayerAnswerArea")) return;
  const card = document.querySelector(".host-question");
  if (!card) return;
  const status = $("#hostRoundStatus");
  const area = document.createElement("div");
  area.id = "hostPlayerAnswerArea";
  area.className = "host-player-answer-area hidden";
  area.innerHTML = `
    <form id="hostPlayerAnswerForm" class="answer-form host-answer-form">
      <input id="hostPlayerAnswerInput" inputmode="numeric" pattern="[0-9٠-٩]*" autocomplete="off" aria-label="اكتب إجابتك كمضيف مشارك" placeholder="؟" />
      <button class="primary" type="submit">إجابة</button>
    </form>
    <p id="hostPlayerAnswerFeedback" class="message center" aria-live="polite"></p>
    <div id="hostPlayerAnswerResult" class="host-answer-result hidden"></div>
  `;
  if (status) status.insertAdjacentElement("beforebegin", area);
  else card.appendChild(area);

  $("#hostPlayerAnswerForm").addEventListener("submit", submitHostAnswer);
}

function injectAvatarModal() {
  if ($("#v98AvatarOverlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "v98AvatarOverlay";
  overlay.className = "v98-avatar-overlay hidden";
  overlay.innerHTML = `
    <div class="v98-avatar-modal" role="dialog" aria-modal="true" aria-labelledby="v98AvatarTitle">
      <div class="v98-avatar-head">
        <h3 id="v98AvatarTitle">اختر شخصية المضيف</h3>
        <button id="v98AvatarClose" class="v98-avatar-close" type="button" aria-label="إغلاق">×</button>
      </div>
      <div id="v98AvatarGrid" class="v98-avatar-grid"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  $("#v98AvatarClose").addEventListener("click", closeAvatarPicker);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeAvatarPicker(); });
}

function openAvatarPicker() {
  if (!latestRoom) return;
  const overlay = $("#v98AvatarOverlay");
  const grid = $("#v98AvatarGrid");
  if (!overlay || !grid) return;
  const current = latestRoom.players?.[latestRoom.hostUid]?.avatar;
  grid.innerHTML = "";
  avatarCatalog.forEach(avatar => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `v98-avatar-option${avatar.id === current ? " current" : ""}`;
    btn.setAttribute("aria-label", `اختيار ${avatar.label}`);
    btn.innerHTML = `<img src="${avatar.src}" alt="" decoding="async" />`;
    btn.addEventListener("click", () => changeHostAvatar(avatar.id));
    grid.appendChild(btn);
  });
  overlay.classList.remove("hidden");
}
function closeAvatarPicker() {
  $("#v98AvatarOverlay")?.classList.add("hidden");
}

async function changeHostAvatar(avatarId) {
  try {
    const { auth, db } = await waitForFirebase();
    if (!watchedPin || !latestRoom || latestRoom.hostUid !== auth.currentUser.uid) return;
    if (!latestRoom.settings?.hostParticipates || !latestRoom.players?.[auth.currentUser.uid]) return;
    await update(ref(db, `rooms/${watchedPin}/players/${auth.currentUser.uid}`), { avatar: avatarId, lastSeen: serverTimestamp() });
    closeAvatarPicker();
  } catch (err) {
    console.error("تعذر تغيير شخصية المضيف", err);
  }
}

function setupCreateIntentCapture() {
  // Window capture runs before document listeners from v9.6/v9.7.
  window.addEventListener("click", event => {
    const button = event.target.closest?.("#createRoomBtn");
    if (!button) return;

    const participates = Boolean($("#hostParticipates")?.checked);
    const name = String($("#hostPlayerName")?.value || "").trim().slice(0, 20);
    if (participates && !name) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const msg = $("#hostSetupMessage");
      if (msg) msg.textContent = "اكتب اسم المضيف المشارك قبل إنشاء الغرفة.";
      $("#hostPlayerName")?.focus();
      return;
    }

    if (participates) {
      try { localStorage.setItem(HOST_NAME_KEY, name); } catch (_) {}
      saveHostIntent({ participates: true, name, avatar: randomAvatarId(), createdAt: Date.now() });
    } else {
      saveHostIntent({ participates: false, createdAt: Date.now() });
    }
  }, true);
}

async function applyPendingHostIntent(pin) {
  if (applyingIntent) return;
  const intent = readHostIntent();
  if (!intent || Date.now() - Number(intent.createdAt || 0) > 120000) return;
  applyingIntent = true;
  try {
    const { auth, db } = await waitForFirebase();
    const roomSnap = await get(ref(db, `rooms/${pin}`));
    const room = roomSnap.val();
    if (!room || room.hostUid !== auth.currentUser.uid || room.status !== "lobby") return;

    if (!intent.participates) {
      await update(ref(db, `rooms/${pin}`), { "settings/hostParticipates": false });
      clearHostIntent();
      return;
    }

    const hostUid = auth.currentUser.uid;
    if (room.players?.[hostUid]?.isHost && room.settings?.hostParticipates) {
      clearHostIntent();
      return;
    }

    await update(ref(db, `rooms/${pin}`), {
      "settings/hostParticipates": true,
      "settings/minCompetitors": 2,
      [`players/${hostUid}`]: {
        name: intent.name,
        avatar: intent.avatar || randomAvatarId(),
        score: 0,
        correct: 0,
        isHost: true,
        connected: true,
        joinedAt: serverTimestamp(),
        lastSeen: serverTimestamp()
      }
    });
    clearHostIntent();
  } catch (err) {
    console.error("v9.8 host participation setup failed", err);
  } finally {
    applyingIntent = false;
  }
}

function connectedCompetitors(room) {
  return Object.values(room?.players || {}).filter(p => p && p.connected !== false).length;
}

function syncMinimumPlayers(room, authUid) {
  const button = $("#startLiveGameBtn");
  if (!button || room.hostUid !== authUid || room.status !== "lobby") return;
  const count = connectedCompetitors(room);
  const ready = count >= 2;
  button.disabled = !ready;

  let hint = $("#v98MinPlayersHint");
  if (!hint) {
    hint = document.createElement("p");
    hint.id = "v98MinPlayersHint";
    const panel = button.closest(".lobby-players-panel") || button.parentElement;
    panel?.insertBefore(hint, button);
  }
  if (hint) {
    hint.className = `helper v98-min-players ${ready ? "ready" : "waiting"}`;
    if (ready) {
      hint.textContent = `جاهزون للسباق — ${ar(count)} متنافسين ✓`;
    } else if (room.settings?.hostParticipates) {
      hint.textContent = "بانتظار متسابق واحد للعب مع المضيف 🎮";
    } else {
      hint.textContent = "يحتاج السباق إلى متنافسين اثنين على الأقل.";
    }
  }
}

function setupMinimumPlayersGuard() {
  // This must run on window because v9.7 consumes the start click on document.
  window.addEventListener("click", event => {
    const button = event.target.closest?.("#startLiveGameBtn");
    if (!button || !latestRoom) return;
    const count = connectedCompetitors(latestRoom);
    if (count >= 2) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const hint = $("#v98MinPlayersHint");
    if (hint) {
      hint.className = "helper v98-min-players waiting";
      hint.textContent = latestRoom.settings?.hostParticipates
        ? "بانتظار متسابق واحد للعب مع المضيف 🎮"
        : "يحتاج السباق إلى متنافسين اثنين على الأقل.";
    }
  }, true);
}

function hostName(room) {
  const p = room?.players?.[room?.hostUid];
  return p?.isHost ? String(p.name || "") : "";
}

function makeHostBadge() {
  const badge = document.createElement("span");
  badge.className = "host-control-badge";
  badge.textContent = "🎮 المضيف";
  return badge;
}

function decorateHostBadges(room, authUid) {
  if (!room?.settings?.hostParticipates) return;
  const name = hostName(room);
  if (!name) return;

  document.querySelectorAll(".rank-name, .podium-name, .player-name-only").forEach(el => {
    if (el.querySelector(".host-control-badge")) return;
    const raw = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join("").trim() || el.textContent.trim();
    if (raw !== name) return;
    el.appendChild(makeHostBadge());
  });

  if (room.hostUid !== authUid || room.status !== "lobby") return;
  document.querySelectorAll("#hostPlayers .player-card").forEach(card => {
    const label = card.querySelector(".player-name-only");
    if (!label) return;
    const text = [...label.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join("").trim();
    if (text !== name) return;
    card.classList.add("host-card-v98");
    const avatar = card.querySelector(".player-avatar-mini");
    if (avatar && !avatar.dataset.v98Bound) {
      avatar.dataset.v98Bound = "1";
      avatar.title = "اضغط لتغيير شخصية المضيف";
      avatar.setAttribute("role", "button");
      avatar.setAttribute("tabindex", "0");
      avatar.addEventListener("click", openAvatarPicker);
      avatar.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAvatarPicker(); }
      });
    }
  });
}

function hostParticipates(room, authUid) {
  return Boolean(room?.settings?.hostParticipates && room?.hostUid === authUid && room?.players?.[authUid]?.isHost);
}

function syncHostAnswerUi(room, authUid) {
  const area = $("#hostPlayerAnswerArea");
  if (!area) return;
  if (!hostParticipates(room, authUid) || room.status !== "playing") {
    area.classList.add("hidden");
    return;
  }
  area.classList.remove("hidden");

  const form = $("#hostPlayerAnswerForm");
  const input = $("#hostPlayerAnswerInput");
  const button = form?.querySelector("button[type=submit]");
  const feedback = $("#hostPlayerAnswerFeedback");
  const result = $("#hostPlayerAnswerResult");
  const idx = Number(room.currentQuestionIndex || 0);
  const qKey = `${idx}:${room.questionStartedAt || 0}`;
  const existing = room.answers?.[idx]?.[authUid];

  if (room.phase === "question") {
    result?.classList.add("hidden");
    if (form) form.classList.remove("hidden");
    if (qKey !== hostQuestionKey) {
      hostQuestionKey = qKey;
      if (input) input.value = "";
      if (feedback) feedback.textContent = "";
      if (!existing) setTimeout(() => input?.focus(), 70);
    }
    const locked = Boolean(existing);
    if (input) input.disabled = locked;
    if (button) button.disabled = locked;
    if (feedback) feedback.textContent = locked ? "تم تسجيل إجابتك ✓" : "";
    return;
  }

  if (room.phase === "results") {
    if (form) form.classList.add("hidden");
    if (input) input.disabled = true;
    if (button) button.disabled = true;
    if (feedback) feedback.textContent = "";
    const q = room.questions?.[idx];
    if (!result || !q) return;
    let text = "لم تجب ⏰";
    let klass = "timeout";
    if (existing && Number.isFinite(Number(existing.value))) {
      const correct = Number(existing.value) === Number(q.answer);
      text = `إجابتك: ${ar(existing.value)} ${correct ? "✅" : "❌"}`;
      klass = correct ? "correct" : "wrong";
    }
    result.className = `host-answer-result ${klass}`;
    result.textContent = text;
  }
}

async function submitHostAnswer(event) {
  event.preventDefault();
  const input = $("#hostPlayerAnswerInput");
  const feedback = $("#hostPlayerAnswerFeedback");
  const raw = enDigits(String(input?.value || "")).trim();
  if (!/^\d+$/.test(raw)) return;

  try {
    const { auth, db } = await waitForFirebase();
    if (!watchedPin) return;
    const roomSnap = await get(ref(db, `rooms/${watchedPin}`));
    const room = roomSnap.val();
    const hostUid = auth.currentUser.uid;
    if (!hostParticipates(room, hostUid) || room.phase !== "question") {
      if (feedback) feedback.textContent = "انتهى الوقت ⏰";
      return;
    }

    const idx = Number(room.currentQuestionIndex || 0);
    const maxMs = Number(room.settings?.seconds || 0) * 1000;
    const start = Number(room.questionStartedAt || Date.now());
    const elapsedMs = Math.max(0, Date.now() - start);
    if (elapsedMs > maxMs + 800) {
      if (input) input.disabled = true;
      if (feedback) feedback.textContent = "انتهى الوقت ⏰";
      return;
    }

    const ansRef = ref(db, `rooms/${watchedPin}/answers/${idx}/${hostUid}`);
    const existing = await get(ansRef);
    if (existing.exists()) {
      if (input) input.disabled = true;
      if (feedback) feedback.textContent = "تم تسجيل إجابة سابقة.";
      return;
    }

    if (input) input.disabled = true;
    const button = $("#hostPlayerAnswerForm")?.querySelector("button[type=submit]");
    if (button) button.disabled = true;
    await set(ansRef, {
      value: Number(raw),
      elapsedMs,
      submittedAt: serverTimestamp()
    });
    if (feedback) feedback.textContent = "تم تسجيل إجابتك ✓";
  } catch (err) {
    console.error("تعذر إرسال إجابة المضيف", err);
    if (input) input.disabled = false;
    const button = $("#hostPlayerAnswerForm")?.querySelector("button[type=submit]");
    if (button) button.disabled = false;
    if (feedback) feedback.textContent = `تعذر إرسال الإجابة: ${err.code || err.message || "خطأ غير معروف"}`;
  }
}

function currentPinFromUi() {
  const queryPin = new URLSearchParams(location.search).get("pin");
  if (/^\d{6}$/.test(queryPin || "")) return queryPin;
  const domPin = String($("#hostPin")?.textContent || $("#playerLobbyPin")?.textContent || "").replace(/\D/g, "");
  return /^\d{6}$/.test(domPin) ? domPin : null;
}

async function watchRoom() {
  try {
    const { auth, db } = await waitForFirebase();
    setInterval(async () => {
      const pin = currentPinFromUi();
      if (!pin || !auth.currentUser) return;

      if (pin !== watchedPin) {
        if (roomUnsub) roomUnsub();
        watchedPin = pin;
        latestRoom = null;
        await applyPendingHostIntent(pin);
        roomUnsub = onValue(ref(db, `rooms/${pin}`), snap => {
          const room = snap.val();
          if (!room) return;
          latestRoom = room;
          setTimeout(() => {
            syncMinimumPlayers(room, auth.currentUser.uid);
            decorateHostBadges(room, auth.currentUser.uid);
            syncHostAnswerUi(room, auth.currentUser.uid);
          }, 0);
        });
      } else {
        // Covers the short gap after legacy createRoom changes the URL but before
        // its Firebase write is visible to this patch.
        await applyPendingHostIntent(pin);
        if (latestRoom) {
          syncMinimumPlayers(latestRoom, auth.currentUser.uid);
          decorateHostBadges(latestRoom, auth.currentUser.uid);
          syncHostAnswerUi(latestRoom, auth.currentUser.uid);
        }
      }
    }, 300);
  } catch (err) {
    console.warn("v9.8 room watcher could not start", err);
  }
}

function init() {
  injectStyles();
  injectSetupUi();
  injectHostAnswerUi();
  injectAvatarModal();
  setupCreateIntentCapture();
  setupMinimumPlayersGuard();
  watchRoom();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
