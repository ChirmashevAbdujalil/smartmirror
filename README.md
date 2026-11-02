# Smart Mirror — aqlli ko'zgu platformasi

> "O'zingizning uslubingiz — endi yanada oson!"

Do'konlar uchun aqlli ko'zgu: xaridor ko'zgu oldida turadi, ekrandan kiyim tanlaydi va kiyim
kamera orqali **uning tanasiga real vaqtda "kiydiriladi"**. Kiyinish xonasiga borish shart emas.

## Slaydlar tahlili → platformada nima qilingan

| Slayddagi g'oya | Platformada |
|---|---|
| Soat, ob-havo (10:24, ☀ 24°C) | Yuqori panelda soat va ob-havo (Open-Meteo, 13 ta shahar) |
| O'ngda kiyimlar ustuni, pastda **Kiyimlar / Sevimlilar / Boshqa** | Xuddi shu tuzilma, sensorli ekranga moslangan |
| AI orqali bir nechta kiyimni o'zingizda kiygan holda ko'rish | Kamera + MediaPipe Pose (brauzer ichida ishlaydi) — kiyim yelka va songa moslashadi; ustki/ichki/past qatlamlar birga kiyiladi |
| **Qulaylik:** Turi/uslublar, O'lcham tanlash, Ranglar, Tavsiyalar | 4 ta filtr tugmasi; o'lcham bo'yicha ombordagi mavjudlik; tavsiyalar (mos juftlik, ob-havo, ommabop) |
| **Vaqt tejalishi:** ~30 daqiqa → 2 daqiqa | Sessiya hisoblagichi: nechta kiyim, qancha vaqt, taxminiy tejalgan vaqt |
| **Iqtisodiy foyda** do'kon uchun | Do'kon paneli: katalog, ombor, statistika (eng ko'p sinab ko'rilgan kiyimlar, sessiyalar) |
| **Kelajakdagi reja:** savdo markazlari → oddiy do'konlar | Har bir do'kon o'z katalogini yuklaydi (PNG rasm yoki avtomatik tasvir), JSON eksport/import |

## Ishga tushirish

Hech qanday o'rnatish talab qilinmaydi — oddiy statik sayt.

```bash
python3 -m http.server 8000
```

So'ng brauzerda oching:

- Ko'zgu: `http://localhost:8000/` (kamerasiz sinash uchun: `/?camera=0`)
- Do'kon paneli: `http://localhost:8000/admin.html`

Kamera faqat `localhost` yoki `https://` orqali ishlaydi. AI modeli birinchi marta internetdan yuklanadi
(jsDelivr va Google Storage); internet yoki kamera bo'lmasa, kiyimlar **manekin** ustida ko'rsatiladi.

## Tuzilma

```
index.html        Ko'zgu (kiosk) interfeysi
admin.html        Do'kon paneli
css/mirror.css    Ko'zgu dizayni (vertikal ekran uchun, gorizontalga ham moslashadi)
css/admin.css     Panel dizayni
js/app.js         Ko'zgu mantig'i: tanlash, filtrlar, tavsiyalar, sevimlilar, sessiya, kutish rejimi
js/tryon.js       Kamera + tana nuqtalarini aniqlash + kiyimni tanaga joylash (affin o'zgartirish)
js/garments.js    Kiyim tasvirlari (SVG generator) va yuklangan PNG'lar uchun joylashuv
js/catalog.js     Katalog, sevimlilar, statistika, sozlamalar (localStorage)
js/weather.js     Ob-havo
```

### Kiyib ko'rish qanday ishlaydi

1. Kamera tasviri ko'zgudek teskari ko'rsatiladi.
2. MediaPipe Pose Landmarker har kadrda yelka va son nuqtalarini topadi (qurilmaning o'zida, hech qayerga yuborilmaydi).
3. Har bir kiyim 200×360 "tana ramkasi"da chizilgan: yelkalar `(56,40)–(144,40)`, son o'rtasi `(100,160)`.
   Bu ramka topilgan nuqtalarga affin matritsa bilan joylanadi — odam yaqinlashsa, uzoqlashsa yoki egilsa kiyim ham moslashadi.
4. Qatlamlar tartibi: past (shim/yubka) → ichki (bluzka/futbolka) yoki ko'ylak → ustki (pidjak/kurtka).

Do'kon o'z kiyimini qo'shganda **shaffof fonli PNG** yuklaydi; rasm kiyim turiga mos joyga avtomatik qo'yiladi.

## Uskunalar (prototip uchun)

- Vertikal ekran yoki televizor (43–55″), ustiga **ikki tomonlama ko'zgu oynasi** (two-way mirror) — ekran o'chiq joylar haqiqiy ko'zgudek ko'rinadi
- Sensorli ramka (IR touch frame) yoki sensorli ekran
- Full HD veb-kamera (ekran tepasida, ko'z darajasida)
- Mini-kompyuter (Intel N100 / Ryzen mini-PC yoki shunga o'xshash), Chrome kiosk rejimi:
  `chrome --kiosk --use-fake-ui-for-media-stream http://localhost:8000/`
- LED yoritgich (slayddagi pushti ramka) — yuzni yaxshi yoritish aniqlikni oshiradi

## Rivojlantirish rejasi

1. **MVP (shu repozitoriy)** — 2D kiyib ko'rish, katalog, filtrlar, tavsiyalar, statistika. Ko'rgazma va pilot uchun yetarli.
2. **Server va bir nechta ko'zgu** — markaziy backend (masalan, Node/Python + PostgreSQL), do'kon tarmog'i uchun yagona katalog, kassa/omborga ulash.
3. **Generativ AI kiyib ko'rish** — "Rasmga olish"dan so'ng surat GPU serverga yuboriladi va diffuziya asosidagi
   virtual try-on modeli (ochiq kodli VTON tadqiqot modellari yoki tijoriy API) fotorealistik natija qaytaradi (~5–15 soniya).
   Tijoriy foydalanishdan oldin model litsenziyasini tekshirish shart — ko'plari faqat notijorat maqsadlarga ruxsat beradi.
4. **Telefon bilan bog'lash** — QR kod orqali tanlangan obraz va suratni xaridor telefoniga yuborish, onlayn buyurtma.
5. **Tana o'lchamini taxminlash** — kamera orqali o'lchamni tavsiya qilish (S/M/L).

## Maxfiylik

Kamera tasviri faqat ko'zgu qurilmasida qayta ishlanadi, saqlanmaydi va yuborilmaydi.
Foydalanuvchi faol bo'lmasa (standart 90 soniya), sessiya tozalanadi va ko'zgu kutish rejimiga o'tadi.
