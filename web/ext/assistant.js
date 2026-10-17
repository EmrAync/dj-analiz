/* DJ Doktor eklentisi: Mix Asistanı (üst sekme "Asistan").
 * Sunucu: /api/assistant/... (djdoktor/assistant.py), /api/ai/... (djdoktor/ai.py).
 * app.js yardımcıları: api, toast, modal, menu, confirmBox, promptBox, vtSet, esc, fmtN, fmtDur, fmtLong, fold,
 * refresh, openTrack, closeDrawer, playFid, settingsDialog, SIDEBTN, S, TOKEN, DJD. */
"use strict";
(function () {
  const VIEWS = [
    ["next", "⏭", "Sonra ne çalınır?"],
    ["wheel", "◎", "Camelot çarkı"],
    ["build", "▤", "Set kurucu"],
    ["ai", "✦", "Yapay zekâ ile kur"],
    ["sort", "⇅", "Listeyi sırala"],
  ];
  const CURVE_TXT = { flat: "Sabit", rising: "Yükselen", wave: "Dalgalı", peak: "Zirve", cooldown: "Sakinleşen" };
  const AS = {
    view: "next", info: null,
    cur: null, chain: [], rows: {}, next: null, nf: { genres: [], ready: false, energy: "" }, aiNext: null, chainScore: null,
    wf: { genres: [], ready: false }, wheel: null, wsel: null, wrows: null,
    bp: { minutes: 60, curve: "wave", genres: [], seeds: [], only_ready: false, bpm_start: "", bpm_end: "" }, build: null,
    ap: { request: "", minutes: 60, genres: [], seeds: [] }, ai: null,
    lists: null, sl: null, sort: null, scurve: "",
    busy: null, ctl: null,
  };
  try {
    const sv = JSON.parse(localStorage.getItem("djd.as") || "{}");
    if (sv.view && VIEWS.some((v) => v[0] === sv.view)) AS.view = sv.view;
    if (sv.bp) Object.assign(AS.bp, sv.bp, { seeds: [] });
    if (sv.ap) Object.assign(AS.ap, sv.ap, { seeds: [] });
    if (sv.nf) Object.assign(AS.nf, sv.nf);
  } catch (e) { /* tarayıcı depolaması yok */ }
  const save = () => {
    try { localStorage.setItem("djd.as", JSON.stringify({ view: AS.view, bp: AS.bp, ap: AS.ap, nf: AS.nf })); } catch (e) { /* */ }
  };

  // --- küçük parçalar ---------------------------------------------------------------------------------
  const hue = (cam) => { const n = parseInt(cam, 10); return n ? (165 - (n - 1) * 30 + 360) % 360 : 0; };
  const camHtml = (cam, extra = "") => cam
    ? `<span class="as-cam${extra}" style="--h:${hue(cam)}" data-l="${cam.slice(-1)}" title="Camelot ${esc(cam)}">${esc(cam)}</span>`
    : `<span class="as-cam none" title="Ton bilinmiyor">?</span>`;
  const scClass = (s) => (s >= 75 ? "hi" : s >= 50 ? "mid" : "lo");
  const scHtml = (s, title = "") => (s == null ? "" : `<span class="as-sc ${scClass(s)}" title="${esc(title || "Geçiş puanı " + s + "/100")}"><span class="tr"><i style="width:${Math.max(4, Math.min(100, s))}%"></i></span><b>${s}</b></span>`);
  const enHtml = (r, de) => `<span class="as-en${r.e_est ? " est" : ""}" title="Enerji ${r.energy}/10${r.e_est ? " (tahmin)" : " (Mixed In Key)"}">${de > 0 ? "↑" : de < 0 ? "↓" : ""}${r.energy}${r.e_est ? "~" : ""}</span>`;
  const bpmHtml = (r, pct, tempo) => {
    if (!r.bpm) return `<span class="muted">—</span>`;
    const b = Math.round(r.bpm);
    let d = "";
    if (tempo === "double") d = "×2";
    else if (tempo === "half") d = "½";
    else if (pct != null && Math.abs(pct) >= 0.5) d = (pct > 0 ? "+" : "−") + Math.abs(Math.round(pct)) + "%";
    return `${b}${d ? ` <span class="as-d">${d}</span>` : ""}`;
  };
  const gHtml = (r) => (r.genre ? `<span class="tag" ${r.color ? `style="border-color:${esc(r.color)};color:${esc(r.color)}"` : ""} title="${esc(r.genre)}">${esc(r.genre)}</span>` : "");
  // zayıf geçişte önce uyarılar görünsün (dar sütunda en önemlisi okunur)
  const whyHtml = (r) => {
    const g = (r.reasons || []).map((x) => `<span class="tag ok">${esc(x)}</span>`), w = (r.warns || []).map((x) => `<span class="tag warn">${esc(x)}</span>`);
    return (r.score != null && r.score < 60 ? w.concat(g) : g.concat(w)).join("");
  };
  const whyTitle = (r) => [...(r.reasons || []), ...(r.warns || [])].join(" · ");
  const engineOk = () => S.st && S.st.has_engine && !S.st.engine_open;
  const engineWhy = () => (!S.st || !S.st.has_engine ? "Bu SSD'de Engine kütüphanesi yok." : S.st.engine_open ? "Engine DJ açık: kaydetmek için kapat." : "");
  const remember = (rows) => (rows || []).forEach((r) => { if (r && r.id) AS.rows[r.id] = Object.assign(AS.rows[r.id] || {}, r); });
  const genres = () => (AS.info && AS.info.genres) || [];

  async function post(path, body) {
    return api("/api/assistant/" + path, body);
  }
  // İptal edilebilen istek (yapay zekâ): sunucu işini bitirir ama sonucu kullanılmaz
  async function postAbortable(path, body) {
    if (AS.ctl) AS.ctl.abort();
    const ctl = new AbortController();
    AS.ctl = ctl;
    try {
      const r = await fetch("/api/assistant/" + path, { method: "POST", signal: ctl.signal,
        headers: { "X-DJD-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      if (!r.ok) { const err = new Error((data && data.error) || ("Sunucu hatası " + r.status)); err.code = data && data.code; throw err; }
      return data;
    } finally { if (AS.ctl === ctl) AS.ctl = null; }
  }
  function busy(kind, on) {
    AS.busy = on ? kind : null;
    S.busy = !!on;                              // arka plan yenilemesi bu sırada ekranı yeniden çizmesin
  }
  function cancel() {
    if (AS.ctl) AS.ctl.abort();
    busy(null, false);
    render();
  }

  // --- yükleme -------------------------------------------------------------------------------------------
  async function load() {
    try { AS.info = await api("/api/assistant/info"); } catch (e) { AS.info = null; toast(e.message, "err"); }
    if (AS.view === "next" && AS.cur) await loadNext(true);
    else if (AS.view === "wheel") await loadWheel();
    else if (AS.view === "sort") await loadSort();
    else if (AS.view === "build" || AS.view === "ai") { try { AS.lists = await api("/api/lists"); } catch (e) { AS.lists = null; } }
    render();
  }
  async function loadNext(quiet) {
    if (!AS.cur) { AS.next = null; return; }
    const prev = prevOf(AS.cur);
    try {
      AS.next = await post("next", { id: AS.cur, prev, filters: nextFilters(), limit: 60 });
      remember([AS.next.cur]);
      remember(AS.next.items);
    } catch (e) {
      AS.next = null;
      if (e.code === "gone") { AS.chain = AS.chain.filter((x) => x !== AS.cur); AS.cur = AS.chain[AS.chain.length - 1] || null; }
      if (!quiet) toast(e.message, "err");
    }
    await scoreChain();
  }
  function nextFilters() {
    const f = { genres: AS.nf.genres, ready: AS.nf.ready, exclude: AS.chain };
    if (AS.nf.energy) f.energy = AS.nf.energy;
    return f;
  }
  function prevOf(id) { const i = AS.chain.indexOf(id); return i > 0 ? AS.chain[i - 1] : null; }
  async function scoreChain() {
    if (AS.chain.length < 2) { AS.chainScore = null; return; }
    try { AS.chainScore = await post("score", { ids: AS.chain }); remember(AS.chainScore.rows); } catch (e) { AS.chainScore = null; }
  }
  async function loadWheel() {
    const q = new URLSearchParams();
    if (AS.wf.genres.length) q.set("genres", AS.wf.genres.join(","));
    if (AS.wf.ready) q.set("ready", "1");
    if (AS.cur) q.set("around", AS.cur);
    try { AS.wheel = await api("/api/assistant/wheel?" + q.toString()); } catch (e) { AS.wheel = null; toast(e.message, "err"); }
    if (AS.wsel != null) await loadKey(AS.wsel);
  }
  async function loadKey(cam) {
    AS.wsel = cam;
    try {
      AS.wrows = await post("key", { cam, filters: { genres: AS.wf.genres, ready: AS.wf.ready }, around: AS.cur });
      remember(AS.wrows.rows);
    } catch (e) { AS.wrows = null; toast(e.message, "err"); }
  }
  async function loadSort() {
    try { AS.lists = await api("/api/lists"); } catch (e) { AS.lists = null; }
    const ok = AS.lists && (AS.lists.lists || []).some((l) => l.id === AS.sl);
    if (!ok) { AS.sl = null; AS.sort = null; return; }
    try { AS.sort = await post("list_sort", { id: AS.sl, curve: AS.scurve || null }); } catch (e) { AS.sort = { error: e.message }; }
  }

  // --- çizim ---------------------------------------------------------------------------------------------
  function sideHtml() {
    const inf = AS.info || {};
    const ln = (inf.learned || {});
    const pairs = ln.pairs || 0;
    return `<aside class="side"><div class="scroll">
      ${VIEWS.map(([k, ic, t]) => `<div class="nav-item ${AS.view === k ? "on" : ""}" data-asv="${k}"><span class="tic">${ic}</span><span class="name">${t}</span></div>`).join("")}
      </div><div class="muted small sidenote as-stats">${inf.total != null ? `${fmtN(inf.total)} şarkı · tonu belli ${fmtN(inf.with_key)} · BPM'i belli ${fmtN(inf.with_bpm)}${pairs ? ` · ${fmtN(pairs)} öğrenilmiş geçiş` : ""}` : ""}</div></aside>`;
  }
  function head(title, sub, extra = "") {
    return `<div class="head">${SIDEBTN}<div class="ht minw0"><h2>${esc(title)}</h2>${sub ? `<div class="sub ell" title="${esc(sub)}">${esc(sub)}</div>` : ""}</div>${extra}</div>`;
  }
  function render() {
    const v = $("#view");
    if (!v || S.tab !== "assistant") return;
    const prev = $("#asmain .body");
    const keep = prev && AS._last === AS.view ? prev.scrollTop : 0;
    let main = "";
    if (AS.view === "next") main = nextHtml();
    else if (AS.view === "wheel") main = wheelHtml();
    else if (AS.view === "build") main = buildHtml();
    else if (AS.view === "ai") main = aiHtml();
    else main = sortHtml();
    v.innerHTML = `<div class="split as">${sideHtml()}<section class="main ${AS.view === "next" || AS.view === "wheel" ? "" : "read"}" id="asmain">${main}</section></div>`;
    AS._last = AS.view;
    if (keep && $("#asmain .body")) $("#asmain .body").scrollTop = keep;
    after();
  }
  function after() {
    if (AS.view === "next" && AS.next) vtSet("asnx", AS.next.items, nxRowHtml);
    if (AS.view === "wheel" && AS.wrows) vtSet("askt", AS.wrows.rows, ktRowHtml);
    if (AS.view === "build" && AS.build) drawSet("asbt", AS.build);
    if (AS.view === "ai" && AS.ai) drawSet("asat", AS.ai);
    if (AS.view === "sort" && AS.sort && !AS.sort.error) vtSet("asst", sortRows(), sortRowHtml);
    DJD.layout();
  }

  // ---- 1) Sonra ne çalınır? -------------------------------------------------------------------------------
  function curCard() {
    const c = AS.next && AS.next.cur ? AS.next.cur : AS.rows[AS.cur];
    if (!c) return "";
    return `<div class="card as-cur"><div class="as-curm minw0"><div class="as-now muted small">Şu an</div>
        <div class="ttl ell" title="${esc(c.title)}">${esc(c.title)}</div><div class="art ell">${esc(c.artist || "—")}</div></div>
      <div class="as-curf">${camHtml(c.cam, " big")}<span class="as-kv"><b>${c.bpm ? Math.round(c.bpm) : "—"}</b><span class="muted small">BPM</span></span>
        <span class="as-kv"><b>${c.energy}${c.e_est ? "~" : ""}</b><span class="muted small">enerji</span></span>${gHtml(c)}</div>
      <div class="as-cura"><button class="play" data-play="${c.id}" title="Dinle">▶</button><button class="btn sm" data-ainfo="${c.id}">Ayrıntı</button>
        <button class="btn sm" id="asainext" title="Çevrimdışı ilk 40 aday arasından en iyi 5'i yapay zekâ seçer">✦ Yapay zekâya sor</button></div></div>`;
  }
  function filtersHtml(f, idp) {
    const gs = genres();
    const gl = f.genres.length ? f.genres.map((g) => (gs.find((x) => String(x.id) === String(g)) || { name: g }).name).join(", ") : "Tüm türler";
    return `<div class="chips as-flt">
      <span class="chip ${f.genres.length ? "on" : ""}" id="${idp}g" title="${esc(gl)}">${esc(gl)} ▾</span>
      <span class="chip ${f.ready ? "on" : ""}" id="${idp}r" title="Yalnızca Engine'de analiz edilmiş şarkılar">Yalnızca hazır</span>
      ${f.energy !== undefined ? [["", "Enerji: serbest"], ["up", "↑ Yükselt"], ["same", "→ Aynı kalsın"], ["down", "↓ Sakinleştir"]].map(([k, t]) => `<span class="chip ${f.energy === k ? "on" : ""}" data-asen="${k}">${t}</span>`).join("") : ""}
    </div>`;
  }
  function nextHtml() {
    const sub = AS.cur ? "Puan: ton (Camelot), tempo, enerji, tür ve daha önce arka arkaya çaldıkların." : "Bir şarkı seç; ardından gelebilecekler puanla sıralanır.";
    const search = `<input class="search as-q" id="asq" placeholder="Şarkı ara: ad, sanatçı…" autocomplete="off">`;
    if (!AS.cur) {
      return head("Sonra ne çalınır?", sub, search) + `<div class="body"><div class="empty"><div class="big">🎧</div>Yukarıdan bir şarkı ara ya da bir şarkının ayrıntısında <b>Sonra ne çalınır?</b> düğmesine bas.</div></div>`;
    }
    const n = AS.next;
    const ai = aiNextHtml();
    const tbl = n ? `<table class="t v as-nx" id="asnx"><colgroup><col data-w="4.4em"><col data-min="9em" data-flex="2"><col data-w="3.6em"><col data-w="6em" data-pri="4"><col data-w="4.2em" data-pri="3"><col data-min="8em" data-flex="1.4" data-pri="2"><col data-w="7.5em" data-pri="1"><col data-w="5.8em"></colgroup>
      <thead><tr><th title="Geçiş puanı">Puan</th><th>Şarkı</th><th>Ton</th><th>BPM</th><th title="Enerji (1–10)">Enerji</th><th>Neden</th><th>Tür</th><th></th></tr></thead><tbody></tbody></table>
      ${n.items.length ? "" : `<div class="empty">Bu filtreye uyan şarkı yok.</div>`}` : `<div class="empty">Yükleniyor…</div>`;
    return head("Sonra ne çalınır?", sub, search) + `<div class="body"><div class="as-grid">
      <div class="minw0">${curCard()}${filtersHtml(AS.nf, "asn")}${ai}
        <div class="muted small as-hint">Bir satıra tıkla: o şarkı sıradaki olur ve zincire eklenir.</div>${tbl}</div>
      ${chainHtml()}</div></div>`;
  }
  function aiNextHtml() {
    if (AS.busy === "ainext") return `<div class="card as-aibox"><span class="as-spin"></span> Yapay zekâ düşünüyor… <button class="btn sm" data-ascancel>İptal</button></div>`;
    const r = AS.aiNext;
    if (!r || r.cur.id !== AS.cur) return "";
    const err = r.ai_error ? `<div class="hint"><span class="ic">ⓘ</span><div>${esc(aiErrText(r.ai_error))}${r.ai_error.code === "ai_no_key" ? ` <button class="btn sm" data-askey>Ayarlar'da anahtar gir</button>` : ""}<div class="muted small">Aşağıda çevrimdışı öneriler var.</div></div></div>` : "";
    const items = r.source === "ai" ? r.items.map((x) => `<div class="hrow as-pick" data-aspick="${x.id}"><span class="as-sc-w">${scHtml(x.score, whyTitle(x))}</span><div class="meta"><div class="ttl">${esc(x.title)} <span class="muted">— ${esc(x.artist || "")}</span></div><div class="why" title="${esc(x.why)}">${esc(x.why)}</div></div>${camHtml(x.cam)}<button class="play" data-play="${x.id}">▶</button></div>`).join("") : "";
    return `<div class="card as-aibox">${err}${items ? `<div class="as-aih"><b>✦ Yapay zekânın seçtikleri</b>${r.note ? ` <span class="muted small">${esc(r.note)}</span>` : ""}<button class="icon-btn right" data-asaiclose title="Kapat">✕</button></div>${items}` : `<button class="icon-btn right" data-asaiclose title="Kapat">✕</button>`}</div>`;
  }
  function nxRowHtml(r) {
    return `<tr data-aspick="${r.id}" class="as-row" title="${esc(whyTitle(r))}"><td>${scHtml(r.score, whyTitle(r))}</td>
      <td class="c-song"><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}${r.plays ? ` · ${r.plays}× çalındı` : ""}</div></td>
      <td>${camHtml(r.cam)}</td><td class="as-num">${bpmHtml(r, r.bpm_pct, r.tempo)}</td><td class="as-num">${enHtml(r, r.de)}</td>
      <td class="as-why">${whyHtml(r)}</td><td>${gHtml(r)}</td>
      <td class="c-act"><button class="play" data-play="${r.id}" title="Dinle">▶</button><button class="icon-btn" data-ainfo="${r.id}" title="Ayrıntı">ⓘ</button></td></tr>`;
  }
  function chainHtml() {
    const ch = AS.chain;
    const trs = (AS.chainScore && AS.chainScore.transitions) || [];
    const dur = ch.reduce((a, id) => a + ((AS.rows[id] || {}).dur || 0), 0);
    const items = ch.map((id, i) => {
      const r = AS.rows[id] || { title: "#" + id };
      const t = i > 0 ? trs[i - 1] : null;
      return `${t ? `<div class="as-link" title="${esc(whyTitle(t))}">${scHtml(t.score, whyTitle(t))}<span class="small muted ell">${esc((t.reasons || [])[0] || (t.warns || [])[0] || "")}</span></div>` : ""}
        <div class="as-ci ${id === AS.cur ? "on" : ""}" data-ascur="${id}"><span class="as-n">${i + 1}</span><div class="minw0 as-cim"><div class="ttl ell">${esc(r.title)}</div><div class="art ell">${esc(r.artist || "")}</div></div>${camHtml(r.cam)}<button class="icon-btn" data-asdel="${id}" title="Zincirden çıkar">✕</button></div>`;
    }).join("");
    const why = engineWhy();
    return `<aside class="card as-chain" data-cw><div class="as-chh"><b>Zincir</b><span class="muted small">${ch.length} şarkı${dur ? " · " + fmtLong(dur) : ""}${AS.chainScore && AS.chainScore.summary.avg != null ? " · ort. " + Math.round(AS.chainScore.summary.avg) : ""}</span></div>
      <div class="as-chl">${items || `<div class="muted small">Seçtiğin şarkılar burada sıralanır.</div>`}</div>
      <div class="as-cha"><button class="btn sm primary" data-assave="chain" ${ch.length && !why ? "" : "disabled"} title="${esc(why || "Engine'e liste olarak kaydet")}">Liste olarak kaydet</button>
        <button class="btn sm" id="asfix" ${ch.length > 2 ? "" : "disabled"} title="İlk şarkı yerinde kalır, geri kalanı en iyi geçişlere göre dizilir">Geçişleri iyileştir</button>
        <button class="btn sm ghost" id="asclr" ${ch.length ? "" : "disabled"}>Temizle</button></div></aside>`;
  }
  async function pick(id) {
    id = +id;
    if (!id || id === AS.cur) return;
    const i = AS.chain.indexOf(AS.cur);
    AS.chain = AS.chain.filter((x) => x !== id);
    const j = AS.chain.indexOf(AS.cur);
    if (i < 0 || j < 0) AS.chain.push(id); else AS.chain.splice(j + 1, 0, id);
    AS.cur = id;
    AS.aiNext = null;
    await loadNext();
    render();
  }
  async function setCurrent(id, fresh) {
    id = +id;
    if (fresh || !AS.chain.length) AS.chain = [id];
    else if (!AS.chain.includes(id)) AS.chain.push(id);
    AS.cur = id;
    AS.aiNext = null;
    await loadNext();
  }
  async function askAiNext() {
    if (!AS.cur || AS.busy) return;
    busy("ainext", true);
    render();
    try {
      const r = await postAbortable("ai_next", { id: AS.cur, prev: prevOf(AS.cur), filters: nextFilters() });
      AS.aiNext = r;
      remember(r.items);
    } catch (e) { if (e.name !== "AbortError") toast(e.message, "err"); }
    busy(null, false);
    render();
  }
  async function fixChain() {
    if (AS.chain.length < 3) return;
    try {
      const r = await post("sort", { ids: AS.chain, fixed_first: AS.chain[0] });
      AS.chain = r.order.slice();
      remember(r.rows);
      toast((r.after.avg || 0) > (r.before.avg || 0) + .4 ? `Geçişler iyileşti: ortalama ${Math.round(r.before.avg || 0)} → ${Math.round(r.after.avg || 0)}` : "Sıra zaten en iyi geçişlerde.", "ok");
      AS.cur = AS.chain[AS.chain.length - 1];
      await loadNext();
      render();
    } catch (e) { toast(e.message, "err"); }
  }

  // ---- 2) Camelot çarkı ----------------------------------------------------------------------------------
  function wheelSvg(w) {
    const cnt = {};
    (w.keys || []).forEach((k) => { cnt[k.cam] = k.n; });
    const max = Math.max(1, ...Object.values(cnt));
    const comp = {};
    (w.compatible || []).forEach((c) => { comp[c.cam] = c; });
    const around = w.around && w.around.cam;
    const R = [44, 74, 100];                                  // iç (A) ve dış (B) halka
    const pt = (r, a) => [110 + r * Math.sin(a), 110 - r * Math.cos(a)];
    const arc = (r0, r1, a0, a1) => {
      const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
      return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r1},${r1} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} A${r0},${r0} 0 0 0 ${x3.toFixed(2)},${y3.toFixed(2)}Z`;
    };
    let out = "";
    for (let n = 1; n <= 12; n++) {
      const ac = ((n % 12) * 30) * Math.PI / 180, a0 = ac - Math.PI / 12, a1 = ac + Math.PI / 12;
      for (const L of ["A", "B"]) {
        const cam = n + L, k = cnt[cam] || 0;
        const [r0, r1] = L === "A" ? [R[0], R[1]] : [R[1], R[2]];
        const [lx, ly] = pt((r0 + r1) / 2, ac);
        const cls = ["as-sl", L === "A" ? "a" : "b", AS.wsel === cam ? "sel" : "", around === cam ? "cur" : "", comp[cam] && around !== cam ? "comp" : "", around && !comp[cam] && around !== cam ? "dim" : "", k ? "" : "zero"].filter(Boolean).join(" ");
        const ttl = `${cam} (${(w.keys.find((x) => x.cam === cam) || {}).musical || ""}) · ${k} şarkı${comp[cam] ? " · " + comp[cam].label : ""}`;
        out += `<g class="${cls}" data-ascam="${cam}" style="--h:${hue(cam)};--k:${(0.25 + 0.75 * k / max).toFixed(2)}" tabindex="0" role="button" aria-label="${esc(ttl)}"><title>${esc(ttl)}</title>
          <path d="${arc(r0, r1, a0, a1)}"></path><text x="${lx.toFixed(1)}" y="${(ly - 2).toFixed(1)}">${cam}</text><text class="n" x="${lx.toFixed(1)}" y="${(ly + 9).toFixed(1)}">${k || ""}</text></g>`;
      }
    }
    return `<svg viewBox="0 0 220 220" class="as-wheel" role="group" aria-label="Camelot çarkı">${out}<circle cx="110" cy="110" r="${R[0] - 3}" class="as-hub"></circle>
      <text x="110" y="107" class="as-hubt">${fmtN(w.total)}</text><text x="110" y="120" class="as-hubs">şarkı</text></svg>`;
  }
  function histSvg(vals, labels, title) {
    const max = Math.max(1, ...vals);
    const n = vals.length || 1, bw = 200 / n;
    return `<div class="as-hist"><div class="muted small">${esc(title)}</div><svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">${vals.map((v, i) => `<rect x="${(i * bw + 0.5).toFixed(2)}" y="${(58 - 56 * v / max).toFixed(2)}" width="${Math.max(0.5, bw - 1).toFixed(2)}" height="${(56 * v / max).toFixed(2)}"><title>${esc(labels[i])}: ${v}</title></rect>`).join("")}</svg>
      <div class="as-hl muted small"><span>${esc(labels[0] || "")}</span><span>${esc(labels[labels.length - 1] || "")}</span></div></div>`;
  }
  function wheelHtml() {
    const w = AS.wheel;
    const cur = AS.cur && AS.rows[AS.cur];
    const sub = cur ? `Seçili şarkı: ${cur.title} (${cur.cam || "ton yok"}) · uyumlu tonlar vurgulu` : "Bir tona tıkla: o tondaki şarkılar listelenir.";
    if (!w) return head("Camelot çarkı", sub) + `<div class="body"><div class="empty">Yükleniyor…</div></div>`;
    const bpm = w.bpm || [];
    const kt = AS.wrows;
    const tbl = kt ? `<h3 class="as-h3">${esc(kt.cam || "Tonu bilinmeyen")}${kt.musical ? ` <span class="muted small">(${esc(kt.musical)})</span>` : ""} · ${fmtN(kt.n)} şarkı${cur ? ` <span class="muted small">· puan: “${esc(cur.title)}” şarkısından geçiş</span>` : ""}</h3>
      <table class="t v" id="askt"><colgroup>${cur ? `<col data-w="4.4em">` : ""}<col data-min="9em" data-flex="2"><col data-w="3.6em"><col data-w="4.6em" data-pri="3"><col data-w="4.2em" data-pri="2"><col data-w="7.5em" data-pri="1"><col data-w="9em"></colgroup>
      <thead><tr>${cur ? "<th>Puan</th>" : ""}<th>Şarkı</th><th>Ton</th><th>BPM</th><th>Enerji</th><th>Tür</th><th></th></tr></thead><tbody></tbody></table>` : "";
    return head("Camelot çarkı", sub) + `<div class="body">${filtersHtml({ genres: AS.wf.genres, ready: AS.wf.ready }, "asw")}
      <div class="as-wheelwrap"><div class="as-wbox">${wheelSvg(w)}</div>
        <div class="as-wside minw0">
          <div class="as-legend small"><span><i class="as-lg cur"></i>Seçili şarkının tonu</span><span><i class="as-lg comp"></i>Uyumlu (aynı, ±1, A↔B, çapraz, +2)</span><span class="muted">İç halka A = minör, dış halka B = majör</span></div>
          ${histSvg(bpm.map((b) => b.n), bpm.map((b) => b.lo + "–" + (b.lo + 4)), "BPM dağılımı")}
          ${histSvg(w.energy || [], (w.energy || []).map((_, i) => "Enerji " + (i + 1)), "Enerji dağılımı (1–10)")}
          ${w.unknown ? `<button class="btn sm" data-ascam="?">Tonu bilinmeyen ${fmtN(w.unknown)} şarkı</button>` : ""}
        </div></div>${tbl}</div>`;
  }
  function ktRowHtml(r) {
    const cur = AS.cur && AS.rows[AS.cur];
    return `<tr>${cur ? `<td>${r.score != null ? scHtml(r.score) : ""}</td>` : ""}<td class="c-song" data-info="${r.id}"><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}</div></td>
      <td>${camHtml(r.cam)}</td><td class="as-num">${r.bpm ? Math.round(r.bpm) : "—"}</td><td class="as-num">${enHtml(r, 0)}</td><td>${gHtml(r)}</td>
      <td class="c-act"><button class="play" data-play="${r.id}" title="Dinle">▶</button><button class="btn sm" data-asgo="${r.id}" title="Bu şarkıdan sonra ne çalınır?">Sonra ne?</button></td></tr>`;
  }

  // ---- 3) Set kurucu + 4) Yapay zekâ: ortak sonuç görünümü ---------------------------------------------
  function curveSvg(k, cls = "") {
    const pts = ((AS.info && AS.info.curves) || []).find((c) => c.key === k);
    const p = pts ? pts.pts : [[0, .5], [1, .5]];
    const d = p.map(([x, y], i) => `${i ? "L" : "M"}${(2 + x * 56).toFixed(1)},${(20 - y * 17).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 60 22" class="as-cv ${cls}" aria-hidden="true"><path d="${d}"></path></svg>`;
  }
  function seedsHtml(list, id) {
    return `<div class="as-seeds" id="${id}">${list.map((x) => { const r = AS.rows[x] || { title: "#" + x }; return `<span class="chip on as-seed" title="${esc(r.title)}">${esc(r.title)} <b data-asseedx="${x}" data-for="${id}">✕</b></span>`; }).join("")}
      <span class="chip" data-asseedadd="${id}">＋ Şarkı ekle</span></div>`;
  }
  function genreChips(sel, attr) {
    const gs = genres();
    return `<div class="chips as-gchips">${gs.map((g) => `<span class="chip ${sel.includes(g.id) ? "on" : ""}" data-${attr}="${g.id}" title="${fmtN(g.n)} şarkı">${esc(g.name)}</span>`).join("") || `<span class="muted small">Tür klasörü yok.</span>`}</div>`;
  }
  // "Şu etkinlikte olanları ekleme": aynı misafirlere aynı şarkılar çalınmasın
  function evSelect(id, val) {
    const evs = ((AS.lists && AS.lists.lists) || []).filter((l) => l.path.length === 2 && l.path[0] === "Etkinlikler");
    if (!evs.length) return "";
    return `<label class="field as-exl"><span>Şu etkinlikte olanları ekleme</span><select id="${id}"><option value="">—</option>${evs.slice(0, 60).map((l) => `<option value="${l.id}" ${l.id === val ? "selected" : ""}>${esc(l.title)}</option>`).join("")}</select></label>`;
  }
  function buildHtml() {
    const b = AS.bp;
    const curves = Object.keys(CURVE_TXT);
    const form = `<div class="card as-form">
      <div class="frow"><label class="field"><span>Süre (dakika)</span><input type="number" id="asbmin" min="5" max="600" step="5" value="${esc(b.minutes)}"></label>
        <label class="field"><span>BPM başlangıç</span><input type="number" id="asbb0" min="40" max="220" placeholder="serbest" value="${esc(b.bpm_start)}"></label>
        <label class="field"><span>BPM bitiş</span><input type="number" id="asbb1" min="40" max="220" placeholder="serbest" value="${esc(b.bpm_end)}"></label></div>
      <div class="field"><span>Enerji eğrisi</span><div class="as-curves">${curves.map((k) => `<button class="as-curve ${b.curve === k ? "on" : ""}" data-ascurve="${k}" type="button">${curveSvg(k)}<span>${CURVE_TXT[k]}</span></button>`).join("")}</div></div>
      <div class="field"><span>Türler <span class="muted">(seçmezsen hepsi)</span></span>${genreChips(b.genres, "asbg")}</div>
      <div class="field"><span>Başlangıç şarkıları <span class="muted">(ilkiyle başlar, hepsi sette olur)</span></span>${seedsHtml(b.seeds, "asbs")}</div>
      ${evSelect("asbx", b.exclude_list)}
      <div class="exrow"><label class="switch ${b.only_ready ? "on" : ""}" id="asbready"><i></i>Yalnızca analiz edilmiş şarkılar</label>
        <button class="btn primary right" id="asbgo">Seti kur</button></div></div>`;
    return head("Set kurucu", "Süreyi, türü ve enerji eğrisini seç; uyumlu geçişlerle bir set kurulur (internet gerekmez).") +
      `<div class="body">${form}${AS.busy === "build" ? `<div class="card"><span class="as-spin"></span> Kuruluyor…</div>` : AS.build ? setHtml(AS.build, "asbt") : ""}</div>`;
  }
  function aiHtml() {
    const a = AS.ap;
    const p = (S.st && S.st.prefs) || {};
    const keyHint = p.ai_key_set ? "" : `<div class="hint blue"><span class="ic">✦</span><div><b>Yapay zekâ için bir API anahtarı gerekli.</b> Anahtar yoksa çevrimdışı set kurulur.
      <div style="margin-top:6px"><button class="btn sm" data-askey>Ayarlar'da anahtar gir</button></div></div></div>`;
    const form = `<div class="card as-form">
      <label class="field"><span>Ne istiyorsun?</span><textarea id="asareq" rows="3" placeholder="Örn: Kına gecesi, 45 dakika, sakin başlasın, sonunda coşsun">${esc(a.request)}</textarea></label>
      <div class="frow"><label class="field"><span>Süre (dakika)</span><input type="number" id="asamin" min="5" max="600" step="5" value="${esc(a.minutes)}"></label></div>
      <div class="field"><span>Türler <span class="muted">(isteğe bağlı)</span></span>${genreChips(a.genres, "asag")}</div>
      <div class="field"><span>Başlangıç şarkıları <span class="muted">(isteğe bağlı)</span></span>${seedsHtml(a.seeds, "asas")}</div>
      ${evSelect("asax", a.exclude_list)}
      <div class="exrow"><span class="muted small minw0">Yalnızca şarkı adı, sanatçı, tür, BPM, ton ve süre gönderilir.</span><button class="btn primary right" id="asago">${p.ai_key_set ? "✦ Yapay zekâ ile kur" : "Kur"}</button></div></div>`;
    const busyHtml = AS.busy === "ai" ? `<div class="card as-aibox"><span class="as-spin"></span> Yapay zekâ seti kuruyor… (bir dakika kadar sürebilir) <button class="btn sm" data-ascancel>İptal</button></div>` : "";
    return head("Yapay zekâ ile kur", "İsteğini yaz; aday şarkılar senin kütüphanenden seçilir, geçişler puanlanır.") +
      `<div class="body">${keyHint}${form}${busyHtml}${!AS.busy && AS.ai ? setHtml(AS.ai, "asat") : ""}</div>`;
  }
  function aiErrText(e) {
    const t = { ai_no_key: "Yapay zekâ anahtarı girilmemiş.", ai_offline: "İnternete bağlanılamadı.", ai_busy: "Yapay zekâ şu an yoğun.",
      ai_auth: "API anahtarı geçersiz.", ai_timeout: "Yapay zekâ zamanında yanıt vermedi.", ai_empty: "Yapay zekâ kullanılabilir bir liste döndürmedi." };
    return t[e.code] || e.message || "Yapay zekâ kullanılamadı.";
  }
  function setRows(res) {
    const rows = [];
    const by = {};
    (res.rows || []).forEach((r) => { by[r.id] = r; });
    const trs = res.transitions || [];
    let k = 0;
    const multi = (res.sections || []).length > 1;
    (res.sections || []).forEach((s, si) => {
      const rs = s.ids.map((id) => by[id]).filter(Boolean);
      if (multi) rows.push({ sec: s.name, n: rs.length, dur: rs.reduce((a, r) => a + (r.dur || 0), 0), si });
      rs.forEach((r) => { rows.push(Object.assign({}, r, { idx: k + 1, tr: k > 0 ? trs[k - 1] : null })); k++; });
    });
    return rows;
  }
  function spark(res) {
    const rows = res.rows || [];
    if (rows.length < 2) return "";
    const tot = rows.reduce((a, r) => a + (r.dur || 240), 0) || 1;
    let x = 0;
    const pts = rows.map((r) => { const d = r.dur || 240; const p = (x + d / 2) / tot; x += d; return p; });
    const W = 600, H = 70;
    const ex = (p) => (6 + p * (W - 12)).toFixed(1);
    const ey = (e) => (H - 6 - (e - 1) / 9 * (H - 12)).toFixed(1);
    const bp = rows.map((r) => r.bpm).filter(Boolean);
    const bmin = Math.min(...bp), bmax = Math.max(...bp);
    const by = (b) => (H - 6 - (bmax > bmin ? (b - bmin) / (bmax - bmin) : .5) * (H - 12)).toFixed(1);
    const line = (vals, f) => vals.map((v, i) => (v == null ? null : `${ex(pts[i])},${f(v)}`)).filter(Boolean).join(" ");
    const tg = rows.some((r) => r.target != null) ? `<polyline class="tg" points="${line(rows.map((r) => r.target), ey)}"></polyline>` : "";
    const bl = bp.length > 1 ? `<polyline class="bp" points="${line(rows.map((r) => r.bpm || null), by)}"></polyline>` : "";
    return `<div class="as-spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${tg}${bl}<polyline class="en" points="${line(rows.map((r) => r.energy), ey)}"></polyline></svg>
      <div class="as-sl2 small muted"><span><i class="en"></i>Enerji</span>${tg ? `<span><i class="tg"></i>Hedef eğri</span>` : ""}${bl ? `<span><i class="bp"></i>BPM ${Math.round(bmin)}–${Math.round(bmax)}</span>` : ""}</div></div>`;
  }
  function setHtml(res, id) {
    const s = res.summary || {};
    const why = engineWhy();
    const src = res.source === "ai" ? `<span class="tag blue">✦ Yapay zekâ${res.model ? " · " + esc(res.model) : ""}</span>` : `<span class="tag">Çevrimdışı</span>`;
    const err = res.ai_error ? `<div class="hint"><span class="ic">ⓘ</span><div><b>${esc(aiErrText(res.ai_error))}</b> Yerine çevrimdışı set kuruldu.${res.ai_error.code === "ai_no_key" || res.ai_error.code === "ai_auth" ? ` <button class="btn sm" data-askey>Ayarlar'da anahtar gir</button>` : ""}</div></div>` : "";
    const warns = (res.warnings || []).map((w) => `<div class="small as-warn">⚠ ${esc(w)}</div>`).join("");
    const notes = res.notes ? `<div class="hint blue"><span class="ic">✦</span><div>${esc(res.notes)}</div></div>` : "";
    if (!(res.sections || []).length || !(res.rows || []).length) return `${err}<div class="card"><div class="empty">${esc((res.warnings || [])[0] || "Uygun şarkı bulunamadı.")}</div></div>`;
    return `${err}${notes}<div class="card as-res"><div class="as-resh"><div class="minw0"><h3 class="ell" title="${esc(res.title || "Set")}">${esc(res.title || "Set")} ${src}</h3>
        <div class="muted small">${fmtN(s.n)} şarkı · ${fmtLong(s.dur)}${s.avg != null ? ` · ortalama geçiş <b>${Math.round(s.avg)}</b>` : ""}${s.weak ? ` · ${s.weak} zayıf geçiş` : ""}${res.curve ? ` · ${CURVE_TXT[res.curve] || ""} eğri` : ""}</div></div>
        <div class="as-resa"><button class="btn sm primary" data-assave="${id}" ${why ? "disabled" : ""} title="${esc(why || "Engine'e kaydet (Geri al ile geri alınır)")}">Kaydet…</button>
          <button class="btn sm" data-asimprove="${id}" title="Seçim aynı kalır; bölümlerin içi en iyi geçişlere göre dizilir">Geçişleri iyileştir</button></div></div>
      ${warns}${spark(res)}
      <table class="t v as-set" id="${id}"><colgroup><col data-w="2.4em"><col data-min="9em" data-flex="2"><col data-w="3.6em"><col data-w="6em" data-pri="3"><col data-w="4.2em" data-pri="2"><col data-w="4.4em"><col data-min="7em" data-flex="1.4" data-pri="1"><col data-w="3.2em"></colgroup>
      <thead><tr><th>#</th><th>Şarkı</th><th>Ton</th><th>BPM</th><th>Enerji</th><th title="Önceki şarkıdan geçiş puanı">Geçiş</th><th>${res.source === "ai" ? "Neden" : "Geçiş notu"}</th><th></th></tr></thead><tbody></tbody></table></div>`;
  }
  function setRowHtml(r) {
    if (r.sec != null) return `<tr class="as-sec"><td colspan="8"><b>${esc(r.sec)}</b> <span class="muted small">${r.n} şarkı · ${fmtLong(r.dur)}</span></td></tr>`;
    const t = r.tr;
    const note = r.why ? `<span class="why" title="${esc(r.why)}">${esc(r.why)}</span>` : t ? whyHtml(t) : `<span class="muted small">açılış</span>`;
    return `<tr><td class="c-idx">${r.idx}</td><td class="c-song" data-info="${r.id}"><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}${r.genre ? " · " + esc(r.genre) : ""}</div></td>
      <td>${camHtml(r.cam)}</td><td class="as-num">${bpmHtml(r, t ? t.bpm_pct : null, t ? t.tempo : "")}</td><td class="as-num">${enHtml(r, t ? t.de : 0)}</td>
      <td>${t ? scHtml(t.score, whyTitle(t)) : ""}</td><td class="as-why" title="${esc(r.why || (t ? whyTitle(t) : ""))}">${note}</td>
      <td class="c-act"><button class="play" data-play="${r.id}" title="Dinle">▶</button></td></tr>`;
  }
  function drawSet(id, res) {
    if (!$("#" + id)) return;
    vtSet(id, setRows(res), setRowHtml);
  }
  async function runBuild() {
    if (AS.busy) return;
    const b = AS.bp;
    busy("build", true);
    render();
    try {
      AS.build = await post("build", { minutes: +b.minutes || 60, curve: b.curve, genres: b.genres, seeds: b.seeds, only_ready: b.only_ready,
        bpm_start: +b.bpm_start || null, bpm_end: +b.bpm_end || null, exclude_list: b.exclude_list || null, title: "Set · " + (CURVE_TXT[b.curve] || "") });
      remember(AS.build.rows);
    } catch (e) { toast(e.message, "err"); }
    busy(null, false);
    render();
  }
  async function runAi() {
    if (AS.busy) return;
    const a = AS.ap;
    busy("ai", true);
    render();
    try {
      const r = await postAbortable("ai_build", { request: a.request, minutes: +a.minutes || 60, genres: a.genres.map((g) => (genres().find((x) => x.id === g) || {}).name || g), seeds: a.seeds, exclude_list: a.exclude_list || null });
      AS.ai = r;
      remember(r.rows);
    } catch (e) { if (e.name !== "AbortError") toast(e.message, "err"); }
    busy(null, false);
    render();
  }
  async function improve(id) {
    const key = id === "asbt" ? "build" : "ai";
    const res = AS[key];
    if (!res) return;
    try {
      const r = await post("improve", { sections: res.sections.map((s) => ({ name: s.name, ids: s.ids })) });
      const whys = {};
      (res.rows || []).forEach((x) => { if (x.why) whys[x.id] = x.why; });
      r.rows.forEach((x) => { if (whys[x.id]) x.why = whys[x.id]; });
      const before = res.summary && res.summary.avg;
      AS[key] = Object.assign({}, res, { sections: r.sections, rows: r.rows, transitions: r.transitions, summary: r.summary });
      toast((r.summary.avg || 0) > (before || 0) + .4 ? `Geçişler iyileşti: ortalama ${Math.round(before || 0)} → ${Math.round(r.summary.avg || 0)}` : "Sıra zaten en iyi geçişlerde.", "ok");
      render();
    } catch (e) { toast(e.message, "err"); }
  }

  // ---- 5) Listeyi sırala -----------------------------------------------------------------------------------
  function sortHtml() {
    const L = AS.lists;
    if (!L) return head("Listeyi sırala", "") + `<div class="body"><div class="empty">Yükleniyor…</div></div>`;
    if (!L.db) return head("Listeyi sırala", "") + `<div class="body"><div class="empty">Bu SSD'de Engine kütüphanesi yok.</div></div>`;
    const opts = (L.lists || []).filter((l) => !l.managed && l.n >= 3 && l.n <= 400);
    const sel = `<select class="search" id="assl"><option value="">Bir liste seç…</option>${opts.map((l) => `<option value="${l.id}" ${l.id === AS.sl ? "selected" : ""}>${esc(l.path.join(" / "))} (${l.n})</option>`).join("")}</select>`;
    const cv = `<select class="search as-scv" id="asscv" title="Enerji eğrisi (isteğe bağlı)"><option value="">Eğri yok</option>${Object.keys(CURVE_TXT).map((k) => `<option value="${k}" ${AS.scurve === k ? "selected" : ""}>${CURVE_TXT[k]}</option>`).join("")}</select>`;
    const sub = "Şarkılar aynı kalır; sıra en iyi geçişlere göre değişir. Geri al ile eski sıraya döner.";
    let body = "";
    const s = AS.sort;
    if (!AS.sl) body = `<div class="empty"><div class="big">⇅</div>Sıralamak istediğin Engine listesini seç.</div>`;
    else if (!s) body = `<div class="empty">Yükleniyor…</div>`;
    else if (s.error) body = `<div class="empty">${esc(s.error)}</div>`;
    else {
      const b = s.before.summary, a = s.after.summary, why = engineWhy();
      body = `<div class="card as-cmp"><div class="as-cmpn"><div><div class="muted small">Şimdiki sıra</div><b class="as-big">${b.avg != null ? Math.round(b.avg) : "—"}</b><div class="small muted">${b.weak || 0} zayıf geçiş</div></div>
          <div class="as-arrow">→</div><div><div class="muted small">Önerilen sıra</div><b class="as-big ok">${a.avg != null ? Math.round(a.avg) : "—"}</b><div class="small muted">${a.weak || 0} zayıf geçiş</div></div></div>
        <div class="as-resa">${s.same ? `<span class="tag ok">Liste zaten en iyi sırada</span>` : `<button class="btn primary" id="asapply" ${why ? "disabled" : ""} title="${esc(why)}">Bu listeye uygula</button>`}
          <button class="btn" id="assavenew" ${why ? "disabled" : ""} title="${esc(why)}">Yeni liste olarak kaydet</button></div>
        ${s.kept ? `<div class="small muted">${s.kept} şarkının dosyası bulunamadı; sonda kalır.</div>` : ""}</div>
        <table class="t v as-set" id="asst"><colgroup><col data-w="2.4em"><col data-w="3em" data-pri="1"><col data-min="9em" data-flex="2"><col data-w="3.6em"><col data-w="6em" data-pri="3"><col data-w="4.2em" data-pri="2"><col data-w="4.4em"><col data-min="7em" data-flex="1.2" data-pri="0"><col data-w="3.2em"></colgroup>
        <thead><tr><th>#</th><th title="Şimdiki sıradaki yeri">Eski</th><th>Şarkı</th><th>Ton</th><th>BPM</th><th>Enerji</th><th>Geçiş</th><th>Geçiş notu</th><th></th></tr></thead><tbody></tbody></table>`;
    }
    return head("Listeyi sırala", sub, `<div class="hacts as-sortsel">${sel}${cv}</div>`) + `<div class="body">${body}</div>`;
  }
  function sortRows() {
    const s = AS.sort;
    const old = {};
    s.before.rows.forEach((r, i) => { old[r.id] = i + 1; });
    return s.after.rows.map((r, i) => Object.assign({}, r, { idx: i + 1, old: old[r.id], tr: i > 0 ? s.after.transitions[i - 1] : null }));
  }
  function sortRowHtml(r) {
    const t = r.tr;
    return `<tr><td class="c-idx">${r.idx}</td><td class="c-idx muted">${r.old !== r.idx ? r.old : "="}</td><td class="c-song" data-info="${r.id}"><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}</div></td>
      <td>${camHtml(r.cam)}</td><td class="as-num">${bpmHtml(r, t ? t.bpm_pct : null, t ? t.tempo : "")}</td><td class="as-num">${enHtml(r, t ? t.de : 0)}</td>
      <td>${t ? scHtml(t.score, whyTitle(t)) : ""}</td><td class="as-why">${t ? whyHtml(t) : ""}</td><td class="c-act"><button class="play" data-play="${r.id}">▶</button></td></tr>`;
  }
  async function applySort() {
    const s = AS.sort;
    if (!s) return;
    try {
      await api("/api/assistant/apply_sort", { id: s.id, refs: s.refs });
      toast(`“${s.title}” sıralandı. Geri al ile eski sıraya döner.`, "ok");
    } catch (e) { toast(e.message, "err"); }
    await refresh(true);
  }

  // ---- kaydetme ----------------------------------------------------------------------------------------------
  function saveSource(src) {
    if (src === "chain") return { title: "Asistan zinciri", sections: [{ name: "Liste", ids: AS.chain.slice() }] };
    if (src === "sortnew") return { title: (AS.sort.title || "Liste") + " (sıralı)", sections: [{ name: "Liste", ids: AS.sort.after.rows.map((r) => r.id) }] };
    const res = src === "asbt" ? AS.build : AS.ai;
    return { title: res.title || "Asistan seti", sections: res.sections.map((s) => ({ name: s.name, ids: s.ids })) };
  }
  function saveDialog(src) {
    const why = engineWhy();
    if (why) { toast(why, "err"); return; }
    const d = saveSource(src);
    const multi = d.sections.length > 1;
    const today = localDay();
    const m = modal(`<div class="dh">Engine'e kaydet</div><div class="db">
      <label class="field"><span>Adı</span><input id="assvt" value="${esc(d.title)}"></label>
      <div class="opts"><label class="opt ${multi ? "" : "on"}"><input type="radio" name="assvk" value="list" ${multi ? "" : "checked"}><div><b>Liste</b><div class="muted small">Tek liste, ${d.sections.reduce((a, s) => a + s.ids.length, 0)} şarkı sırasıyla.</div></div></label>
        <label class="opt ${multi ? "on" : ""}"><input type="radio" name="assvk" value="event" ${multi ? "checked" : ""}><div><b>Etkinlik</b><div class="muted small">Etkinlikler altında${multi ? ` ${d.sections.length} bölümle` : ""}; tarih eklenebilir.</div>
          <input type="date" id="assvd" value="${today}" style="margin-top:6px"></div></label></div>
      <div class="muted small" style="margin-top:8px">Engine'de olmayan şarkılar koleksiyona bir kez eklenir. Geri al ile geri alınır.</div></div>
      <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn primary" data-x="yes">Kaydet</button></div>`);
    m.el.addEventListener("change", (e) => {
      if (e.target.name === "assvk") $$(".opt", m.el).forEach((o) => o.classList.toggle("on", o.querySelector("input").checked));
    });
    m.el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      if (b.dataset.x !== "yes") { m.close(); return; }
      const kind = ($("input[name=assvk]:checked", m.el) || {}).value || "list";
      const title = $("#assvt", m.el).value.trim() || d.title;
      b.disabled = true;
      try {
        const r = await api("/api/assistant/save", { kind, title, date: kind === "event" ? $("#assvd", m.el).value : null, sections: d.sections });
        m.close();
        S.cur = r.id;
        toast((kind === "event" ? `Etkinlik kaydedildi: Listeler'de “${title}”.` : `Liste kaydedildi: Listeler'de “${title}”.`) + (r.skipped ? ` ${r.skipped} şarkı eklenemedi.` : ""), "ok");
        await refresh();
      } catch (er) { b.disabled = false; toast(er.message, "err"); }
    });
  }

  // ---- şarkı arama (açılır) ------------------------------------------------------------------------------------
  let popFor = null, popTimer = 0;
  function closePop() { const p = $("#aspop"); if (p) p.remove(); popFor = null; }
  async function searchPop(anchor, q, onPick) {
    let p = $("#aspop");
    if (!q || q.trim().length < 2) { closePop(); return; }
    let rows = [];
    try { rows = await api("/api/assistant/search?q=" + encodeURIComponent(q) + "&limit=40"); } catch (e) { rows = []; }
    remember(rows);
    if (!anchor.isConnected) return;
    if (!p) { p = document.createElement("div"); p.id = "aspop"; p.className = "as-pop"; document.body.appendChild(p); }
    popFor = onPick;
    p.innerHTML = rows.length ? rows.map((r) => `<div class="res" data-aspp="${r.id}"><div class="meta"><div class="ttl">${esc(r.title)}</div><div class="art">${esc(r.artist || "—")}${r.genre ? " · " + esc(r.genre) : ""}</div></div>${camHtml(r.cam)}<span class="as-num small">${r.bpm ? Math.round(r.bpm) : ""}</span></div>`).join("")
      : `<div class="psh muted small">Bulunamadı.</div>`;
    DJD.popover(p, anchor);
  }
  function seedPicker(anchor, listKey) {
    const p = modal(`<div class="dh">Şarkı ekle</div><div class="db"><input class="search" id="asseedq" placeholder="Ad ya da sanatçı…" autocomplete="off"><div class="muted small" style="margin-top:6px">En az iki harf yaz.</div></div>
      <div class="df"><button class="btn" data-x="no">Kapat</button></div>`);
    const inp = $("#asseedq", p.el);
    inp.addEventListener("input", () => {
      clearTimeout(popTimer);
      popTimer = setTimeout(() => searchPop(inp, inp.value, (id) => {
        const lst = AS[listKey].seeds;
        if (!lst.includes(id)) lst.push(id);
        closePop();
        p.close();
        render();
      }), 180);
    });
    p.el.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) { closePop(); p.close(); } });
  }
  document.addEventListener("mousedown", (e) => {
    const p = $("#aspop");
    if (p && !e.target.closest("#aspop") && !e.target.closest("#asq, #asseedq")) closePop();
  });
  document.addEventListener("click", (e) => {
    const r = e.target.closest("#aspop [data-aspp]");
    if (r && popFor) { const f = popFor; f(+r.dataset.aspp); }
  });

  // ---- Ayarlar: yapay zekâ -----------------------------------------------------------------------------------
  function genreMenu(e, f, after) {
    const gs = genres();
    menu(e, [{ label: "Tüm türler", icon: f.genres.length ? "" : "✓", fn: () => { f.genres = []; after(); } }, "-",
      ...gs.map((g) => ({ label: g.name, color: g.color, note: (f.genres.includes(g.id) ? "✓ " : "") + fmtN(g.n), fn: () => {
        f.genres = f.genres.includes(g.id) ? f.genres.filter((x) => x !== g.id) : f.genres.concat([g.id]);
        after();
      } }))]);
  }

  // ---- olaylar -----------------------------------------------------------------------------------------------------
  document.addEventListener("click", async (e) => {
    if (S.tab !== "assistant" || !e.target.closest("#view .split.as, .as-pop")) return;
    const t = e.target;
    const nv = t.closest("[data-asv]");
    if (nv) { AS.view = nv.dataset.asv; save(); closePop(); await load(); return; }
    const pl = t.closest("[data-play]");
    if (pl) { playFid(+pl.dataset.play, pl); return; }
    const inf = t.closest("[data-ainfo]");
    if (inf) { openTrack(+inf.dataset.ainfo); return; }
    if (t.closest("[data-ascancel]")) { cancel(); return; }
    if (t.closest("[data-askey]")) { openAiSettings(); return; }
    if (t.closest("[data-asaiclose]")) { AS.aiNext = null; render(); return; }
    const sv = t.closest("[data-assave]");
    if (sv && !sv.disabled) { saveDialog(sv.dataset.assave); return; }
    const im = t.closest("[data-asimprove]");
    if (im) { improve(im.dataset.asimprove); return; }
    // 1) sonra ne
    const pk = t.closest("[data-aspick]");
    if (pk && !t.closest("button")) { await pick(pk.dataset.aspick); return; }
    const cu = t.closest("[data-ascur]");
    if (cu && !t.closest("button")) { AS.cur = +cu.dataset.ascur; AS.aiNext = null; await loadNext(); render(); return; }
    const dl = t.closest("[data-asdel]");
    if (dl) {
      const id = +dl.dataset.asdel;
      const i = AS.chain.indexOf(id);
      AS.chain = AS.chain.filter((x) => x !== id);
      if (AS.cur === id) AS.cur = AS.chain[Math.max(0, i - 1)] || null;
      await loadNext(true); render(); return;
    }
    if (t.id === "asclr") { AS.chain = AS.cur ? [AS.cur] : []; AS.chainScore = null; render(); return; }
    if (t.id === "asfix") { fixChain(); return; }
    if (t.id === "asainext") { askAiNext(); return; }
    if (t.id === "asng") { genreMenu(e, AS.nf, async () => { save(); await loadNext(); render(); }); return; }
    if (t.id === "asnr") { AS.nf.ready = !AS.nf.ready; save(); await loadNext(); render(); return; }
    const en = t.closest("[data-asen]");
    if (en) { AS.nf.energy = en.dataset.asen; save(); await loadNext(); render(); return; }
    // 2) çark
    const cam = t.closest("[data-ascam]");
    if (cam) { await loadKey(cam.dataset.ascam); render(); return; }
    if (t.id === "aswg") { genreMenu(e, AS.wf, async () => { await loadWheel(); render(); }); return; }
    if (t.id === "aswr") { AS.wf.ready = !AS.wf.ready; await loadWheel(); render(); return; }
    const go = t.closest("[data-asgo]");
    if (go) { AS.view = "next"; save(); await setCurrent(+go.dataset.asgo, !AS.chain.length); render(); return; }
    // 3) set kurucu / 4) yapay zekâ
    const cv = t.closest("[data-ascurve]");
    if (cv) { AS.bp.curve = cv.dataset.ascurve; save(); render(); return; }
    const bg = t.closest("[data-asbg]");
    if (bg) { const g = +bg.dataset.asbg; AS.bp.genres = AS.bp.genres.includes(g) ? AS.bp.genres.filter((x) => x !== g) : AS.bp.genres.concat([g]); save(); bg.classList.toggle("on"); return; }
    const ag = t.closest("[data-asag]");
    if (ag) { const g = +ag.dataset.asag; AS.ap.genres = AS.ap.genres.includes(g) ? AS.ap.genres.filter((x) => x !== g) : AS.ap.genres.concat([g]); save(); ag.classList.toggle("on"); return; }
    if (t.closest("#asbready")) { AS.bp.only_ready = !AS.bp.only_ready; save(); t.closest("#asbready").classList.toggle("on", AS.bp.only_ready); return; }
    const sx = t.closest("[data-asseedx]");
    if (sx) { const k = sx.dataset.for === "asbs" ? "bp" : "ap"; AS[k].seeds = AS[k].seeds.filter((x) => x !== +sx.dataset.asseedx); render(); return; }
    const sa = t.closest("[data-asseedadd]");
    if (sa) { seedPicker(sa, sa.dataset.asseedadd === "asbs" ? "bp" : "ap"); return; }
    if (t.id === "asbgo") { runBuild(); return; }
    if (t.id === "asago") { runAi(); return; }
    // 5) sırala
    if (t.id === "asapply" && !t.disabled) {
      const ok = await confirmBox("Listeyi sırala", `“${AS.sort.title}” yeni sıraya göre dizilecek. Şarkılar aynı kalır; Geri al ile eski sıraya döner.`, "Uygula");
      if (ok) applySort();
      return;
    }
    if (t.id === "assavenew" && !t.disabled) { saveDialog("sortnew"); }
  });
  document.addEventListener("input", (e) => {
    if (S.tab !== "assistant") return;
    const t = e.target;
    if (t.id === "asq") {
      clearTimeout(popTimer);
      popTimer = setTimeout(() => searchPop(t, t.value, async (id) => {
        closePop();
        t.value = "";
        await setCurrent(id, false);
        render();
      }), 180);
      return;
    }
    if (t.id === "asbmin") AS.bp.minutes = t.value;
    if (t.id === "asbb0") AS.bp.bpm_start = t.value;
    if (t.id === "asbb1") AS.bp.bpm_end = t.value;
    if (t.id === "asareq") AS.ap.request = t.value;
    if (t.id === "asamin") AS.ap.minutes = t.value;
    save();
  });
  document.addEventListener("keydown", (e) => {
    if (S.tab !== "assistant") return;
    if (e.key === "Escape" && $("#aspop")) { closePop(); e.preventDefault(); return; }
    if (e.key === "Enter" && e.target.id === "asq") {
      const f = $("#aspop [data-aspp]");
      if (f) { e.preventDefault(); f.click(); }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.id === "asareq") { e.preventDefault(); runAi(); }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-ascam]")) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  });
  document.addEventListener("change", async (e) => {
    if (S.tab !== "assistant") return;
    if (e.target.id === "assl") { AS.sl = +e.target.value || null; AS.sort = null; render(); await loadSort(); render(); }
    if (e.target.id === "asscv") { AS.scurve = e.target.value; if (AS.sl) { await loadSort(); render(); } }
    if (e.target.id === "asbx") { AS.bp.exclude_list = +e.target.value || null; save(); }
    if (e.target.id === "asax") { AS.ap.exclude_list = +e.target.value || null; save(); }
  });

  // ---- dışarıdan giriş: şarkı ayrıntısı, liste menüsü, Ayarlar -------------------------------------------------
  async function goAssistant(view, opts = {}) {
    AS.view = view;
    save();
    if (opts.cur) {                               // zincir kaybolmasın: şarkı zincirin sonuna eklenir (Temizle ile baştan)
      AS.cur = +opts.cur;
      if (!AS.chain.includes(AS.cur)) AS.chain.push(AS.cur);
      AS.aiNext = null; AS.next = null;
    }
    if (opts.sl) { AS.sl = +opts.sl; AS.sort = null; }
    S.tab = "assistant";
    try { localStorage.setItem("djd.tab", "assistant"); } catch (e) { /* */ }
    await refresh(true);
  }
  function openAiSettings() {
    settingsDialog();
    let n = 0;
    const t = setInterval(() => {                 // pencere sunucudan son işlemleri alınca çizilir
      const k = $("#aikey");
      if (k || ++n > 30) { clearInterval(t); if (k) { k.scrollIntoView({ block: "center" }); k.focus({ preventScroll: true }); } }
    }, 100);
  }

  DJD.tab({ key: "assistant", label: "Asistan", order: 40, load });
  DJD.trackAction({ label: "Sonra ne çalınır?", fn: (fid, d) => { if (d && d.file) remember([{ id: fid, title: d.file.title || d.file.name, artist: d.file.artist || "" }]); closeDrawer(); goAssistant("next", { cur: fid }); } });
  DJD.listMenu((it) => (it && !it.managed && (it.items || []).length >= 3 ? [{ label: "Harmonik sırala", icon: "⇅", fn: () => goAssistant("sort", { sl: it.id }) }] : []));
  DJD.settings({
    html: (st) => {
      const p = st.prefs || {};
      const ef = p.ai_effort || "medium";
      return `<div class="as-set-ai"><h4 style="margin:18px 0 6px">Yapay zekâ <span class="muted small">(isteğe bağlı · Asistan)</span></h4>
        <label class="field"><span>Anthropic API anahtarı</span><input type="password" id="aikey" autocomplete="off" spellcheck="false" placeholder="${esc(p.ai_key_set ? p.ai_key_mask + "  (kayıtlı)" : "sk-ant-…")}"></label>
        <div class="exrow"><button class="btn sm" id="aisave">Kaydet</button><button class="btn sm" id="aitest">Dene</button>${p.ai_key_set ? `<button class="btn sm danger" id="aidel">Anahtarı sil</button>` : ""}<span class="small muted minw0" id="aimsg">${p.ai_key_set ? "Anahtar kayıtlı." : "Anahtar yoksa çevrimdışı öneriler kullanılır."}</span></div>
        <div class="frow"><label class="field"><span>Düşünme</span><select id="aieffort">${[["low", "Hızlı"], ["medium", "Dengeli"], ["high", "Derin"]].map(([k, t]) => `<option value="${k}" ${ef === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          <label class="field"><span>Geçişte tempo farkı (%)</span><input type="number" id="mixbpm" min="1" max="20" step="1" value="${esc(p.mix_bpm_range || 6)}"></label></div>
        <details class="as-adv"><summary class="small muted">Gelişmiş</summary>
          <label class="field"><span>Model (değiştirmen gerekmez)</span><input id="aimodel" value="${esc(p.ai_model || "claude-opus-5-5")}" spellcheck="false"></label></details>
        <div class="muted small">Yalnızca şarkı adı, sanatçı, tür, BPM, ton ve süre gönderilir; dosya ya da yol gönderilmez.</div></div>`;
    },
    wire: (el) => {
      const msg = (t, bad) => { const m = $("#aimsg", el); if (m) { m.textContent = t; m.classList.toggle("as-bad", !!bad); } };
      const setp = async (kw) => { const np = await api("/api/prefs", kw); S.st.prefs = np; return np; };
      el.addEventListener("click", async (e) => {
        const id = e.target.id;
        if (id === "aisave") {
          const v = $("#aikey", el).value.trim();
          if (!v) { msg("Önce anahtarı yapıştır.", true); return; }
          const np = await setp({ ai_api_key: v });
          $("#aikey", el).value = "";
          $("#aikey", el).placeholder = np.ai_key_mask + "  (kayıtlı)";
          msg("Kaydedildi.");
        } else if (id === "aitest") {
          const v = $("#aikey", el).value.trim();
          msg("Deneniyor…");
          e.target.disabled = true;
          try {
            const r = await api("/api/ai/test", v ? { key: v } : {});
            if (r.ok) msg("✓ Çalışıyor" + (r.model ? " (" + r.model + ")" : "") + (v ? ". Kaydet'e basmayı unutma." : "."));
            else msg(r.error || "Çalışmadı.", true);
          } catch (er) { msg(er.message, true); }
          e.target.disabled = false;
        } else if (id === "aidel") {
          const np = await setp({ ai_api_key: "" });
          $("#aikey", el).placeholder = "sk-ant-…";
          e.target.remove();
          msg(np.ai_key_set ? "Ortam değişkenindeki anahtar kullanılıyor." : "Anahtar silindi.");
        }
      });
      el.addEventListener("change", async (e) => {
        const id = e.target.id;
        if (id === "aimodel") await setp({ ai_model: e.target.value.trim() || "claude-opus-5-5" });
        if (id === "aieffort") await setp({ ai_effort: e.target.value });
        if (id === "mixbpm") { const n = Math.max(1, Math.min(20, +e.target.value || 6)); e.target.value = n; await setp({ mix_bpm_range: n }); }
      });
    },
  });
})();
