/* DJ Doktor eklentisi: Adlar (Araçlar > Adlar) — toplu ad sadeleştirme ve kayıp yolları bağlama.
 * Sunucu: /api/renamer/... (djdoktor/renamer.py, relink.py). app.js yardımcıları: api, task, toast, modal, menu,
 * confirmBox, vtSet, esc, fmtN, fold, refresh, undo, openTrack. */
"use strict";
(function () {
  const RN = {
    mode: "names", preset: "engine_safe", rules: null, scope: { kind: "all" }, targets: "both",
    info: null, plan: null, excl: new Set(), force: new Set(), flt: "all", q: "", adv: false,
    lk: null, lsel: null, picks: {}, lflt: "all", err: null,
  };
  try {
    const sv = JSON.parse(localStorage.getItem("djd.rn") || "{}");
    if (sv.targets) RN.targets = sv.targets;
    if (sv.mode) RN.mode = sv.mode;
  } catch (e) { /* tarayıcı depolaması yok */ }
  const save = () => { try { localStorage.setItem("djd.rn", JSON.stringify({ targets: RN.targets, mode: RN.mode })); } catch (e) { /* */ } };

  const CONF = {
    exists: "Aynı adda var", twin: "İki ad aynı oluyor", same_audio: "Aynı şarkı zaten var (kopya)",
    empty: "Ad boş kalıyor", gone: "Diskte yok — önce tara", genre_twin: "Aynı adda tür var",
  };
  const WARN = { non_ascii: "Başka alfabe / sembol kaldı", too_long: "Yol çok uzun", long: "Ad kısaltıldı" };
  const FIXABLE = new Set(["exists", "twin", "same_audio"]);
  const CONF_TXT = { kesin: "kesin", yuksek: "yüksek", orta: "orta" };
  const METH = { gecmis: "program geçmişi", ses_imzasi: "ses imzası", ad_sade: "aynı ad (harf farkı)",
    klasor_adi: "klasör adı değişmiş", ad_boyut: "aynı ad ve boyut" };

  // --- değişen harfleri işaretle (en uzun ortak alt dizi; uzun adlarda baş/son karşılaştırması) -------------
  const DIFF = new Map();
  function diff(a, b) {
    const k = a + "\u0000" + b;
    if (DIFF.has(k)) return DIFF.get(k);
    const A = Array.from(a), B = Array.from(b);
    let oa, ob;
    if (A.length * B.length > 90000) {
      let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
      let s = 0; while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
      oa = A.map((_, i) => i >= p && i < A.length - s); ob = B.map((_, i) => i >= p && i < B.length - s);
    } else {
      const n = A.length, m = B.length, L = new Uint16Array((n + 1) * (m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
        L[i * (m + 1) + j] = A[i] === B[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
      oa = A.map(() => true); ob = B.map(() => true);
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (A[i] === B[j]) { oa[i] = ob[j] = false; i++; j++; } else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) i++; else j++;
      }
    }
    const mark = (arr, f, cls) => {
      let h = "", run = "", on = false;
      const flush = () => { if (run) h += on ? `<mark class="${cls}">${esc(run)}</mark>` : esc(run); run = ""; };
      arr.forEach((c, i) => { if (f[i] !== on) { flush(); on = f[i]; } run += c; });
      flush();
      return h;
    };
    const r = [mark(A, oa, "rn-del"), mark(B, ob, "rn-ins")];
    if (DIFF.size > 4000) DIFF.clear();
    DIFF.set(k, r);
    return r;
  }

  // --- veri ------------------------------------------------------------------------------------------
  function body() {
    const b = { preset: RN.preset, scope: RN.scope, targets: RN.targets };
    if (RN.rules) b.rules = RN.rules;
    return b;
  }
  async function loadPlan(reset) {
    RN.err = null;
    try { RN.plan = await api("/api/renamer/plan", body()); } catch (e) { RN.plan = null; RN.err = e.message; }
    if (reset || !RN.plan) { RN.excl = new Set(); RN.force = new Set(); return; }
    // ekran kendiliğinden yenilendiğinde (arka plan taraması vb.) kullanıcının seçimleri kalsın
    const ids = new Set(RN.plan.items.map((x) => x.id));
    RN.excl = new Set([...RN.excl].filter((i) => ids.has(i)));
    RN.force = new Set([...RN.force].filter((i) => ids.has(i)));
  }
  async function load() {
    if (!RN.info) { try { RN.info = await api("/api/renamer/presets"); } catch (e) { RN.info = { presets: [], genres: [] }; } }
    if (RN.mode === "links") {
      if (!RN.lk) { try { RN.lk = await api("/api/renamer/relink"); } catch (e) { RN.err = e.message; } lselDefault(); }
    } else await loadPlan();
    return RN;
  }
  function lselDefault() {
    RN.lsel = new Set(((RN.lk && RN.lk.items) || []).filter((x) => x.status === "found" && x.confidence === "kesin" && !x.declined).map((x) => x.key));
    RN.picks = {};
  }

  // --- görünüm ---------------------------------------------------------------------------------------
  function headHtml() {
    const lc = RN.lk && RN.lk.counts ? RN.lk.counts.found + RN.lk.counts.ambiguous : 0;
    return `<div class="head"><div class="minw0" style="flex:1"><h2>Adlar</h2>
      <div class="sub ell">${RN.mode === "links" ? "Finder / Explorer'da adı değişen şarkıları Engine ve Serato'ya yeniden bağla."
        : "Adı değişen şarkının Engine, Serato ve listelerdeki kaydı da birlikte güncellenir."}</div></div>
      <div class="rn-seg" role="tablist"><button class="${RN.mode === "names" ? "on" : ""}" data-rnmode="names"><span>Adları düzelt</span></button>
      <button class="${RN.mode === "links" ? "on" : ""}" data-rnmode="links"><span>Kayıp yollar</span>${lc ? `<span class="badge">${fmtN(lc)}</span>` : ""}</button></div></div>`;
  }

  function scopeLabel() {
    const s = RN.scope || { kind: "all" };
    if (s.kind === "genre") { const g = ((RN.info && RN.info.genres) || []).find((x) => String(x.id) === String(s.gid)); return "Tür: " + (g ? g.name : "?"); }
    if (s.kind === "folder") return "Klasör: " + (s.label || s.rel);
    return "Tüm SSD";
  }

  function rulesHtml() {
    const r = (RN.plan && RN.plan.rules) || {};
    const ck = (k, t) => `<label class="rn-ck"><input type="checkbox" data-rnrule="${k}" ${r[k] ? "checked" : ""}> ${t}</label>`;
    const rep = (r.replace && r.replace[0]) || { find: "", to: "", regex: false };
    return `<div class="rn-adv">
      ${ck("turkish_ascii", "Türkçe harfler → ASCII")}${ck("accents", "Diğer aksanlar")}${ck("strip_emoji", "Emoji")}
      ${ck("noise", "(Official Video) gibi ekler")}${ck("spaces", "Fazla boşluk")}${ck("underscores", "Alt çizgi → boşluk")}
      ${ck("trim", "Baş/son kırp")}${ck("ext_lower", "Uzantı küçük harf")}
      <label class="rn-ck">Harf: <select data-rncase>${[["none", "olduğu gibi"], ["title", "Baş Harfler Büyük"], ["upper", "BÜYÜK"], ["lower", "küçük"]]
        .map(([k, t]) => `<option value="${k}" ${r.case === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <div class="rn-rep"><input id="rnfind" placeholder="Bul" value="${esc(rep.find)}"><span class="muted">→</span><input id="rnto" placeholder="Değiştir" value="${esc(rep.to)}">
        <label class="rn-ck"><input type="checkbox" id="rnrx" ${rep.regex ? "checked" : ""}> düzenli ifade</label><button class="btn sm" data-rnrep="1">Uygula</button></div>
      <div class="muted small">Etiketlere (dosyanın içine) dokunulmaz; Engine'deki başlık ve Serato'daki şarkı adı aynen kalır.</div></div>`;
  }

  function namesHtml() {
    const P = RN.plan;
    const presets = ((RN.info && RN.info.presets) || []);
    const pbtn = presets.map((p, i) => `<button class="btn ${i === 0 ? "big" : ""} ${RN.preset === p.key && !RN.rules ? "primary" : ""}" data-rnpreset="${p.key}" title="${esc(p.hint)}"><span>${esc(p.title)}</span></button>`).join("");
    const tg = [["files", "Dosyalar"], ["dirs", "Klasörler"], ["both", "İkisi"]].map(([k, t]) => `<button class="chip ${RN.targets === k ? "on" : ""}" data-rntg="${k}">${t}</button>`).join("");
    let main = "";
    if (RN.err) main = `<div class="hint"><span class="ic">⚠</span><div>${esc(RN.err)}</div></div>`;
    else if (!P) main = `<div class="empty">Yükleniyor…</div>`;
    else {
      const c = P.counts;
      const blocked = P.blocked ? `<div class="hint"><span class="ic">🔒</span><div><b>${P.blocked === "engine_open" ? "Engine DJ açık." : "Serato açık."}</b> Kapatınca uygulayabilirsin (açıkken yazılan değişikliği o program ezebilir).</div></div>` : "";
      const n = selCount();
      const f = [["all", "Hepsi", c.total], ["conflict", "Çakışma", c.conflicts], ["warn", "Uyarı", c.warnings], ["dir", "Klasörler", c.dirs]]
        .filter(([k, _t, v]) => k === "all" || v).map(([k, t, v]) => `<button class="chip ${RN.flt === k ? "on" : ""}" data-rnflt="${k}">${t} ${fmtN(v)}</button>`).join("");
      main = `${blocked}
        <div class="card rn-sum"><div class="rn-sumt minw0"><b id="rnsel">${fmtN(n)}</b> ad değişecek <span class="muted">(${fmtN(c.files)} dosya, ${fmtN(c.dirs)} klasör)</span>
          <div class="muted small ell" title="Engine ve Serato'daki kayıtlar yeni yolu gösterecek">Engine ${fmtN(c.engine_refs)} · Serato ${fmtN(c.serato_refs)} kayıt birlikte güncellenecek${c.conflicts ? ` · <span class="rn-bad">${fmtN(c.conflicts)} çakışma atlanacak</span>` : ""}</div></div>
          <button class="btn primary big" id="rnapply" ${!n || P.blocked ? "disabled" : ""}>Uygula</button></div>
        ${c.total ? `<div class="rn-bar"><div class="chips rn-flt">${f}</div><input class="search rn-q" id="rnq" placeholder="Ara" value="${esc(RN.q)}"></div>
        <table class="t v rn-t" id="rntab"><colgroup><col data-w="2.4em"><col data-w="2.6em"><col data-flex="1" data-min="9em" data-w="18em"><col data-w="1.4em"><col data-flex="1" data-min="9em" data-w="18em"><col data-w="11em" data-min="7em" data-pri="2"><col data-w="7.5em" data-pri="1"></colgroup>
          <thead><tr><th class="c-chk"><input type="checkbox" id="rnall" title="Hepsini seç"></th><th></th><th>Şimdi</th><th></th><th>Yeni ad</th><th>Durum</th><th class="r">Kayıt</th></tr></thead><tbody></tbody></table>`
        : `<div class="empty"><div class="big">✓</div>Bu kapsamda değişecek ad yok.</div>`}`;
    }
    return `${headHtml()}<div class="body">
      <div class="card rn-top"><div class="rn-presets">${pbtn}</div>
        <div class="rn-row"><span class="rn-grp"><span class="muted small">Nerede:</span><button class="chip on rn-scope" data-rnscope="1" title="Kapsamı değiştir">${esc(scopeLabel())} ▾</button></span>
          <span class="rn-grp"><span class="muted small">Ne:</span><span class="chips rn-inl">${tg}</span></span>
          <button class="btn sm ghost" data-rnadv="1">${RN.adv ? "Kurallar ▴" : "Kurallar ▾"}</button></div>
        ${RN.adv ? rulesHtml() : ""}</div>
      ${main}</div>`;
  }

  function rows() {
    const P = RN.plan;
    if (!P) return [];
    const q = fold(RN.q.trim());
    return P.items.filter((x) => (RN.flt === "all" || (RN.flt === "dir" ? x.kind === "dir" : x.status === RN.flt))
      && (!q || fold(x.rel + " " + x.new).includes(q)));
  }
  const isOn = (x) => x.status === "conflict" ? RN.force.has(x.id) : !RN.excl.has(x.id);
  function selCount() { return RN.plan ? RN.plan.items.filter(isOn).length : 0; }

  function rowHtml(x) {
    const [o, n] = diff(x.old, x.new);
    const par = x.rel.includes("/") ? x.rel.slice(0, x.rel.lastIndexOf("/")) : "";
    const dis = x.status === "conflict" && !FIXABLE.has(x.conflict);
    let st;
    if (x.status === "conflict") st = `<span class="tag bad" title="${esc(x.with || "")}">${esc(CONF[x.conflict] || x.conflict)}</span>`;
    else if (x.status === "warn") st = `<span class="tag warn">${esc(x.warn.map((w) => WARN[w] || w).join(", "))}</span>`;
    else st = `<span class="tag ok">hazır</span>`;
    const refs = (x.engine ? `E ${fmtN(x.engine)}` : "") + (x.engine && x.serato ? " · " : "") + (x.serato ? `S ${fmtN(x.serato)}` : "");
    return `<tr data-rnid="${esc(x.id)}" class="${isOn(x) ? "" : "rn-off"}"><td class="c-chk"><input type="checkbox" data-rnck="${esc(x.id)}" ${isOn(x) ? "checked" : ""} ${dis ? "disabled" : ""}></td>
      <td class="muted" title="${x.kind === "dir" ? "Klasör (" + fmtN(x.files) + " dosya)" : "Dosya"}">${x.kind === "dir" ? "📁" : "♪"}</td>
      <td><div class="ttl" title="${esc(x.rel)}">${o}</div><div class="art">${esc(par)}</div></td><td class="muted">→</td>
      <td><div class="ttl" title="${esc(x.new_rel)}">${n}</div><div class="art">${x.status === "conflict" && x.with ? esc(x.with) : esc((x.reasons || []).map((r) => (RN.info && RN.info.reasons && RN.info.reasons[r]) || r).join(", "))}</div></td>
      <td>${st}</td><td class="r small muted" title="Engine / Serato'da güncellenecek kayıt">${refs}</td></tr>`;
  }

  function linksHtml() {
    const L = RN.lk;
    let main;
    if (RN.err) main = `<div class="hint"><span class="ic">⚠</span><div>${esc(RN.err)}</div></div>`;
    else if (!L) main = `<div class="empty">Yükleniyor…</div>`;
    else {
      const c = L.counts;
      const nsel = lselCount();
      const onlyKesin = nsel && [...RN.lsel].every((k) => { const x = L.items.find((y) => y.key === k); return x && x.confidence === "kesin"; }) && !Object.keys(RN.picks).length;
      const blocked = L.blocked ? `<div class="hint"><span class="ic">🔒</span><div><b>${L.blocked === "engine_open" ? "Engine DJ açık." : "Serato açık."}</b> Kapatınca bağlayabilirsin.</div></div>` : "";
      const folders = (L.folders || []).length ? `<div class="card rn-folders"><b>Adı değişmiş klasörler</b>${L.folders.map((f) => `<div class="small ell">${esc(f.old)} → <b>${esc(f.new)}</b>${f.genre ? ' <span class="tag blue">tür</span>' : ""}${f.music_root ? ' <span class="tag blue">ana klasör</span>' : ""}</div>`).join("")}</div>` : "";
      const nonEng = L.items.filter((x) => x.status === "none" && x.src === "engine");
      const f = [["all", "Hepsi", L.items.length], ["found", "Bulundu", c.found], ["ambiguous", "Birden çok aday", c.ambiguous], ["none", "Bulunamadı", c.none]]
        .filter(([k, _t, v]) => k === "all" || v).map(([k, t, v]) => `<button class="chip ${RN.lflt === k ? "on" : ""}" data-rnlf="${k}">${t} ${fmtN(v)}</button>`).join("");
      main = `${blocked}<div class="card rn-sum"><div class="rn-sumt minw0">${L.items.length ? `<b>${fmtN(c.found)}</b> kayıp kaydın dosyası bulundu <span class="muted">(Engine ${fmtN(c.engine)}, Serato ${fmtN(c.serato)} kayıp)</span>
          <div class="muted small ell">Bağlarken önce yedek alınır; tek tıkla Geri al.</div>` : `<b>Kayıp yol yok.</b> <div class="muted small">Engine ve Serato'daki bütün kayıtlar diskteki dosyayı buluyor.</div>`}</div>
          <button class="btn" id="rnscan" title="Önce SSD'yi tarar, sonra arar">↻ Tara ve bul</button>
          ${L.items.length ? `<button class="btn primary big" id="rnlink" ${!nsel || L.blocked ? "disabled" : ""}>${onlyKesin ? "Kesin olanları bağla" : "Seçilenleri bağla"} (${fmtN(nsel)})</button>` : ""}</div>
        ${folders}
        ${L.items.length ? `<div class="rn-bar"><div class="chips rn-flt">${f}</div><button class="btn sm" id="rnlhigh" style="display:none" title="Adı aynı, ama boyut / süre kanıtı yok">Yüksek güvenlileri de seç</button>${nonEng.length ? `<button class="btn sm danger" id="rnrm" title="Dosyası hiçbir yerde bulunamayan Engine kayıtları (yedek alınır, geri alınabilir)">Bulunamayan ${fmtN(nonEng.length)} Engine kaydını kaldır</button>` : ""}</div>
        <table class="t v rn-t" id="rnltab"><colgroup><col data-w="2.4em"><col data-w="5.8em" data-min="4.6em"><col data-flex="1" data-min="9em" data-w="18em"><col data-w="1.4em"><col data-flex="1" data-min="9em" data-w="18em"><col data-w="9.5em" data-min="6em" data-pri="2"></colgroup>
          <thead><tr><th class="c-chk"><input type="checkbox" id="rnlall" title="Bulunanların hepsini seç"></th><th></th><th>Kayıtta</th><th></th><th>Diskte</th><th>Güven</th></tr></thead><tbody></tbody></table>` : ""}`;
    }
    return `${headHtml()}<div class="body">${main}</div>`;
  }
  function lrows() {
    const L = RN.lk;
    if (!L) return [];
    return L.items.filter((x) => RN.lflt === "all" || x.status === RN.lflt);
  }
  const splitRel = (p) => { const i = String(p || "").lastIndexOf("/"); return i < 0 ? ["", String(p || "")] : [p.slice(0, i), p.slice(i + 1)]; };
  const selectable = (x) => x.status === "found" && !x.declined;
  function lselCount() { return RN.lsel ? RN.lsel.size + Object.keys(RN.picks).filter((k) => !RN.lsel.has(k)).length : 0; }
  function lrowHtml(x) {
    const pick = RN.picks[x.key];
    const cand = pick ? (x.candidates || []).find((c) => c.fid === pick) : null;
    const nw = cand ? cand.rel : x.new;
    const on = RN.lsel.has(x.key) || !!pick;
    const can = x.status === "found" || !!pick;
    // satır 1: dosya adı (değişen harfler işaretli), satır 2: sol tarafta nerede kullanıldığı, sağda yeni klasör
    const [od, oname] = splitRel(x.old);
    const who = x.src === "engine" && x.title ? x.title + (x.artist ? " — " + x.artist : "") : "";
    const sub = [who, (x.where || []).map((w) => w === "database V2" ? "koleksiyon" : w).join(" · ")].filter(Boolean).join(" · ") || od;
    let right;
    if (x.status === "ambiguous" && !pick) right = `<button class="btn sm" data-rnpick="${esc(x.key)}">${fmtN(x.candidates.length)} aday — seç ▾</button>`;
    else if (!nw) right = `<span class="muted">bulunamadı</span>`;
    else {
      const [nd, nname] = splitRel(nw);
      right = `<div class="ttl" title="${esc(nw)}">${diff(oname, nname)[1]}</div><div class="art" title="${esc(nw)}">${nd ? diff(od, nd)[1] : "&nbsp;"}</div>`;
    }
    const conf = pick ? `<span class="tag blue">seçildi</span>` : x.declined && !on ? `<span class="tag" title="Bu bağlamayı geri aldın; kendiliğinden yeniden yapılmaz.">geri alındı</span>` : x.confidence ? `<span class="tag ${x.confidence === "kesin" ? "ok" : x.confidence === "yuksek" ? "blue" : "warn"}" title="${esc(METH[x.method] || "")}">${CONF_TXT[x.confidence]}</span><span class="muted small"> ${esc(METH[x.method] || "")}</span>` : "";
    return `<tr data-rnkey="${esc(x.key)}" class="${on ? "" : "rn-off"}"><td class="c-chk"><input type="checkbox" data-rnlk="${esc(x.key)}" ${on ? "checked" : ""} ${can ? "" : "disabled"}></td>
      <td><span class="tag ${x.src === "engine" ? "blue" : ""}">${x.src === "engine" ? "Engine" : "Serato"}</span></td>
      <td><div class="ttl" title="${esc(x.old)}">${esc(oname)}</div><div class="art" title="${esc(x.old + (sub !== od ? "\n" + sub : ""))}">${esc(sub)}</div></td>
      <td class="muted">→</td><td>${right}</td><td>${conf}</td></tr>`;
  }

  function html() { return RN.mode === "links" ? linksHtml() : namesHtml(); }

  // --- olaylar ---------------------------------------------------------------------------------------
  function redraw() {
    if (RN.mode === "links") { if ($("#rnltab")) vtSet("rnltab", lrows(), lrowHtml); }
    else if ($("#rntab")) vtSet("rntab", rows(), rowHtml);
  }
  function rerender() { S.tdata = RN; renderTools(); }
  let timer = 0;
  function replanSoon() { clearTimeout(timer); timer = setTimeout(async () => { await loadPlan(true); rerender(); }, 180); }

  function syncNames() {
    const n = selCount();
    const el = $("#rnsel"); if (el) el.textContent = fmtN(n);
    const b = $("#rnapply"); if (b) b.disabled = !n || !!(RN.plan && RN.plan.blocked);
    $$("#rntab tbody tr[data-rnid]").forEach((tr) => {
      const x = RN.plan.items.find((y) => y.id === tr.dataset.rnid);
      if (!x) return;
      tr.classList.toggle("rn-off", !isOn(x));
      const c = tr.querySelector("input[data-rnck]"); if (c) c.checked = isOn(x);
    });
    const all = $("#rnall"); if (all) { const r = rows().filter((x) => x.status !== "conflict"); all.checked = !!r.length && r.every(isOn); }
  }
  function syncLinks() {
    const n = lselCount();
    const b = $("#rnlink");
    if (b) {
      const kes = [...RN.lsel].every((k) => { const x = RN.lk.items.find((y) => y.key === k); return x && x.confidence === "kesin"; }) && !Object.keys(RN.picks).length;
      b.textContent = `${kes ? "Kesin olanları bağla" : "Seçilenleri bağla"} (${fmtN(n)})`;
      b.disabled = !n || !!RN.lk.blocked;
    }
    const all = $("#rnlall");
    if (all) { const r = lrows().filter(selectable); all.checked = !!r.length && r.every((x) => RN.lsel.has(x.key)); }
    const hi = $("#rnlhigh");
    if (hi) {
      const n2 = RN.lk.items.filter((x) => selectable(x) && x.confidence === "yuksek" && !RN.lsel.has(x.key)).length;
      hi.style.display = n2 ? "" : "none";
      hi.textContent = `Yüksek güvenlileri de seç (${fmtN(n2)})`;
    }
    $$("#rnltab tbody tr[data-rnkey]").forEach((tr) => {
      const on = RN.lsel.has(tr.dataset.rnkey) || !!RN.picks[tr.dataset.rnkey];
      tr.classList.toggle("rn-off", !on);
      const c = tr.querySelector("input[data-rnlk]"); if (c) c.checked = on;
    });
  }

  function doneToast(msg, extra) {
    const el = document.createElement("div");
    el.className = "toast ok";
    el.innerHTML = `<div>${esc(msg)}${extra ? `<div class="small">${esc(extra)}</div>` : ""}</div><button class="btn sm" data-u="1">↶ Geri al</button><button aria-label="Kapat">✕</button>`;
    $("#toasts").appendChild(el);
    const kill = () => el.remove();
    el.querySelector("[aria-label]").onclick = kill;
    el.querySelector("[data-u]").onclick = async () => { kill(); await undo(); };
    setTimeout(kill, 12000);
  }

  async function applyNames() {
    const P = RN.plan;
    if (!P) return;
    const b = Object.assign(body(), { token: P.token, exclude: [...RN.excl], force: [...RN.force] });
    let r;
    try { r = await task("/api/renamer/apply", b); } catch (e) {
      if (e.code === "stale") { await loadPlan(true); rerender(); }
      return;
    }
    if (!r || !(r.files || r.dirs)) { toast("Değişen ad olmadı."); await refresh(true); return; }
    const ex = [];
    if (r.engine || r.serato) ex.push(`Engine ${fmtN(r.engine)}, Serato ${fmtN(r.serato)} kayıt güncellendi.`);
    if (r.skipped && r.skipped.length) ex.push(`${fmtN(r.skipped.length)} ad atlandı (aynı adda dosya var).`);
    doneToast(`${fmtN((r.files || 0) + (r.dirs || 0))} ad değişti.`, ex.join(" "));
    if (r.engine_clash && r.engine_clash.length) toast(`${fmtN(r.engine_clash.length)} şarkının Engine'de ikinci bir kaydı var. Müzikler > Kopyalar'dan birleştirebilirsin.`, "err");
    await refresh(true);
  }

  async function applyLinks() {
    const L = RN.lk;
    const picks = {};
    Object.entries(RN.picks).forEach(([k, v]) => { picks[k] = v; });
    let r;
    try { r = await task("/api/renamer/relink/apply", { token: L.token, keys: [...RN.lsel], picks }); } catch (e) {
      if (e.code === "stale") { RN.lk = null; await refresh(true); }
      return;
    }
    const n = (r.engine || 0) + (r.engine_merged || 0) + (r.serato || 0);
    if (!n && !r.folders) { toast("Bağlanacak kayıt olmadı."); } else {
      doneToast(`Yollar bağlandı: Engine ${fmtN((r.engine || 0) + (r.engine_merged || 0))}, Serato ${fmtN(r.serato || 0)} kayıt.`,
        r.folders ? `${fmtN(r.folders)} tür / klasör kaydı yeni yere geçti.` : "");
    }
    RN.lk = null;
    await refresh(true);
  }

  async function scanLinks() {
    let r;
    try { r = await task("/api/renamer/relink/scan", {}); } catch (e) { return; }
    RN.lk = r; lselDefault();
    S.tdata = RN; renderTools();
  }

  function scopeMenu(e) {
    const gs = (RN.info && RN.info.genres) || [];
    const items = [{ label: "Tüm SSD", icon: "▦", fn: () => { RN.scope = { kind: "all" }; replanSoon(); } }];
    if (gs.length) items.push("-", { label: "Bir tür", head: true }, ...gs.map((g) => ({ label: g.name, color: g.color, fn: () => { RN.scope = { kind: "genre", gid: g.id }; replanSoon(); } })));
    const fs = (RN.info && RN.info.folders) || [];
    if (fs.length) items.push("-", { label: "Bir klasör", head: true }, ...fs.map((f) => ({ label: f.label.split("/").pop(), icon: "📁", depth: f.depth, title: f.label,
      fn: () => { RN.scope = { kind: "folder", rel: f.rel, label: f.label }; replanSoon(); } })));
    items.push("-", { label: "Başka bir klasör…", icon: "…", fn: async () => {
      const rel = await promptBox("Klasör", "SSD'deki klasör yolu (ör. Müzik/Halay)", (RN.scope.kind === "folder" ? RN.scope.rel : (RN.info && RN.info.music_root) || ""), "Seç");
      if (rel) { RN.scope = { kind: "folder", rel, label: rel }; replanSoon(); }
    } });
    menu(e, items);
  }

  function pickMenu(e, key) {
    const x = RN.lk.items.find((y) => y.key === key);
    if (!x) return;
    menu(e, [{ label: "Hangi dosya?", head: true }, ...(x.candidates || []).map((c) => ({ label: c.rel, icon: "♪", fn: () => { RN.picks[key] = c.fid; RN.lsel.delete(key); redraw(); syncLinks(); } })),
      ...(RN.picks[key] ? ["-", { label: "Seçimi kaldır", icon: "✕", fn: () => { delete RN.picks[key]; redraw(); syncLinks(); } }] : [])]);
  }

  function setRule(k, v) {
    RN.rules = Object.assign({}, (RN.plan && RN.plan.rules) || {}, RN.rules || {}, { [k]: v });
    replanSoon();
  }

  function after() {
    const root = $("#tmain");
    if (!root) return;
    redraw();
    if (RN.mode === "names") syncNames(); else if (RN.lk) syncLinks();
    root.addEventListener("click", async (e) => {
      const t = e.target;
      const md = t.closest("[data-rnmode]");
      if (md) { RN.mode = md.dataset.rnmode; save(); RN.err = null; await load(); rerender(); return; }
      const pr = t.closest("[data-rnpreset]");
      if (pr) { RN.preset = pr.dataset.rnpreset; RN.rules = null; await loadPlan(true); rerender(); return; }
      const tg = t.closest("[data-rntg]");
      if (tg) { RN.targets = tg.dataset.rntg; save(); await loadPlan(true); rerender(); return; }
      if (t.closest("[data-rnscope]")) { scopeMenu(e); return; }
      if (t.closest("[data-rnadv]")) { RN.adv = !RN.adv; rerender(); return; }
      if (t.closest("[data-rnrep]")) {
        const find = ($("#rnfind") || {}).value || "", to = ($("#rnto") || {}).value || "", rx = !!($("#rnrx") || {}).checked;
        setRule("replace", find ? [{ find, to, regex: rx }] : []);
        return;
      }
      const fl = t.closest("[data-rnflt]");
      if (fl) { RN.flt = fl.dataset.rnflt; $$("[data-rnflt]").forEach((c) => c.classList.toggle("on", c === fl)); redraw(); syncNames(); return; }
      const lf = t.closest("[data-rnlf]");
      if (lf) { RN.lflt = lf.dataset.rnlf; $$("[data-rnlf]").forEach((c) => c.classList.toggle("on", c === lf)); redraw(); syncLinks(); return; }
      if (t.id === "rnapply") { await applyNames(); return; }
      if (t.id === "rnlink") { await applyLinks(); return; }
      if (t.id === "rnscan") { await scanLinks(); return; }
      if (t.id === "rnrm") {
        const tids = RN.lk.items.filter((x) => x.status === "none" && x.src === "engine" && x.db === "drive").map((x) => x.tid);
        if (tids.length && await confirmBox("Engine'den kaldır", `Dosyası bulunamayan ${fmtN(tids.length)} kayıt Engine koleksiyonundan ve listelerden kalkacak. Önce yedek alınır; Geri al ile döner.`, "Kaldır", true)) {
          try { const r = await task("/api/health/missing", { tids }); toast(`${fmtN(r.removed)} kayıt Engine'den kaldırıldı.`, "ok"); } catch (er) { /* bildirildi */ }
          RN.lk = null; await refresh(true);
        }
        return;
      }
      const pk = t.closest("[data-rnpick]");
      if (pk) { pickMenu(e, pk.dataset.rnpick); return; }
      if (t.id === "rnlall") {
        lrows().filter(selectable).forEach((x) => { if (t.checked) RN.lsel.add(x.key); else RN.lsel.delete(x.key); });
        syncLinks();
        return;
      }
      if (t.id === "rnlhigh") {
        RN.lk.items.filter((x) => selectable(x) && x.confidence === "yuksek").forEach((x) => RN.lsel.add(x.key));
        syncLinks();
        return;
      }
      if (t.id === "rnall") {
        const on = t.checked;
        rows().forEach((x) => { if (x.status !== "conflict") { if (on) RN.excl.delete(x.id); else RN.excl.add(x.id); } });
        syncNames();
        return;
      }
      const ck = t.closest("input[data-rnck]");
      if (ck) {
        const x = RN.plan.items.find((y) => y.id === ck.dataset.rnck);
        if (!x) return;
        if (x.status === "conflict") { if (ck.checked) RN.force.add(x.id); else RN.force.delete(x.id); }
        else if (ck.checked) RN.excl.delete(x.id); else RN.excl.add(x.id);
        syncNames();
        return;
      }
      const lk = t.closest("input[data-rnlk]");
      if (lk) {
        const k = lk.dataset.rnlk;
        if (lk.checked) RN.lsel.add(k); else { RN.lsel.delete(k); delete RN.picks[k]; }
        syncLinks();
      }
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches("[data-rnrule]")) { setRule(t.dataset.rnrule, t.checked); return; }
      if (t.matches("[data-rncase]")) setRule("case", t.value);
    });
    root.addEventListener("input", (e) => {
      if (e.target.id === "rnq") { RN.q = e.target.value; clearTimeout(RN._qt); RN._qt = setTimeout(() => { redraw(); syncNames(); }, 140); }
    });
    root.addEventListener("keydown", (e) => {
      if ((e.target.id === "rnfind" || e.target.id === "rnto") && e.key === "Enter") { e.preventDefault(); const b = root.querySelector("[data-rnrep]"); if (b) b.click(); }
    });
  }

  DJD.toolView({ key: "names", icon: "Aa", title: "Adlar", order: 15, width: "", load, html, after });

  // Araçlar'a git (Sağlık kartlarından, şarkı ayrıntısından)
  async function go(mode, preset, rules) {
    RN.mode = mode; save();
    if (preset) { RN.preset = preset; RN.rules = rules || null; RN.scope = { kind: "all" }; RN.targets = "both"; RN.excl = new Set(); RN.force = new Set(); }
    if (mode === "links") RN.lk = null;
    S.tab = "tools"; S.tview = "names";
    try { localStorage.setItem("djd.tab", "tools"); localStorage.setItem("djd.tview", "names"); } catch (e) { /* */ }
    await refresh(true);
  }
  DJD.healthAction("rename", "Adları düzelt", () => go("names", "only_illegal"));
  DJD.healthAction("rename_emoji", "Emojileri temizle", () => go("names", "only_illegal", { strip_emoji: true }));
  DJD.healthAction("missing", "Bul ve bağla", () => go("links"));

  // --- şarkı ayrıntısı: tek şarkının adını değiştir ---------------------------------------------------------
  async function renameOne(fid, d) {
    const f = d.file || {};
    const name = String(f.name || "");
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    const m = modal(`<div class="dh">Adını değiştir</div><div class="db">
      <label class="field"><span>Yeni ad</span><div class="rn-one"><input id="rnone" value="${esc(stem)}"><span class="muted">${esc(ext)}</span></div></label>
      <div class="muted small" id="rnonepv">Engine, Serato ve listelerdeki kayıtlar yeni adı gösterir.</div></div>
      <div class="df"><button class="btn" data-x="no">Vazgeç</button><button class="btn primary" data-x="yes" disabled>Değiştir</button></div>`);
    const inp = $("#rnone", m.el), pv = $("#rnonepv", m.el), ok = m.el.querySelector("[data-x=yes]");
    let tm = 0, seq = 0;
    const preview = () => {
      clearTimeout(tm);
      tm = setTimeout(async () => {
        const my = ++seq;
        const v = inp.value.trim();
        if (!v || v === stem) { ok.disabled = true; pv.textContent = "Engine, Serato ve listelerdeki kayıtlar yeni adı gösterir."; return; }
        try {
          const r = await api("/api/renamer/one", { kind: "file", id: fid, name: v + ext, dry_run: true });
          if (my !== seq) return;
          const where = [...new Set((r.serato || []).flatMap((s) => s.where || []))].filter((w) => w !== "database V2").slice(0, 6);
          pv.innerHTML = `<b>${esc(r.new)}</b><br>Engine ${fmtN(r.counts.engine)} · Serato ${fmtN(r.counts.serato)} kayıt güncellenecek${where.length ? `<div class="ell" title="${esc(where.join(", "))}">${esc(where.join(" · "))}</div>` : ""}`;
          ok.disabled = r.unchanged;
        } catch (e) { if (my === seq) { pv.innerHTML = `<span class="rn-bad">${esc(e.message)}</span>`; ok.disabled = true; } }
      }, 220);
    };
    inp.addEventListener("input", preview);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !ok.disabled) ok.click(); });
    m.el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      if (b.dataset.x === "no") { m.close(); return; }
      if (ok.disabled) return;
      m.close();
      try {
        const r = await task("/api/renamer/one", { kind: "file", id: fid, name: inp.value.trim() + ext });
        doneToast("Ad değişti: " + r.new, r.engine || r.serato ? `Engine ${fmtN(r.engine)}, Serato ${fmtN(r.serato)} kayıt güncellendi.` : "");
      } catch (er) { return; }
      await refresh(true);
      openTrack(fid);
    });
  }
  DJD.trackAction({ label: "✎ Adını değiştir", fn: (fid, d) => renameOne(fid, d) });

  window.DJD_RN = RN;   // testler için
})();
