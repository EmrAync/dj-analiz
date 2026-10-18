/* DJ Doktor eklentisi: Sürücüye aktar (djdoktor/targets.py, /api/hedef/...).
 * Çalışma yerinin durumu (Engine DJ burayı görür mü?), kayıtlı hedefler, kontrol + aktarım (görev, durdurulabilir).
 * app.js yardımcıları: api, task, toast, esc, $, modal, confirmBox, browseDialog, fmtSize, refresh, S. */
"use strict";
(function () {
  const T = { data: null };
  const sz = (n) => (n == null ? "?" : fmtSize(n));
  const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "hiç");
  const ICON = { block: "⛔", warn: "⚠", info: "ℹ" };
  const probs = (ps) => (ps || []).map((p) => `<div class="tg-p ${p.level}"><span>${ICON[p.level] || ""}</span><span>${esc(p.text)}</span></div>`).join("");

  async function load() {
    try { T.data = await api("/api/hedef/durum"); } catch (e) { T.data = { error: e.message }; }
  }

  function rowT(t) {
    return `<div class="tg-row"><div class="minw0" style="flex:1"><div class="ell"><b>${esc(t.label)}</b> <span class="muted small">${esc(t.path)}</span></div>
      <div class="small muted">${t.present ? `${t.drive_root ? "sürücü kökü" : "klasör (yalnızca yedek)"} · boş ${sz(t.free)} · son aktarım: ${when(t.last)}` : "şu an takılı değil"}</div></div>
      <div class="tg-acts">${t.present ? `<button class="btn sm primary" data-tgrun="${esc(t.path)}">Aktar</button>` : ""}
      <button class="icon-btn" data-tgdel="${esc(t.path)}" title="Listeden kaldır (sürücüye dokunmaz)">✕</button></div></div>`;
  }

  function html() {
    const d = T.data;
    if (!d || d.error) return `<div class="body"><div class="empty">${esc((d && d.error) || "Yükleniyor…")}</div></div>`;
    const L = d.library;
    const known = new Set(d.targets.map((t) => (t.path || "").toLowerCase()));
    const drives = d.drives.filter((x) => !known.has((x.path || "").toLowerCase()) && (x.path || "").toLowerCase() !== (L.drive || "").toLowerCase());
    return `<div class="head"><div class="minw0" style="flex:1"><h2>Sürücüye aktar</h2>
      <div class="sub ell">Kütüphaneyi Engine DJ, Prime 4 ve Serato'nun okuyacağı bir sürücüye doğru yapıyla kopyalar.</div></div></div>
    <div class="body">
      <div class="card"><h3>Çalışma yeri <span class="muted small">(asıl dosyalar burada)</span></h3>
        <div class="wrap-any"><b>${esc(L.path)}</b></div>
        <div class="small muted">${L.drive_root ? "sürücü kökü" : "bir klasör"} · ${esc(L.fs || "dosya sistemi ?")} · ${L.engine ? "Engine kütüphanesi var" : "Engine kütüphanesi yok"}${L.free != null ? " · boş " + sz(L.free) : ""}</div>
        ${probs(L.problems) || `<div class="tg-p ok"><span>✓</span><span>Engine DJ ve Prime 4 burayı doğrudan görür.</span></div>`}
      </div>
      <div class="card"><h3>Hedefler <span class="muted small">(Engine / Prime 4 / Serato için sürücü ya da yedek klasörü)</span></h3>
        ${d.targets.length ? d.targets.map(rowT).join("") : `<div class="muted small">Henüz hedef yok. Aşağıdan bir sürücü seç.</div>`}
        <div class="tg-add"><span class="small muted">Ekle:</span>${drives.map((x) => `<button class="btn sm" data-tgadd="${esc(x.path)}">💾 ${esc(x.label)}</button>`).join("")}
          <button class="btn sm" id="tgpick">📁 Klasör seç…</button></div>
      </div>
      <div class="card"><h3>Nasıl çalışır?</h3><ul class="small tg-rules">
        <li>Kopya hedefin <b>köküne</b> kurulur (<code>Engine Library</code>, <code>Müzik</code>, <code>_Serato_</code>). Engine DJ ve Prime 4 hemen tanır.</li>
        <li>Yalnızca yeni ve değişen dosyalar kopyalanır; yarıda kalırsa (✕ ya da sürücü çıkarsa) sonra kaldığı yerden sürer.</li>
        <li>Hedefte hiçbir şey silinmez. Artık olmayan eski kopyalar hedefte <code>_DJDoktor_/Karantina</code>'ya taşınır.</li>
        <li>Hedefte başka bir kütüphane varsa üstüne yazılmaz; istersen o klasörler silinmeden kenara alınır.</li>
        <li>Aktarırken Engine DJ ve Serato kapalı olmalı. Bitince sürücüyü <b>güvenli çıkar</b> ile çıkar.</li>
        <li>Çalışma yeri değişmez: düzenlemeye hep aynı yerde devam edersin, sonra yeniden aktarırsın.</li></ul></div>
    </div>`;
  }

  async function add(path) {
    try { T.data.targets = (await api("/api/hedef/ekle", { path })).targets; } catch (e) { toast(e.message, "err"); return; }
    await refresh();
    run(path);
  }

  async function run(path) {
    let pl;
    try { pl = await api("/api/hedef/kontrol", { path }); } catch (e) { toast(e.message, "err"); return; }
    const s = pl.summary;
    const foreign = pl.problems.some((p) => p.code === "foreign");
    const body = `<div class="dh">Aktar: ${esc(path)}</div><div class="db">
      <div class="tg-sum"><div><b>${fmtN(s.files)}</b><span>yeni / değişen dosya</span></div><div><b>${sz(s.bytes)}</b><span>kopyalanacak</span></div>
        <div><b>${fmtN(s.stale)}</b><span>eski kopya kenara</span></div><div><b>${sz(pl.check.free)}</b><span>hedefte boş</span></div></div>
      ${probs(pl.problems)}
      ${!pl.problems.length ? `<div class="tg-p ok"><span>✓</span><span>Sorun yok.${pl.check.drive_root ? " Engine DJ ve Prime 4 bu sürücüyü tanıyacak." : ""}</span></div>` : ""}</div>
      <div class="df"><button class="btn" data-x="no">Vazgeç</button>
        ${foreign ? `<button class="btn" data-x="aside" title="Hedefteki Engine Library / _Serato_ silinmez, adına '(eski …)' eklenir">Eskileri kenara al</button>` : ""}
        <button class="btn primary" data-x="yes" ${pl.blocked ? "disabled" : ""}>Aktar</button></div>`;
    const m = modal(body, "wide");
    m.el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      if (b.dataset.x === "no") { m.close(); return; }
      if (b.dataset.x === "aside") {
        const ok = await confirmBox("Kenara al", "Hedefteki Engine Library ve _Serato_ klasörlerinin adı '(eski …)' olarak değişir. Hiçbir şey silinmez.", "Kenara al");
        if (!ok) return;
        try { await api("/api/hedef/kenara", { path }); toast("Eski klasörler kenara alındı.", "ok"); } catch (er) { toast(er.message, "err"); return; }
        m.close(); run(path); return;
      }
      m.close();
      let r;
      try { r = await task("/api/hedef/aktar", { path }); } catch (er) { return; }
      if (r && r.stopped) toast("Aktarım durduruldu. Sonra yeniden başlatınca kaldığı yerden sürer.", "ok");
      else if (r) toast(`Aktarıldı: ${fmtN(r.files)} dosya (${sz(r.bytes)})${r.stale_moved ? `, ${r.stale_moved} eski kopya kenara` : ""}.${r.visible ? " Engine DJ'de sürücüyü aç; sol altta görünür." : ""}`, "ok");
      await load(); await refresh();
    });
  }

  function after() {
    const v = document.querySelector("#tmain") || document;
    v.onclick = async (e) => {
      const a = e.target.closest("[data-tgadd]");
      if (a) { add(a.dataset.tgadd); return; }
      const r = e.target.closest("[data-tgrun]");
      if (r) { run(r.dataset.tgrun); return; }
      const d = e.target.closest("[data-tgdel]");
      if (d) { try { await api("/api/hedef/unut", { path: d.dataset.tgdel }); } catch (er) { toast(er.message, "err"); } await load(); await refresh(); return; }
      if (e.target.id === "tgpick") browseDialog(null, "", (p) => add(p));
    };
  }

  DJD.toolView({ key: "hedef", icon: "💾", title: "Sürücüye aktar", order: 35, width: "read", load, html, after });
  window.DJDTargets = { open: async () => { S.tab = "tools"; S.tview = "hedef"; try { localStorage.setItem("djd.tab", "tools"); localStorage.setItem("djd.tview", "hedef"); } catch (e) { /* */ } await refresh(true); } };
})();
