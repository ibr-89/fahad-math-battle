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

// Math Race v9.7 family-test logic patch.
// 1) Selected numbers are allowed on BOTH sides of the multiplication.
// 2) Reverse pairs (4×6 / 6×4) are one unique question.
// 3) The correct answer is revealed to everyone before the host advances.

const $ = (s) => document.querySelector(s);
const ar = (v) => String(v).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
const enDigits = (v) => String(v).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildUniqueQuestionPool(numbers) {
  const selected = [...new Set(numbers.map(Number).filter(n => n >= 1 && n <= 10))].sort((a,b) => a-b);
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

function selectedNumbersFromUi() {
  return [...document.querySelectorAll("#hostTables .table-chip.selected")]
    .map(el => Number(enDigits(el.textContent.trim())))
    .filter(Number.isFinite);
}

function availableUniqueCount(numbers) {
  const n = new Set(numbers).size;
  return n * (n + 1) / 2;
}

function enhanceSetupUi() {
  const hostTables = $("#hostTables");
  if (!hostTables) return;
  const section = hostTables.closest(".panel-section") || hostTables.parentElement;
  const label = section?.querySelector(".section-label");
  if (label) label.textContent = "الأرقام المستخدمة في المسابقة";

  if (!$("#numberSelectorHelper")) {
    const helper = document.createElement("p");
    helper.id = "numberSelectorHelper";
    helper.className = "helper number-selector-helper";
    helper.textContent = "الأرقام المختارة يمكن أن تظهر في طرفي المسألة.";
    hostTables.insertAdjacentElement("afterend", helper);
  }

  if (!$("#v97LogicStyles")) {
    const style = document.createElement("style");
    style.id = "v97LogicStyles";
    style.textContent = `
      .number-selector-helper{margin-top:10px;text-align:center;color:#c7d6ff}
      .round-answer-reveal{position:relative;margin:0 0 16px;padding:18px 16px;border:2px solid rgba(0,234,255,.45);border-radius:22px;text-align:center;background:linear-gradient(145deg,rgba(8,38,103,.92),rgba(37,16,104,.88));box-shadow:0 0 28px rgba(0,234,255,.16),inset 0 1px 0 rgba(255,255,255,.08);overflow:hidden}
      .round-answer-reveal::before{content:"";position:absolute;inset:-60px 20% auto;height:120px;border-radius:50%;background:rgba(0,234,255,.15);filter:blur(32px)}
      .round-answer-label{position:relative;display:block;color:#89f4ff;font-size:.9rem;font-weight:900}
      .round-answer-equation{position:relative;display:block;margin:8px 0 10px;color:#fff;font-size:clamp(2.4rem,11vw,4.6rem);font-weight:900;line-height:1.05;text-shadow:0 0 20px rgba(0,234,255,.34)}
      .round-own-answer{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:7px 13px;border-radius:999px;font-weight:900}
      .round-own-answer.correct{color:#8fffd1;background:rgba(25,209,136,.13);border:1px solid rgba(25,209,136,.35)}
      .round-own-answer.wrong{color:#ffd0d9;background:rgba(255,74,112,.13);border:1px solid rgba(255,74,112,.34)}
      .round-own-answer.timeout{color:#ffe5a4;background:rgba(255,190,55,.12);border:1px solid rgba(255,190,55,.3)}
      .host-question.answer-revealed{border-color:rgba(255,216,74,.52);box-shadow:0 0 34px rgba(255,216,74,.12),inset 0 1px 0 rgba(255,255,255,.08)}
      .host-question.answer-revealed .question-text{color:#fff6c7;text-shadow:0 0 24px rgba(255,216,74,.34)}
    `;
    document.head.appendChild(style);
  }
}

async function waitForFirebase(timeoutMs = 6000) {
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

function setupCreationValidation() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("#createRoomBtn");
    if (!button) return;

    const numbers = selectedNumbersFromUi();
    const requested = Number($("#hostQuestionCount")?.value || 0);
    const available = availableUniqueCount(numbers);
    if (requested > available) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const msg = $("#hostSetupMessage");
      if (msg) {
        msg.textContent = `عدد الأسئلة الفريدة المتاحة بهذه الأرقام هو ${ar(available)}. اختر أرقامًا إضافية أو قلل عدد الأسئلة.`;
      }
    }
  }, true);

  const refreshValidationMessage = () => {
    const msg = $("#hostSetupMessage");
    if (!msg) return;
    const numbers = selectedNumbersFromUi();
    const requested = Number($("#hostQuestionCount")?.value || 0);
    const available = availableUniqueCount(numbers);
    if (requested <= available && msg.textContent.includes("عدد الأسئلة الفريدة")) msg.textContent = "";
  };
  $("#hostTables")?.addEventListener("click", () => setTimeout(refreshValidationMessage, 0));
  $("#hostQuestionCount")?.addEventListener("change", refreshValidationMessage);
}

let startInProgress = false;
function setupStartOverride() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("#startLiveGameBtn");
    if (!button) return;

    // Stop the legacy start routine. We use the same Firebase room and the same
    // downstream game flow, but generate the question bank with the corrected logic.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (startInProgress) return;
    startInProgress = true;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "جاري تجهيز الأسئلة…";

    try {
      const { auth, db } = await waitForFirebase();
      const pin = String($("#hostPin")?.textContent || "").replace(/\D/g, "");
      if (!/^\d{6}$/.test(pin)) throw new Error("تعذر قراءة رقم الغرفة");

      const roomSnap = await get(ref(db, `rooms/${pin}`));
      const room = roomSnap.val();
      if (!room || room.hostUid !== auth.currentUser.uid) throw new Error("الغرفة غير متاحة للمضيف");

      const numbers = [...new Set((room.settings?.tables || []).map(Number))].sort((a,b) => a-b);
      const requested = Number(room.settings?.questionCount || 0);
      const pool = buildUniqueQuestionPool(numbers);
      if (requested > pool.length) {
        throw new Error(`عدد الأسئلة الفريدة المتاحة بهذه الأرقام هو ${ar(pool.length)}. اختر أرقامًا إضافية أو قلل عدد الأسئلة.`);
      }
      const questions = pool.slice(0, requested);
      if (!questions.length) throw new Error("اختر رقمًا واحدًا على الأقل.");

      const scoreReset = {};
      Object.keys(room.players || {}).forEach(pid => {
        scoreReset[`players/${pid}/score`] = 0;
        scoreReset[`players/${pid}/correct`] = 0;
      });

      await update(ref(db, `rooms/${pin}`), {
        ...scoreReset,
        answers: null,
        logicVersion: "9.7-family",
        status: "playing",
        phase: "question",
        questions,
        currentQuestionIndex: 0,
        questionPublic: { a: questions[0].a, b: questions[0].b },
        questionStartedAt: serverTimestamp()
      });

      // The existing v9.6 session recovery already knows how to restore the host
      // into an active game. Reloading lets us reuse that tested flow unchanged.
      location.reload();
    } catch (err) {
      console.error("v9.7 start override failed", err);
      button.disabled = false;
      button.textContent = originalText;
      const message = err?.message || "تعذر بدء المسابقة.";
      const empty = $("#emptyLobby");
      if (empty) {
        empty.classList.remove("hidden");
        empty.textContent = message;
      } else {
        alert(message);
      }
      startInProgress = false;
    }
  }, true);
}

function ensurePlayerRevealElement() {
  let reveal = $("#roundAnswerReveal");
  if (reveal) return reveal;
  const leaderboard = $("#roundLeaderboard");
  if (!leaderboard) return null;
  reveal = document.createElement("div");
  reveal.id = "roundAnswerReveal";
  reveal.className = "round-answer-reveal hidden";
  leaderboard.insertAdjacentElement("beforebegin", reveal);
  return reveal;
}

function renderResolvedRound(room, uid) {
  const idx = Number(room.currentQuestionIndex || 0);
  const q = room.questions?.[idx];
  if (!q) return;

  const equation = `${ar(q.a)} × ${ar(q.b)} = ${ar(q.answer)}`;
  const isHost = room.hostUid === uid;
  const isPlayer = Boolean(room.players?.[uid]);

  if (isHost) {
    const text = $("#hostQuestionText");
    if (text) text.textContent = equation;
    const card = document.querySelector(".host-question");
    card?.classList.add("answer-revealed");
    const kicker = card?.querySelector(".question-kicker");
    if (kicker) kicker.textContent = "الإجابة الصحيحة";
    const status = $("#hostRoundStatus");
    if (status) status.textContent = "ظهرت الإجابة الصحيحة للجميع — انتقل للسؤال التالي عندما تكونون جاهزين.";
  }

  if (isPlayer) {
    const reveal = ensurePlayerRevealElement();
    if (!reveal) return;
    const answer = room.answers?.[idx]?.[uid];
    let ownText = "لم تجب ⏰";
    let ownClass = "timeout";
    if (answer && Number.isFinite(Number(answer.value))) {
      const correct = Number(answer.value) === Number(q.answer);
      ownText = `إجابتك: ${ar(answer.value)} ${correct ? "✅" : "❌"}`;
      ownClass = correct ? "correct" : "wrong";
    }
    reveal.innerHTML = `
      <span class="round-answer-label">الإجابة الصحيحة</span>
      <strong class="round-answer-equation" dir="rtl">${equation}</strong>
      <span class="round-own-answer ${ownClass}">${ownText}</span>
    `;
    reveal.classList.remove("hidden");
    const title = $("#roundLeaderboardTitle");
    if (title) title.textContent = room.settings?.showRoundLeaderboard ? "الإجابة الصحيحة وترتيب الجولة" : "الإجابة الصحيحة";
  }
}

function clearResolvedRoundUi(room, uid) {
  const reveal = $("#roundAnswerReveal");
  reveal?.classList.add("hidden");
  if (room.hostUid === uid) {
    const card = document.querySelector(".host-question");
    card?.classList.remove("answer-revealed");
    const kicker = card?.querySelector(".question-kicker");
    if (kicker) kicker.textContent = "حلّ المسألة";
  }
}

let watchedPin = null;
let roomUnsubscribe = null;
async function watchRoundResults() {
  try {
    const { auth, db } = await waitForFirebase();
    setInterval(() => {
      const queryPin = new URLSearchParams(location.search).get("pin");
      const domPin = String($("#hostPin")?.textContent || $("#playerLobbyPin")?.textContent || "").replace(/\D/g, "");
      const pin = /^\d{6}$/.test(queryPin || "") ? queryPin : (/^\d{6}$/.test(domPin) ? domPin : null);
      if (!pin || pin === watchedPin || !auth.currentUser) return;

      if (roomUnsubscribe) roomUnsubscribe();
      watchedPin = pin;
      roomUnsubscribe = onValue(ref(db, `rooms/${pin}`), snap => {
        const room = snap.val();
        if (!room || !auth.currentUser) return;
        const uid = auth.currentUser.uid;
        // Run after the original v9.6 listeners finish rendering this snapshot.
        setTimeout(() => {
          if (room.status === "playing" && room.phase === "results") renderResolvedRound(room, uid);
          else if (room.status === "playing" && room.phase === "question") clearResolvedRoundUi(room, uid);
        }, 0);
      });
    }, 350);
  } catch (err) {
    console.warn("v9.7 result watcher could not start", err);
  }
}

function init() {
  enhanceSetupUi();
  setupCreationValidation();
  setupStartOverride();
  watchRoundResults();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
