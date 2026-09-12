// Math Race v9.8.3 — Fair unified game keypad
// Same answer keypad on iPhone, Android and desktop.
// Desktop physical number keys + Enter/Backspace remain supported.

const $ = (s) => document.querySelector(s);

function emitInput(input) {
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function getActiveAnswerTarget() {
  const view = document.body?.dataset?.view;

  if (view === "playerGameView") {
    const form = $("#answerForm");
    const input = $("#answerInput");
    if (form && input && !input.disabled) return { form, input };
  }

  if (view === "hostGameView") {
    const area = $("#hostPlayerAnswerArea");
    const form = $("#hostPlayerAnswerForm");
    const input = $("#hostPlayerAnswerInput");
    if (area && !area.classList.contains("hidden") && form && input && !input.disabled) {
      return { form, input };
    }
  }

  return null;
}

function applyKey(form, input, key) {
  if (!form || !input || input.disabled) return;

  if (key === "submit") {
    if (String(input.value || "").length) form.requestSubmit();
    return;
  }

  if (key === "back") {
    input.value = String(input.value || "").slice(0, -1);
    emitInput(input);
    return;
  }

  if (/^\d$/.test(key) && String(input.value || "").length < 3) {
    input.value = String(input.value || "") + key;
    emitInput(input);
  }
}

function removeLegacyIOSKeypad(form) {
  if (!form) return;
  let next = form.nextElementSibling;
  while (next && next.classList?.contains("race-ios-keypad")) {
    const doomed = next;
    next = next.nextElementSibling;
    doomed.remove();
  }
}

function buildUnifiedKeypad(form, input) {
  if (!form || !input || input.dataset.v983Enhanced === "1") return;
  input.dataset.v983Enhanced = "1";

  document.body.classList.remove("ios-race-keypad");
  document.body.classList.add("race-unified-keypad");
  removeLegacyIOSKeypad(form);

  // Keep the answer display, but never open a device-specific software keyboard.
  input.readOnly = true;
  input.setAttribute("readonly", "");
  input.setAttribute("aria-readonly", "true");
  input.setAttribute("inputmode", "none");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("enterkeyhint", "done");
  input.addEventListener("pointerdown", (e) => e.preventDefault());
  input.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  try { input.blur(); } catch (_) {}
  // app.js focuses the field on every question; prevent focus-induced mobile scrolling.
  try { input.focus = () => {}; } catch (_) {}

  const oldSubmit = form.querySelector('button[type="submit"]');
  if (oldSubmit) oldSubmit.classList.add("race-native-submit-hidden");

  const keypad = document.createElement("div");
  keypad.className = "race-game-keypad";
  keypad.setAttribute("role", "group");
  keypad.setAttribute("aria-label", "لوحة أرقام موحدة للإجابة");

  const keys = [
    { value: "1", label: "1" },
    { value: "2", label: "2" },
    { value: "3", label: "3" },
    { value: "4", label: "4" },
    { value: "5", label: "5" },
    { value: "6", label: "6" },
    { value: "7", label: "7" },
    { value: "8", label: "8" },
    { value: "9", label: "9" },
    { value: "back", label: "⌫", klass: "race-key-back", aria: "حذف الرقم الأخير" },
    { value: "0", label: "0" },
    { value: "submit", label: "إجابة ✓", klass: "race-key-submit", aria: "إرسال الإجابة" }
  ];

  keys.forEach(({ value, label, klass = "", aria }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `race-game-key ${klass}`.trim();
    btn.textContent = label;
    btn.dataset.key = value;
    if (aria) btn.setAttribute("aria-label", aria);
    btn.addEventListener("click", () => applyKey(form, input, value));
    keypad.appendChild(btn);
  });

  form.insertAdjacentElement("afterend", keypad);

  const syncDisabled = () => {
    keypad.querySelectorAll("button").forEach(btn => {
      btn.disabled = Boolean(input.disabled);
    });
  };
  syncDisabled();
  new MutationObserver(syncDisabled).observe(input, { attributes: true, attributeFilter: ["disabled"] });
}

function installUnifiedKeypads() {
  buildUnifiedKeypad($("#answerForm"), $("#answerInput"));
  buildUnifiedKeypad($("#hostPlayerAnswerForm"), $("#hostPlayerAnswerInput"));
}

function installHardwareKeyboardSupport() {
  if (document.documentElement.dataset.v983HardwareKeys === "1") return;
  document.documentElement.dataset.v983HardwareKeys = "1";

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = getActiveAnswerTarget();
    if (!target) return;

    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      applyKey(target.form, target.input, e.key);
      return;
    }

    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      applyKey(target.form, target.input, "back");
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      applyKey(target.form, target.input, "submit");
    }
  }, true);
}

function injectStyles() {
  if ($("#v983FairKeypadStyles")) return;
  const style = document.createElement("style");
  style.id = "v983FairKeypadStyles";
  style.textContent = `
    .race-unified-keypad .race-ios-keypad{display:none!important}
    .race-unified-keypad .race-native-submit-hidden,
    .race-unified-keypad .ios-native-submit-hidden{display:none!important}

    .race-game-keypad{
      display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:9px;
      width:min(100%,460px);
      margin:12px auto 0;
      direction:ltr;
    }
    .race-game-key{
      min-height:56px;
      border:1px solid rgba(89,198,255,.44);
      border-radius:16px;
      color:#fff;
      background:linear-gradient(155deg,rgba(10,35,105,.98),rgba(38,19,112,.98));
      box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 6px 16px rgba(0,0,30,.22);
      font:inherit;
      font-size:1.35rem;
      font-weight:900;
      touch-action:manipulation;
      -webkit-tap-highlight-color:transparent;
      user-select:none;
    }
    .race-game-key:active:not(:disabled){transform:scale(.96);filter:brightness(1.14)}
    .race-game-key:disabled{opacity:.45;filter:saturate(.55);cursor:not-allowed}
    .race-game-key.race-key-back{color:#ffe4a1;font-size:1.25rem}
    .race-game-key.race-key-submit{
      color:#07113f;
      background:linear-gradient(180deg,#6ff7ff,#17c9ef);
      border-color:#a8fbff;
      font-size:.95rem;
    }
    .race-unified-keypad #answerInput,
    .race-unified-keypad #hostPlayerAnswerInput{
      user-select:none;
      caret-color:transparent;
      cursor:default;
    }

    @media(max-width:600px){
      .race-unified-keypad .question-card{padding:16px 14px 18px}
      .race-unified-keypad .question-text{margin:8px 0;font-size:clamp(3.1rem,15vw,5.8rem)}
      .race-unified-keypad .score-strip{margin-bottom:7px;gap:6px}
      .race-unified-keypad .score-strip>div{min-height:58px}
      .race-game-keypad{gap:7px;margin-top:9px;width:min(100%,420px)}
      .race-game-key{min-height:50px;border-radius:14px;font-size:1.22rem}
      .race-game-key.race-key-submit{font-size:.9rem}
    }

    @media(max-height:720px) and (max-width:600px){
      .race-unified-keypad .question-card{padding-top:12px;padding-bottom:14px}
      .race-unified-keypad .question-text{font-size:clamp(2.8rem,13vw,4.8rem);margin:5px 0}
      .race-game-keypad{gap:6px;margin-top:7px}
      .race-game-key{min-height:44px}
    }
  `;
  document.head.appendChild(style);
}

function init() {
  injectStyles();
  installHardwareKeyboardSupport();
  installUnifiedKeypads();

  // Host answer UI is injected by v9.8 after page load; retry until both keypads exist.
  let attempts = 0;
  const timer = setInterval(() => {
    installUnifiedKeypads();
    document.body.classList.remove("ios-race-keypad");
    document.body.classList.add("race-unified-keypad");
    attempts += 1;
    const playerReady = $("#answerInput")?.dataset.v983Enhanced === "1";
    const hostExists = Boolean($("#hostPlayerAnswerInput"));
    const hostReady = !hostExists || $("#hostPlayerAnswerInput")?.dataset.v983Enhanced === "1";
    if (attempts > 60 || (playerReady && hostReady)) clearInterval(timer);
  }, 100);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
