# DJ Doktor

Mobil DJ'ler için müzik kütüphanesi düzenleyici: **Denon Prime 4 / Engine DJ** (Windows) ve **Serato DJ Pro** (Mac)
aynı harici SSD'yi (exFAT) kullanırken çıkan sorunları çözer ve düğün/etkinlik listelerini doğrudan Engine'de hazırlatır.

- Her şarkının SSD'de **tek bir evi** olur: `Müzik/<Tür>` (Halay, Horon, Ankara, Roman, Türkçe Pop…).
- Engine DJ listeleri **doğrudan** düzenlenir (gönder/al yok); istenen listeler Serato crate'i olarak iki yönlü eşitlenir.
- İndirilen şarkı: `Müzik/DJ Gelen/<Tür>` → kontrol → SSD `Müzik/<Tür>` → Engine'de bir kez, "Analiz bekleyenler" → arşiv.
- Kopyalar tek kopyaya iner (not/cue/ton bilgisi korunur), bozuk Engine yolları kendiliğinden onarılır.
- **Hiçbir dosya silinmez** (karantina), her değişiklikten önce yedek alınır, her işlem tek tıkla geri alınır.
- **Araçlar** (ileri kullanım): sağlık kontrolü ve tek tıkla düzeltmeler, tam kütüphane tablosu, rekordbox XML / M3U8 /
  CSV dışa aktarma, etkinlik önerileri ve etkinlik öncesi kontrol, şarkı ayrıntısı (cue'lar, uyumlu şarkılar).

## Çalıştırma

Python 3.8+ gerekir (başlatıcı yoksa kurmayı önerir). Program yerel bir web arayüzü açar (`http://127.0.0.1:8770`).

- Windows: `Baslat_Windows.bat`
- Mac: `Baslat_Mac.command`
- Elle: `python baslat.py [--port 8770] [--no-browser]`

Kullanıcı kılavuzu: [`BENIOKU.html`](BENIOKU.html). Paket üretmek: `python tools/package.py` (→ `dist/DJ_Doktor_vX.Y.Z.zip`).

## Geliştirme

Mimari, veri biçimleri, güvenlik kuralları, testler, bilinen sorunlar ve yapılacaklar: [`CLAUDE.md`](CLAUDE.md).

```bash
python3 -B tests/test_v2.py                 # arka uç uçtan uca testler (pytest gerekmez)
DJD_TEST_BASE=/mnt/exfat python3 -B tests/test_v2.py   # aynı testler gerçek bir exFAT diskte
python3 -B tests/ui_smoke.py /tmp/ekranlar  # arayüz testi (Playwright + Chromium)
python3 -B tests/bench_big.py               # hız ölçümü: ~5.000 dosyalık sahte SSD
```

Sürümler: ilk sürüm v1.0 = commit `d908bb4` (raporlar, ad düzeltme, dışa aktarımlar); sonrası v2.x sade yeniden tasarım
(v2.0.0 `1f20c1c`, v2.0.1 `0774cd9`, v2.0.2 `7296205`); v2.1.0: hız düzeltmeleri + v1 özellikleri (Araçlar).

## Lisans notu

`vendor/mutagen` (etiket okuma) GPL-2.0-or-later lisanslıdır; lisans metni `vendor/mutagen/COPYING.txt` içindedir.
