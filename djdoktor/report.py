"""Tek dosyalık HTML 'Doktor Raporu' (yazdırılabilir, paylaşılabilir)."""
from __future__ import annotations

import datetime as _dt
import html
import os

from . import names, util
from .resolver import WORKS_ON

MATCH_TR = {
    "exact": "Doğru yol", "case": "Büyük/küçük harf farkı", "unicode": "Türkçe harf biçimi farkı (NFD)",
    "sfm": "Mac'e özel karakter", "missing": "Dosya yok", "nodir": "Klasör bu diskte yok", "outside": "Kök dışında",
}


def build(lib):
    from . import sync
    e = html.escape
    info = lib.info()
    iss = lib.issues()
    st = iss["stats"]
    dupes = lib.dupes()
    eng = sync.engine_status(lib)
    ser = sync.serato_status(lib)
    findings = []
    for d in eng:
        c = d["counts"]
        bad = c.get("unicode", 0) + c.get("sfm", 0)
        if bad:
            findings.append(("kritik", "Prime 4'te %d parça kırmızı/bulunamaz görünür (%s)" % (bad, d["label"]),
                             "%d parçanın yolu Mac'in ayrık Türkçe harf biçiminde, %d parçanınki Mac'e özel karakter içeriyor. "
                             "Mac bunları açar; Prime 4 (Linux) ve Windows açamaz. 'Engine yol onarımı' tek tıkla düzeltir "
                             "(müzik dosyalarına dokunmaz, önce yedek alır)." % (c.get("unicode", 0), c.get("sfm", 0))))
        if c.get("missing", 0):
            findings.append(("uyari", "Engine kütüphanesinde %d parçanın dosyası yok" % c["missing"],
                             "Dosyalar taşınmış/silinmiş olabilir."))
    if ser:
        it = ser["items"]
        bad = it.get("unicode", 0) + it.get("sfm", 0)
        if bad:
            findings.append(("uyari", "Serato crate'lerinde %d kayıt sadece Mac'te çalışır" % bad,
                             "Engine DJ Windows'ta Serato listelerini içe aktarırken bu parçaları bulamaz. Bu programın "
                             "Engine senkronu doğru yolu yazdığı için sorun ortadan kalkar."))
        if it.get("nodir", 0) or it.get("missing", 0):
            findings.append(("bilgi", "Serato crate'lerinde %d kayıt bu klasörde bulunmayan dosyaları gösteriyor"
                             % (it.get("nodir", 0) + it.get("missing", 0)),
                             "Başlıca klasörler: " + ", ".join("%s (%d)" % (names.display(k), v) for k, v in ser["missing_tops"][:6])))
    nd = {g["kind"]: 0 for g in dupes}
    for g in dupes:
        nd[g["kind"]] += 1
    if dupes:
        extra = sum(len(g["members"]) - 1 for g in dupes if g["kind"] in ("exact", "audio"))
        findings.append(("uyari", "%d çift grubu bulundu" % len(dupes),
                         "Birebir aynı: %d grup, aynı ses farklı etiket: %d grup, muhtemelen aynı şarkı: %d grup. "
                         "Gereksiz kopya sayısı: %d." % (nd.get("exact", 0), nd.get("audio", 0), nd.get("song", 0), extra)))
    for it in iss["items"]:
        if it["code"] in ("junk_appledouble", "name_badchar", "name_trailing", "audio_error", "fmt_engine"):
            findings.append((it["severity"], "%s: %d" % (it["title"], it["count"]), it["desc"]))
    sev_color = {"kritik": "#d93025", "uyari": "#e8a100", "bilgi": "#4a7bd1"}
    sev_tr = {"kritik": "KRİTİK", "uyari": "UYARI", "bilgi": "BİLGİ"}
    f_html = "".join('<div class="f"><span class="b" style="background:%s">%s</span><b>%s</b><p>%s</p></div>'
                     % (sev_color[s], sev_tr[s], e(t), e(d)) for s, t, d in findings) or "<p>Önemli bir sorun bulunmadı. 🎉</p>"
    i_rows = "".join("<tr><td><span class='b' style='background:%s'>%s</span></td><td>%s</td><td>%d</td><td>%s</td><td>%s</td></tr>"
                     % (sev_color[i["severity"]], sev_tr[i["severity"]], e(i["title"]), i["count"], e(i["desc"]),
                        e(i["fix"])) for i in iss["items"])
    e_html = ""
    for d in eng:
        rows = "".join("<tr><td>%s</td><td>%d</td><td>%s</td></tr>" % (e(MATCH_TR.get(k, k)), v, e(WORKS_ON.get(k, "")))
                       for k, v in sorted(d["counts"].items(), key=lambda x: -x[1]))
        samples = "".join("<li>%s</li>" % e(s["path"]) for s in (d["samples"].get("unicode", []) + d["samples"].get("sfm", []))[:12])
        e_html += ("<h3>%s</h3><p class='m'>Şema %s · %s</p><table><tr><th>Durum</th><th>Parça</th><th>Çalıştığı yer</th></tr>%s</table>"
                   % (e(d["label"]), e(str(d["info"].get("schema", ""))), e(d["path"]), rows))
        if samples:
            e_html += "<p>Örnek sorunlu yollar:</p><ul class='s'>%s</ul>" % samples
    s_html = ""
    if ser:
        rows = "".join("<tr><td>%s</td><td>%d</td><td>%s</td></tr>" % (e(MATCH_TR.get(k, k)), v, e(WORKS_ON.get(k, "")))
                       for k, v in sorted(ser["items"].items(), key=lambda x: -x[1]))
        s_html = ("<p class='m'>%d crate · veritabanında %d parça · yol biçimi: %s</p>"
                  "<table><tr><th>Crate kayıtları</th><th>Adet</th><th>Çalıştığı yer</th></tr>%s</table>"
                  % (len(ser["crates"]), sum(ser["tracks"].values()), "Mac" if ser["info"].get("dialect") == "mac" else "Windows", rows))
    d_rows = ""
    for g in dupes[:40]:
        kind = {"exact": "Birebir aynı", "audio": "Aynı ses, farklı etiket", "song": "Muhtemelen aynı şarkı"}[g["kind"]]
        mem = "".join("<li class='%s'>%s%s <i>%s</i></li>" % ("k" if m["keeper"] else "", "✔ " if m["keeper"] else "",
                                                               e(names.display(m["rel"])), e(", ".join(m["reasons"][:3])))
                      for m in g["members"])
        d_rows += "<div class='g'><b>%s</b><ul>%s</ul></div>" % (kind, mem)
    fm = ", ".join("%s: %d" % (k or "?", v) for k, v in sorted(st["formats"].items(), key=lambda x: -x[1]))
    return """<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Doktor Raporu - %s</title><style>
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:1050px;margin:24px auto;padding:0 16px;color:#1d1d1f;line-height:1.45}
h1{margin-bottom:2px} .m{color:#666;margin:2px 0 10px} h2{margin-top:34px;border-bottom:2px solid #222;padding-bottom:4px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.c{border:1px solid #ddd;border-radius:10px;padding:10px 12px} .c b{font-size:22px;display:block}
.f{border-left:4px solid #ddd;padding:6px 12px;margin:10px 0;background:#fafafa} .f p{margin:4px 0 0;color:#333}
.b{display:inline-block;color:#fff;font-size:11px;font-weight:700;border-radius:4px;padding:1px 6px;margin-right:8px}
table{border-collapse:collapse;width:100%%;font-size:13px;margin:6px 0} td,th{border-bottom:1px solid #e5e5e5;padding:5px 6px;text-align:left;vertical-align:top}
.g{border:1px solid #e5e5e5;border-radius:8px;padding:6px 10px;margin:6px 0;font-size:13px} .g ul{margin:4px 0;padding-left:18px}
.g li.k{font-weight:600} .g i{color:#777;font-weight:400} ul.s{font-size:12px;color:#444}
ol li{margin:6px 0}
</style></head><body>
<h1>DJ Kütüphane Doktoru — Rapor</h1>
<p class="m">%s · %s · dosya sistemi: %s · %s</p>
<div class="cards">
<div class="c"><b>%d</b>ses dosyası</div><div class="c"><b>%s</b>toplam boyut</div>
<div class="c"><b>%s</b>toplam süre</div><div class="c"><b>%d</b>kendi notunuz olan</div>
<div class="c"><b>%d</b>Mixed In Key bilgili</div><div class="c"><b>%d</b>Serato cue'lu</div>
<div class="c"><b>%d</b>çift grubu</div><div class="c"><b>%d</b>çöp dosya</div>
</div><p class="m">Biçimler: %s</p>
<h2>En önemli bulgular</h2>%s
<h2>Önerilen sıra</h2><ol>
<li><b>Önce masaüstündeki kopyada deneyin.</b> Salt-okunur modu sadece kopya kütüphanesinde kapatıp düzeltmeleri orada uygulayın, sonucu kontrol edin.</li>
<li><b>Engine yol onarımı</b> — Prime 4'te kırmızı görünen parçaları düzeltir (sadece Engine veritabanı değişir, yedekli).</li>
<li><b>Güvenli ad düzeltme</b> — Mac'e özel karakterli klasör/dosya adlarını düzeltir; Serato ve Engine yolları birlikte güncellenir.</li>
<li><b>Çöp dosyaları karantinaya taşı</b> — '._' dosyaları silinmez, karantina klasörüne taşınır.</li>
<li><b>Çiftleri birleştir</b> — her grupta notu/cue'su olan kopyayı tutun; diğerleri karantinaya gider, listeler asıl kopyaya yönlenir.</li>
<li><b>Etkinlik listelerini</b> bu programda hazırlayıp <b>Engine'e gönderin</b>; gerekiyorsa Serato'ya da crate olarak yazın.</li>
<li>Her etkinlikten önce <b>Gig öncesi kontrol</b> çalıştırın.</li></ol>
<h2>Tüm sorunlar</h2><table><tr><th>Önem</th><th>Sorun</th><th>Adet</th><th>Açıklama</th><th>Çözüm</th></tr>%s</table>
<h2>Engine DJ</h2>%s
<h2>Serato DJ</h2>%s
<h2>Çiftler (ilk 40 grup)</h2><p class="m">✔ işaretli olan önerilen (tutulacak) kopyadır.</p>%s
<p class="m" style="margin-top:40px">Bu rapor dosyalarınızı yalnızca OKUYARAK oluşturuldu. %s</p>
</body></html>""" % (
        e(info["name"]), e(info["name"]), e(info["root"]), e(info["fstype"] or "?"),
        _dt.datetime.now().strftime("%d.%m.%Y %H:%M"),
        st["audio"], util.human_size(st["size"]), util.fmt_dur(st["duration"]) or "0", st["with_note"], st["with_mik"],
        st["with_cues"], len(dupes), st["junk"], e(fm), f_html, i_rows, e_html or "<p>Diskte Engine kütüphanesi yok.</p>",
        s_html or "<p>Diskte _Serato_ klasörü yok.</p>", d_rows or "<p>Çift bulunmadı.</p>",
        _dt.datetime.now().strftime("%d.%m.%Y %H:%M"))


def save(lib):
    out = os.path.join(lib.settings.ws, "raporlar", "doktor_raporu_%s_%s.html" % (lib.id, util.stamp()))
    util.atomic_write_text(out, build(lib))
    return out
