import { getApps, getApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  update,
  onValue,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

// Math Race v9.8.2 hotfix
// 1) Start handshake: players do not receive question 1 until the host screen is ready.
// 2) Prevent the host from flashing through Join after pressing Start.
// 3) iPhone/iPad: use an in-game keypad instead of the native keyboard.

const $ = (s) => document.querySelector(s);
const ar = (v) => String(v).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
const enDigits = (v) => String(v).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const SESSION_KEY = "mathBattleV9Session";

let startBusy = false;
let preparingBusy = false;
let watchedPreparingPin = null;
let preparingUnsub = null;

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildUniqueQuestionPool(numbers) {
  const selected = [...new Set((numbers || []).map(Number).filter(n => n >= 1 && n <= 10))].sort((a,b) => a-b);
  const pool = [];
  for (let i = 0; i < selected.length; i++) {
    for (let j = i; j < selected.length; j++) {
      const a = selected[i];
      const b = selected[j];
      pool.push({ a, b, answer: a * b });
    }
  }
  return shuffle(pool);
}

async function waitForFirebase(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (getApps().length) {
      const app = getApp();
      const auth = getAuth(app);
      if (auth.currentUser) return { auth, db: getDatabase(app) };
    }
    await new Promise(r => setTimeout(r, 60));
  }
  throw new Error("Firebase is not ready");
}

function hostPinFromUi() {
  const raw = String($("#hostPin")?.textContent || "").replace(/\D/g, "");
  return /^\d{6}$/.test(raw) ? raw : null;
}

function savedHostPin() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (saved?.role === "host" && /^\d{6}$/.test(String(saved.pin || ""))) return String(saved.pin);
  } catch (_) {}
  return null;
}

function setLobbyMessage(text) {
  let hint = $("#v98MinPlayersHint");
  if (!hint) {
    const btn = $("#startLiveGameBtn");
    if (!btn) return;
    hint = document.createElement("p");
    hint.id = "v98MinPlayersHint";
    (btn.parentElement || document.body).insertBefore(hint, btn);
  }
  hint.className = "helper v98-min-players waiting";
  hint.textContent = text;
}

function setupFairStartOverride() {
  // Runs on window capture AFTER the v9.8 minimum-player guard and BEFORE v9.7's document handler.
  window.addEventListener("click", async (event) => {
    const button = event.target.closest?.("#startLiveGameBtn");
    if (!button || button.disabled || startBusy) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    startBusy = true;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "جاري تجهيز السباق…";

    try {
      const { auth, db } = await waitForFirebase();
      const pin = hostPinFromUi();
      if (!pin) throw new Error("تعذر قراءة رقم الغرفة.");

      const snap = await get(ref(db, `rooms/${pin}`));
      const room = snap.val();
      if (!room || room.hostUid !== auth.currentUser.uid || room.status !== "lobby") {
        throw new Error("الغرفة غير جاهزة لبدء المسابقة.");
      }

      const competitors = Object.values(room.players || {}).filter(p => p && p.connected !== false).length;
      if (competitors < 2) {
        throw new Error(room.settings?.hostParticipates
          ? "بانتظار متسابق واحد للعب مع المضيف 🎮"
          : "يحتاج السباق إلى متنافسين اثنين على الأقل.");
      }

      const requested = Number(room.settings?.questionCount || 0);
      const pool = buildUniqueQuestionPool(room.settings?.tables || []);
      if (!pool.length) throw new Error("اختر رقمًا واحدًا على الأقل.");
      if (requested > pool.length) {
        throw new Error(`عدد الأسئلة الفريدة المتاحة بهذه الأرقام هو ${ar(pool.length)}. اختر أرقامًا إضافية أو قلل عدد الأسئلة.`);
      }
      const questions = pool.slice(0, requested);

      const scoreReset = {};
      Object.keys(room.players || {}).forEach(pid => {
        scoreReset[`players/${pid}/score`] = 0;
        scoreReset[`players/${pid}/correct`] = 0;
      });

      // IMPORTANT: do not start the timer yet. Everyone stays in the lobby during PREPARING.
      await update(ref(db, `rooms/${pin}`), {
        ...scoreReset,
        answers: null,
        logicVersion: "9.8.2-fair-start",
        status: "playing",
        phase: "preparing",
        questions,
        currentQuestionIndex: 0,
        questionPublic: { a: questions[0].a, b: questions[0].b },
        questionStartedAt: null
      });

      // Remove ?pin= before reload so app.js does not briefly route the HOST to Join.
      history.replaceState(null, "", location.pathname);
      location.reload();
    } catch (err) {
      console.error("v9.8.2 fair start failed", err);
      setLobbyMessage(err?.message || "تعذر بدء المسابقة.");
      button.disabled = false;
      button.textContent = oldText;
      startBusy = false;
    }
  }, true);
}

async function beginPreparedRoundWhenHostReady(pin, room, auth, db) {
  if (preparingBusy) return;
  if (!room || room.status !== "playing" || room.phase !== "preparing") return;
  if (room.hostUid !== auth.currentUser.uid) return;
  if (document.body.dataset.view !== "hostGameView") return;

  preparingBusy = true;
  try {
    // Small paint delay: make sure the host can actually see the question before the clock starts.
    await new Promise(r => setTimeout(r, 180));
    const latestSnap = await get(ref(db, `rooms/${pin}`));
    const latest = latestSnap.val();
    if (!latest || latest.hostUid !== auth.currentUser.uid || latest.phase !== "preparing") return;

    await update(ref(db, `rooms/${pin}`), {
      phase: "question",
      questionStartedAt: serverTimestamp()
    });
  } finally {
    preparingBusy = false;
  }
}

async function watchPreparedStart() {
  try {
    const { auth, db } = await waitForFirebase();
    setInterval(() => {
      const pin = savedHostPin() || hostPinFromUi();
      if (!pin || pin === watchedPreparingPin || !auth.currentUser) return;
      if (preparingUnsub) preparingUnsub();
      watchedPreparingPin = pin;
      preparingUnsub = onValue(ref(db, `rooms/${pin}`), snap => {
        const room = snap.val();
        if (!room) return;
        setTimeout(() => beginPreparedRoundWhenHostReady(pin, room, auth, db).catch(console.error), 0);
      });
    }, 120);
  } catch (err) {
    console.warn("v9.8.2 preparing watcher could not start", err);
  }
}

function addInputEnhancements(form, input) {
  if (!form || !input || input.dataset.v982Enhanced) return;
  input.dataset.v982Enhanced = "1";
  input.setAttribute("enterkeyhint", "done");

  // Hardware / Android keyboards: Enter always submits.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  if (!isIOS()) return;

  document.body.classList.add("ios-race-keypad");
  input.readOnly = true;
  input.setAttribute("aria-readonly", "true");
  input.setAttribute("inputmode", "none");
  input.addEventListener("pointerdown", e => e.preventDefault());

  // app.js auto-focuses each new question. On iOS that caused the page jump.
  try { input.focus = () => {}; } catch (_) {}

  const oldSubmit = form.querySelector('button[type="submit"]');
  if (oldSubmit) oldSubmit.classList.add("ios-native-submit-hidden");

  const keypad = document.createElement("div");
  keypad.className = "race-ios-keypad";
  keypad.setAttribute("aria-label", "لوحة أرقام للإجابة");
  const keys = ["1","2","3","4","5","6","7","8","9","⌫","0","إجابة"];

  keys.forEach(key => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = key === "إجابة" ? "race-key race-key-submit" : (key === "⌫" ? "race-key race-key-back" : "race-key");
    btn.textContent = key === "إجابة" ? "إجابة ✓" : key;
    btn.addEventListener("click", () => {
      if (input.disabled) return;
      if (key === "إجابة") {
        form.requestSubmit();
      } else if (key === "⌫") {
        input.value = input.value.slice(0, -1);
      } else if (input.value.length < 3) {
        input.value += key;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    keypad.appendChild(btn);
  });

  form.insertAdjacentElement("afterend", keypad);
}

function installKeypads() {
  addInputEnhancements($("#answerForm"), $("#answerInput"));
  addInputEnhancements($("#hostPlayerAnswerForm"), $("#hostPlayerAnswerInput"));
}

function injectHotfixStyles() {
  if ($("#v982Styles")) return;
  const style = document.createElement("style");
  style.id = "v982Styles";
  style.textContent = `
    .race-ios-keypad{display:none}
    .ios-race-keypad .race-ios-keypad{
      display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;
      margin:12px auto 0;max-width:560px;direction:ltr
    }
    .ios-race-keypad .race-key{
      min-height:50px;border:1px solid rgba(89,198,255,.44);border-radius:15px;
      color:#fff;background:linear-gradient(155deg,rgba(10,35,105,.98),rgba(38,19,112,.98));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 6px 16px rgba(0,0,30,.22);
      font:inherit;font-size:1.18rem;font-weight:900;touch-action:manipulation
    }
    .ios-race-keypad .race-key:active{transform:scale(.96);filter:brightness(1.14)}
    .ios-race-keypad .race-key-submit{color:#07113f;background:linear-gradient(180deg,#6ff7ff,#17c9ef);border-color:#a8fbff;font-size:.9rem}
    .ios-race-keypad .race-key-back{color:#ffe4a1}
    .ios-race-keypad .ios-native-submit-hidden{display:none!important}
    .ios-race-keypad #answerInput,.ios-race-keypad #hostPlayerAnswerInput{
      user-select:none;caret-color:transparent
    }
    @media(max-width:600px){
      .ios-race-keypad .question-card{padding:18px 16px 22px}
      .ios-race-keypad .question-text{margin:12px 0;font-size:clamp(3.4rem,17vw,6.4rem)}
      .ios-race-keypad .score-strip{margin-bottom:8px;gap:7px}
      .ios-race-keypad .score-strip>div{min-height:62px}
      .ios-race-keypad .race-ios-keypad{gap:7px;margin-top:10px}
      .ios-race-keypad .race-key{min-height:47px}
    }
  `;
  document.head.appendChild(style);
}

function init() {
  injectHotfixStyles();
  setupFairStartOverride();
  watchPreparedStart();
  installKeypads();
  // v9.8 injects the host answer form at runtime; retry briefly in case it was not present yet.
  let attempts = 0;
  const timer = setInterval(() => {
    installKeypads();
    attempts += 1;
    if (attempts > 40 || ($("#answerInput")?.dataset.v982Enhanced && $("#hostPlayerAnswerInput")?.dataset.v982Enhanced)) clearInterval(timer);
  }, 100);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
