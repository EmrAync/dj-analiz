# SahneCAD — sahne, ses, ışık, elektrik ve kablo planlama

Etkinlik sahnesini **2D plan + 3D + bağlantı şeması** olarak çiz. Hoparlörden mikrofona, davuldan
moving head'e kadar her şeyi yerleştir. Kabloları port port bağla. Program her kablonun tipini ve
boyunu, elektrik yükünü ve ses dağılımını hesaplar. Sonunda sahneyi hiç bilmeyen birinin kurabileceği
**adım adım kurulum talimatını** (Türkçe / Almanca / İngilizce) çıkarır.

![Plan](docs/plan.jpg)

## Hemen kullan

- **`SahneCAD.html` dosyasına çift tıkla.** İnternet gerekmez. Chrome, Edge veya Safari'de açılır.
- Projeler tarayıcıda otomatik saklanır. Başka bir bilgisayara taşımak için
  **Dosya → Proje dosyası indir (.json)**, diğer bilgisayarda **Proje dosyası aç**.
- İlk açılışta hazır bir örnek gelir: 250 kişilik düğün salonu (DJ, kablosuz mikrofon, ışık, elektrik).
  **Sihirbaz** ile kendi etkinliğini saniyeler içinde kurabilirsin.

## Neler var?

| Ekran | Ne işe yarar |
|---|---|
| **Plan** | Ölçekli kuşbakışı çizim. Salon, sahne podesti, dans pisti, masalar, kaçış yolları. Duvarlara mesafeler, kablo etiketleri (Cisco gibi: `A-012 · XLR 10m`), hoparlör kapsama alanı, **ses basıncı ısı haritası**. Mekan krokisi resim olarak altına konabilir. |
| **3D** | Her cihazın 3D modeli: hoparlör standları, line array açıları, sub, monitör, Prime 4, mikser, davul seti, moving head, truss, masa ve sandalyeler. Kamera: genel / üstten / salondan / sahneden / FOH. 3D'de taşı, yükselt, döndür. |
| **Bağlantı şeması** | Sinyal akışı blok şeması: cihazlar portlarıyla, kablolar etiketiyle. **Porttan porta sürükleyerek bağla.** Elektrik şeması (faz, watt, amper). Tüm bölümler birlikte gösterilebilir. |
| **Listeler** | Malzeme listesi (standlar, ara direk, kum torbası, podest, kablo köprüsü, gaffa otomatik eklenir), kablo listesi, **kablo paketi** (hangi boydan kaç kablo + yedek), **input listesi**, elektrik devreleri. CSV (Excel) ve yazdırma. |
| **Analiz** | Ortalama/maksimum dB, dağılım, oda yankısı (RT60), kritik mesafe, delay önerileri, sıcaklığa göre ses hızı, rüzgar ve komşu ses sınırı, faz yükleri, öneriler. |
| **Kurulum** | Kurulumu yapacak kişi için adım adım talimat. Her adım işaretlenebilir. Talimat başka dilde yazdırılabilir (yardımcı ekip için Almanca). |

Diğer özellikler:

- **150'ye yakın malzeme**: aktif/pasif hoparlör, sub, line array (QSC, RCF, JBL, EV, Yamaha, dB, HK,
  d&b, L-Acoustics), monitör, IEM, mikserler (X32, Wing, SQ-6, Qu-16, TF5, DM3, Ui24R, analog),
  stagebox, amfi, DSP, DI, DJ (Denon Prime 4, SC6000, X1850, Pioneer CDJ-3000, DJM-900NXS2/A9, XDJ-XZ,
  Technics), mikrofonlar (kablolu ve kablosuz), **enstrümanlar** (davul seti, davul, zurna, klarnet,
  bağlama, ud, kanun, keman, kemençe, darbuka, def, tulum, org, piyano, gitar/bas ve amfileri),
  ışık (moving head, PAR, uplight, strob, hazer, soğuk kıvılcım, yer bulutu), truss/motor, LED ekran,
  projeksiyon, elektrik (Schuko, CEE 16/32/63 A, jeneratör, dağıtıcılar, grup priz, PRCD, UPS),
  ağ, sahne/dekor (podest, gelin–damat koltuğu, pasta masası, çiçek kemeri, yuvarlak masa) ve mekan
  (sütun, kapı, acil çıkış).
- **Kendi malzemen**: "Yeni malzeme" veya bir modeli "Özelleştir" ile ölçü, güç, hoparlör verisi ve
  portlarını düzenle. **İstediğin cihaza kendi resmini yükle**; ikon yerine planda, şemada, 3D'de ve
  talimatta görünür. Kendi malzemelerin "Kütüphanem"de tüm projelerde kalır.
- **Kablo tipleri**: XLR, TRS, TS, RCA, 3,5 mm, multikor, speakON (2,5/4 mm², NL8), AES/EBU, Cat6/etherCON,
  fiber, DMX 3/5 pin, HDMI, SDI, USB, MIDI, Schuko, powerCON, TRUE1, IEC, CEE 16/32/63, Powerlock, kablosuz.
  Konnektör uyumu, yanlış tip (örn. mikrofon kablosu ile DMX), çıkış→çıkış hataları denetlenir.
- **Otomatik kablolama**: sinyali (mikrofon → alıcı → mikser → sub → tepe, stagebox, monitörler) ve
  elektriği (en yakın boş priz, uzaktaki cihaza otomatik grup priz, fazları dengeleme, devre kapasitesi)
  tek tıkla bağlar; sonra elle düzeltirsin.
- **Kontroller**: aşırı yük, faz dengesizliği, gerilim düşümü, hoparlör hattı kaybı, kaçış yolundan
  geçen kablo (kablo köprüsü), geri besleme riski (mikrofon hoparlör önünde), seyirci içinde alçak
  hoparlör, power alley, yankı, sis makinesi/yangın alarmı, rüzgar, yağmur, komşu ses sınırı…
- **Bölümler**: salon, bahçe, kına odası gibi ayrı çizimler. Bölümler arası kablolar ve **hazırlık
  noktaları** ("bağlantı noktası", "harici sistem") ile başka bir ekip / bölüm / sonraki program için
  hazırlık yapılır.
- **Ekibe göre görünüm**: Ses ekibi, elektrikçi, ışıkçı, görüntü… Her biri sadece kendi kablolarını görür.
- **Kurulumcu modu**: Dosya menüsünden kilitli, salt okunur mod. Kurulumu yapacak kişiye ver.
- **Dışa aktarma**: AutoCAD (DXF), SVG, PNG, 3D PNG, CSV, proje dosyası (JSON), yazdırma.
- **Dil**: Türkçe, Deutsch, English. Açık ve koyu tema. Telefonda da açılır.
- Geri al / yinele, kopyala / yapıştır (başka bölüme de), ayna kopya (sol↔sağ), kilitle, gizle.

| | |
|---|---|
| ![3D](docs/3d.jpg) | ![Şema](docs/sema.jpg) |
| ![Isı haritası](docs/isi-haritasi.jpg) | ![Kurulum](docs/kurulum.jpg) |
| ![Listeler](docs/listeler.jpg) | ![Sihirbaz](docs/sihirbaz.jpg) |

## Önemli

- Akustik ve elektrik değerleri **tahminidir** (yansımalar ve gerçek ölçüm hariç). Marka/model verileri
  yaklaşıktır; gerekirse "Özelleştir" ile üretici föyüne göre düzelt.
- 400 V / CEE bağlantılarını **elektrik yetkilisi**, asma (rigging) işlerini **yetkili rigger** yapmalı.

## Geliştirme

```bash
npm install
npm run dev          # http://localhost:5180
npm test             # hesap motoru testleri
npm run build        # dist/ (çok dosyalı)
npm run release      # SahneCAD.html (tek dosya, çift tıkla aç)
npx vite preview --port 4173 &   # sonra:
npm run test:ui      # Playwright ile tıklama testleri
```

Teknoloji: React 18 + TypeScript + Vite, Three.js (react-three-fiber), zustand + immer.
Ayrıntılar ve mimari: [CLAUDE.md](CLAUDE.md).
