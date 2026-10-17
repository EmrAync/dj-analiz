/* DJ Doktor eklentisi: masaüstü uygulaması (djdoktor/desktop.py, /api/app/...).
 * - Kalp atışı (5 sn) ve sayfa kapanırken "bye": uygulama penceresi kapanınca program da kapanır.
 * - Sunucu kapandıysa hata bildirimleri yerine sakin bir "DJ Doktor kapandı" ekranı.
 * - Ayarlar > Uygulama: "Ayrı pencerede aç", "Masaüstüne kısayol oluştur", "Programı kapat".
 * - İlk uygulama açılışında bir kez kısayol önerisi; uygulama simgesi ve manifest sayfaya eklenir.
 * app.js yardımcıları: api, toast, esc, $, S. */
"use strict";
(function () {
  const CID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const D = { info: null, fails: 0, gone: false, quitting: false, timer: null, checking: false };
  const HB_MS = 5000;

  // --- simge ve manifest (pencere / görev çubuğu / Dock simgesi) ---------------------------------------------
  function headLinks() {
    const add = (attrs) => {
      const l = document.createElement("link");
      Object.keys(attrs).forEach((k) => l.setAttribute(k, attrs[k]));
      document.head.appendChild(l);
    };
    if (!document.querySelector('link[rel="manifest"]')) add({ rel: "manifest", href: "/manifest.webmanifest" });
    add({ rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" });
    add({ rel: "icon", type: "image/png", sizes: "32x32", href: "/icon-32.png" });
    add({ rel: "apple-touch-icon", href: "/icon-180.png" });
    if (!document.querySelector('meta[name="theme-color"]')) {
      const m = document.createElement("meta");
      m.name = "theme-color"; m.content = "#2f6fed";
      document.head.appendChild(m);
    }
  }

  // --- kalp atışı ---------------------------------------------------------------------------------------------
  const rawFetch = window.fetch.bind(window);
  async function beat() {
    if (D.gone || D.quitting) return;
    try {
      const r = await rawFetch("/api/app/hb", { method: "POST", headers: { "X-DJD-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ cid: CID }), keepalive: true });
      if (r.status === 401) { gone("restart"); return; }      // program yeniden açıldı (yeni jeton)
      D.fails = 0;
    } catch (e) {
      D.fails += 1;
      if (D.fails >= 2) gone(); else setTimeout(beat, 1200);
    }
  }
  function bye() {
    if (D.gone) return;
    const u = "/api/app/bye?t=" + encodeURIComponent(TOKEN) + "&c=" + encodeURIComponent(CID);
    try { if (navigator.sendBeacon && navigator.sendBeacon(u, "")) return; } catch (e) { /* */ }
    try { rawFetch(u, { method: "POST", keepalive: true }); } catch (e) { /* */ }
  }
  function start() {
    if (D.timer) clearInterval(D.timer);
    D.timer = setInterval(beat, HB_MS);
    beat();
  }
  window.addEventListener("pagehide", bye);
  window.addEventListener("pageshow", (e) => { if (e.persisted) { D.gone = false; start(); } });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") beat(); });

  // Başka bir istek ağ hatası verdiyse sunucuya hemen bak (kapandıysa hata bildirimi yerine kapanış ekranı)
  window.fetch = function () {
    return rawFetch.apply(window, arguments).catch((err) => { if (!D.gone) check(); throw err; });
  };
  async function check() {
    if (D.checking || D.gone) return;
    D.checking = true;
    try {
      for (let i = 0; i < 2; i++) {
        try { await rawFetch("/api/ping", { cache: "no-store" }); return; } catch (e) { await new Promise((r) => setTimeout(r, 800)); }
      }
      gone();
    } finally { D.checking = false; }
  }

  // --- kapanış ekranı -----------------------------------------------------------------------------------------
  function gone(why) {
    if (D.gone) return;
    D.gone = true;
    if (D.timer) { clearInterval(D.timer); D.timer = null; }
    document.body.classList.add("djd-gone");
    let el = document.getElementById("djd-gone");
    if (!el) {
      el = document.createElement("div");
      el.id = "djd-gone";
      el.setAttribute("role", "alertdialog");
      el.setAttribute("aria-live", "assertive");
      document.body.appendChild(el);
    }
    const restart = why === "restart";
    el.innerHTML = `<div class="dg-box"><span class="logo dg-logo"></span>
      <h2>${restart ? "DJ Doktor yeniden açıldı" : "DJ Doktor kapandı"}</h2>
      <p>${restart ? "Bu pencereyi yenile ya da kapat." : "Bu pencereyi kapatabilirsin."}</p>
      <div class="dg-acts"><button class="btn" id="dg-retry">${restart ? "Yenile" : "Yeniden bağlan"}</button>
      <button class="btn primary" id="dg-close">Pencereyi kapat</button></div><div class="small muted" id="dg-msg"></div></div>`;
    el.querySelector("#dg-close").onclick = () => {
      window.close();
      setTimeout(() => { const m = el.querySelector("#dg-msg"); if (m) m.textContent = "Bu pencereyi kendin kapat (✕)."; }, 400);
    };
    el.querySelector("#dg-retry").onclick = async () => {
      const m = el.querySelector("#dg-msg");
      try { await rawFetch("/api/ping", { cache: "no-store" }); location.reload(); }
      catch (e) { if (m) m.textContent = "Program kapalı. Masaüstündeki DJ Doktor simgesiyle aç."; }
    };
    setTimeout(() => { const b = el.querySelector(restart ? "#dg-retry" : "#dg-close"); if (b) b.focus(); }, 30);
  }

  async function quit() {
    try {
      await api("/api/app/quit", {});
    } catch (e) { toast(e.message, "err"); return false; }
    D.quitting = true;
    if (D.timer) { clearInterval(D.timer); D.timer = null; }
    gone();
    setTimeout(() => window.close(), 600);      // uygulama penceresi kendini kapatabilir; sekmede ekran kalır
    return true;
  }

  // --- kısayol ------------------------------------------------------------------------------------------------
  async function info(force) {
    if (D.info && !force) return D.info;
    try { D.info = await api("/api/app/info"); } catch (e) { D.info = null; }
    return D.info;
  }
  const scText = (sc) => !sc || !sc.supported ? "" : (sc.exists ? (sc.current ? "✓ Masaüstünde var." : "Kısayol eski bir yeri gösteriyor — yenile.") : "");
  async function makeShortcut() {
    const r = await api("/api/app/shortcut", {});
    if (D.info) { D.info.shortcut = r.shortcut; D.info.offer = false; }
    return r;
  }

  function offerToast() {
    const el = document.createElement("div");
    el.className = "toast djd-offer";
    el.innerHTML = `<div>DJ Doktor'u masaüstünden açmak ister misin?</div>
      <button class="dof-go" type="button">Kısayol oluştur</button><button class="dof-x" aria-label="Kapat" type="button">✕</button>`;
    const box = document.getElementById("toasts");
    if (!box) return;
    box.appendChild(el);
    const kill = () => el.remove();
    el.querySelector(".dof-x").onclick = kill;
    el.querySelector(".dof-go").onclick = async (e) => {
      e.target.disabled = true;
      try { await makeShortcut(); kill(); toast("Masaüstüne “DJ Doktor” kısayolu eklendi.", "ok"); }
      catch (er) { kill(); toast(er.message, "err"); }
    };
    setTimeout(kill, 30000);
    api("/api/app/offer", {}).catch(() => { /* */ });
  }

  // --- Ayarlar > Uygulama -------------------------------------------------------------------------------------
  DJD.settings({
    html: (st) => {
      const p = st.prefs || {};
      return `<div class="djd-appset"><h4 style="margin:18px 0 6px">Uygulama</h4>
        <label class="switch ${p.app_window !== false ? "on" : ""}" data-pref="app_window" style="margin:4px 0"><i></i>Ayrı pencerede aç <span class="muted small">(sonraki açılışta)</span></label>
        <div class="djd-row"><button class="btn sm" id="dsc">Masaüstüne kısayol oluştur</button><span class="small muted minw0" id="dscs"></span></div>
        <div class="djd-row"><button class="btn sm" id="dquit">Programı kapat</button></div></div>`;
    },
    wire: (el) => {
      const btn = el.querySelector("#dsc"), msg = el.querySelector("#dscs");
      if (!btn) return;
      const show = (i) => {
        const sc = i && i.shortcut;
        if (!sc || !sc.supported) { btn.hidden = true; return; }
        btn.textContent = sc.exists ? "Kısayolu yenile" : "Masaüstüne kısayol oluştur";
        msg.textContent = scText(sc);
        msg.classList.remove("djd-bad");
      };
      info(true).then(show);
      btn.onclick = async () => {
        btn.disabled = true; msg.textContent = "Oluşturuluyor…";
        try { const r = await makeShortcut(); show({ shortcut: r.shortcut }); msg.textContent = "✓ Oluşturuldu: " + ((r.shortcut && r.shortcut.name) || "DJ Doktor"); }
        catch (e) { msg.textContent = e.message; msg.classList.add("djd-bad"); }
        btn.disabled = false;
      };
      el.querySelector("#dquit").onclick = async (e) => {
        e.target.disabled = true;
        const ok = await quit();
        if (!ok) e.target.disabled = false;
      };
    },
  });

  // --- sayfa hataları günlüğe (Belgeler/DJ Doktor/gunluk/djdoktor.log) ----------------------------------------
  let logged = 0;
  function report(msg) {
    if (logged++ > 20 || D.gone) return;
    try { rawFetch("/api/app/log", { method: "POST", headers: { "X-DJD-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ msg: String(msg).slice(0, 800) }) }).catch(() => { /* */ }); } catch (e) { /* */ }
  }
  window.addEventListener("error", (e) => report((e.message || "hata") + " @ " + (e.filename || "").split("/").pop() + ":" + (e.lineno || "")));
  window.addEventListener("unhandledrejection", (e) => report("söz: " + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

  // --- başlat -------------------------------------------------------------------------------------------------
  headLinks();
  start();
  setTimeout(async () => {
    const i = await info();
    if (i && i.offer && !D.gone) offerToast();
  }, 2500);
  window.DJDDesktop = { info, quit, gone: () => D.gone, cid: CID };
})();
