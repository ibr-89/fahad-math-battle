// Math Race v9.8.3 — Host resume guard
// Loaded synchronously in <head> to prevent the Home screen from flashing
// while a saved host session is being restored after the fair-start reload.
(() => {
  const SESSION_KEY = "mathBattleV9Session";
  let saved = null;

  try {
    saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch (_) {}

  const isSavedHost =
    saved?.role === "host" &&
    /^\d{6}$/.test(String(saved?.pin || ""));

  if (!isSavedHost) return;

  const root = document.documentElement;
  root.classList.add("host-resume-pending");

  const style = document.createElement("style");
  style.id = "hostResumeGuardStyles";
  style.textContent = `
    html.host-resume-pending body[data-view="homeView"] {
      overflow: hidden !important;
      background:
        radial-gradient(circle at 50% 28%, rgba(0,234,255,.14), transparent 34%),
        linear-gradient(180deg,#0a2f8e 0%,#10136f 52%,#25105f 100%) !important;
    }
    html.host-resume-pending body[data-view="homeView"] .ambient-symbols,
    html.host-resume-pending body[data-view="homeView"] .app-shell {
      opacity: 0 !important;
      visibility: hidden !important;
    }
    html.host-resume-pending body[data-view="homeView"]::before {
      content: "🏁  جاري تجهيز السباق…";
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: grid;
      place-items: center;
      padding: 24px;
      color: #dffcff;
      background:
        radial-gradient(circle at 50% 45%, rgba(0,234,255,.13), transparent 30%),
        linear-gradient(180deg,#0a2f8e 0%,#11136f 54%,#25105f 100%);
      font: 900 1.08rem/1.6 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;
      text-align: center;
      direction: rtl;
      letter-spacing: .01em;
    }
  `;
  document.head.appendChild(style);

  const clearGuard = () => {
    root.classList.remove("host-resume-pending");
  };

  document.addEventListener("DOMContentLoaded", () => {
    const body = document.body;
    if (!body) {
      clearGuard();
      return;
    }

    let observer = null;
    const check = () => {
      if (body.dataset.view && body.dataset.view !== "homeView") {
        clearGuard();
        observer?.disconnect();
      }
    };

    observer = new MutationObserver(check);
    observer.observe(body, { attributes: true, attributeFilter: ["data-view"] });
    check();

    // Safety fallback: never leave the user behind the loading guard forever.
    setTimeout(() => {
      clearGuard();
      observer?.disconnect();
    }, 6000);
  }, { once: true });
})();
