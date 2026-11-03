# Smart Mirror — aqlli ko'zgu platformasi (Django)

> "O'zingizning uslubingiz — endi yanada oson!"

Do'kon uchun aqlli ko'zgu. **Admin** Django admin panelida kiyimlarni kiritadi (rasm, narx, o'lcham va ombor).
**Xaridor** sensorli ko'zgudan kiyimni tanlaydi va kiyim kamera orqali **uning tanasiga real vaqtda kiydirilgan
holda** ko'rsatiladi. Yoqqan kiyimni o'lchami bilan savatga qo'shib buyurtma beradi. **Konsultant** buyurtmani
o'z panelida ko'radi va kiyimni kiyinish xonasiga olib keladi.

## Imkoniyatlar

**Sensorli ko'zgu** (`/mirror/<qurilma>/`)
- **Ko'zgu — alohida, katta panel.** Uning ustida hech qanday yozuv chiqmaydi. Kiyim ma'lumoti, o'lcham va narx
  alohida panelda, holat va tugmalar ko'zgu ostidagi qatorda. **⤢ Katta** tugmasi ko'zguni butun ekranga yoyadi.
- Vertikal ekranda ko'zgu tepada, ma'lumot va katalog pastda. Gorizontal ekranda ko'zgu chapda, ma'lumot o'ngda.
- **Jonli kiyib ko'rish:** kamera + MediaPipe Pose (brauzerda ishlaydi, tasvir serverga yuborilmaydi).
  Kiyim yelka va songa moslashadi; shim, bluzka va pidjak qatlam-qatlam kiyiladi.
- **Jonli realizm:** xonadagi yorug'lik, soya va tana burmalari kiyimga tushadi. Qo'l tana oldida bo'lsa
  (masalan, qo'llar qovushtirilgan), u kiyim ustida ko'rinadi — buning uchun odam silueti niqobidan foydalaniladi.
- **✨ AI foto — fotorealistik natija:** xaridorning toza kamera surati va tanlangan kiyimlar generativ AI
  xizmatiga yuboriladi. 10–60 soniyada haqiqiy fotodek surat ko'zguda chiqadi va QR orqali telefonga olinadi
  (pastdagi "Fotorealistik AI" bo'limiga qarang).
- Xaridorga yo'l-yo'riq: "Bir qadam orqaga turing", "Yaqinroq keling".
- Kamera bo'lmasa — manekin rejimi.
- Filtrlar: turi/uslub, o'lcham (faqat omborda borlari), ranglar, tavsiyalar (mos juftlik, ob-havo, ommabop, yangi kolleksiya).
- O'lchamni tanlash → **Savat** → telefon raqami (ekran klaviaturasi) → **buyurtma raqami** (#007).
- **♡ Saqlash** → surat + QR kod: xaridor telefonida obraz sahifasini ochadi.
- Katalog 30 soniyada avtomatik yangilanadi (admin o'zgartirsa, ko'zgu darhol ko'radi).
- Harakatsizlikdan keyin sessiya tugaydi, savat va sevimlilar tozalanadi (maxfiylik).

**Admin panel** (`/admin/`)
- Kiyimlar: turi, uslubi, rangi, narxi, tavsifi, o'lchamlar bo'yicha ombor.
- Rasm yuklanganda **fon avtomatik olib tashlanadi** (oq/bir xil fonli surat yetarli) va kiyim chegarasigacha qirqiladi.
- **Tanaga joylash muharriri (canvas):** kiyim manekin ustida ko'rsatiladi. Uni sichqoncha yoki barmoq bilan surish,
  burchak va qirralaridan kattalashtirish, tepadagi doiracha bilan burish mumkin. Tana chiziqlari (yelka, ko'krak,
  bel, son, tizza, to'piq) belgilangan. **Tana qismi bo'yicha joylash** tugmalari ("Yelka → Son", "Bel → To'piq" …)
  kiyimni bir bosishda kerakli qismga qo'yadi (★ — turiga tavsiya). Aniq raqamlar va klaviatura ham bor.
  Ko'zguda kiyim xaridor tanasining aynan shu qismiga kiydiriladi.
- Ko'zgu qurilmalari (bir nechta ko'zgu, har birining shahri va kutish vaqti), ranglar, buyurtmalar, sessiyalar, obrazlar.

**Konsultant paneli** (`/staff/`)
- Yangi buyurtmalar avtomatik paydo bo'ladi (ovozli signal bilan).
- Holatlar: Yangi → Tayyorlanmoqda → Kiyinish xonasida → Sotildi / Bekor qilindi.
- Buyurtma omborni zaxiralaydi, bekor qilinsa kiyim omborga qaytadi.

**Statistika** (`/staff/stats/`)
- Sessiyalar, sinab ko'rishlar, o'rtacha vaqt, buyurtmalar, konversiya, sotuv, tejalgan vaqt.
- Har bir kiyim uchun **sinab ko'rish → buyurtma → sotuv** konversiyasi.
- Omborda tugayotgan o'lchamlar.

## O'rnatish

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py createsuperuser
python manage.py runserver
```

Brauzerda oching:

| Sahifa | Manzil |
|---|---|
| Ko'zgu | http://localhost:8000/ |
| Admin | http://localhost:8000/admin/ |
| Konsultant paneli | http://localhost:8000/staff/ |
| Statistika | http://localhost:8000/staff/stats/ |

Testlar:

```bash
python manage.py test mirror
```

Kamera faqat `localhost` yoki `https://` orqali ishlaydi. Ko'zgu boshqa kompyuterda bo'lsa, serverni HTTPS bilan
ishga tushiring (masalan, nginx + sertifikat). AI modeli birinchi marta internetdan yuklanadi (jsDelivr va Google Storage).

## Fotorealistik AI

Jonli ko'zgu kiyimni tasvir sifatida tanaga joylaydi — bu tez, lekin "rasm ustiga rasm" ko'rinishida.
Haqiqiy fotodek natija uchun **✨ AI foto** tugmasi generativ virtual kiyib ko'rish (VTON) xizmatidan foydalanadi:

1. Ko'zgu kiyimsiz toza kadrni oladi va tanlangan kiyimlar bilan serverga yuboradi.
2. Server ishni fon oqimida bajaradi. Bir nechta kiyim bo'lsa, ular ketma-ket kiydiriladi:
   ko'ylak yoki bluzka → pidjak yoki kurtka → shim yoki yubka.
3. Natija ko'zguda chiqadi (**◐ Jonli** tugmasi bilan jonli ko'zguga qaytiladi). **♡ Saqlash** bossangiz, QR sahifasida aynan shu AI surat bo'ladi.

Sozlash: **Admin → AI sozlamalari**.

| Xizmat | Nima kerak | Izoh |
|---|---|---|
| FASHN AI | API kalit (fashn.ai) | Tijoriy, sifatli; model standart `tryon-v1.6` |
| Replicate | API token (replicate.com) | Standart model `cuuupid/idm-vton`; `egasi/nomi:versiya` ham bo'ladi |
| O'z serverimiz (HTTP) | GPU server manzili | Ochiq kodli modelni o'zingiz ishga tushirasiz |

**O'z serverimiz kontrakti:** `POST <manzil>`, sarlavhada ixtiyoriy `Authorization: Bearer <kalit>`:

```json
{"person": "data:image/jpeg;base64,...", "garment": "data:image/jpeg;base64,...",
 "category": "ichki | ustki | past | toliq", "description": "Kiyim nomi"}
```

Javob: `{"image": "data:image/jpeg;base64,..."}` (yoki rasm URL'i), xato bo'lsa `{"error": "..."}`.

Muhim:
- Eng yaxshi natija uchun xaridor ko'zgu oldida **to'liq, to'g'ri** tursin, yorug'lik yaxshi bo'lsin.
- Kiyim rasmlari (admin yuklagan) qanchalik sifatli bo'lsa, natija shunchalik real. Rasmi yo'q kiyim uchun avtomatik tasvir yuboriladi — bunda natija sodda bo'ladi.
- Xaridor surati AI xizmatiga **faqat ✨ AI foto tugmasi bosilganda** yuboriladi. Do'konda bu haqda ogohlantirish qo'yish tavsiya etiladi.
- Ochiq kodli VTON modellarining ko'pi (IDM-VTON, CatVTON va boshqalar) **faqat notijorat** litsenziyada — tijoriy
  foydalanishdan oldin litsenziyani tekshiring yoki tijoriy API'dan foydalaning.
- Tashqi xizmatlar API'si o'zgarishi mumkin: model nomi admin panelda o'zgartiriladi. Kod: `mirror/vton.py`.

## Production

```bash
export DJANGO_DEBUG=0
export DJANGO_SECRET_KEY='uzun-tasodifiy-kalit'
export DJANGO_ALLOWED_HOSTS=mirror.example.uz
export DJANGO_CSRF_TRUSTED_ORIGINS=https://mirror.example.uz
python manage.py collectstatic --noinput
pip install gunicorn
gunicorn config.wsgi -b 0.0.0.0:8000
```

Statik fayllarni WhiteNoise beradi. Media fayllar (kiyim rasmlari, suratlar) standart holatda Django orqali beriladi
(`DJANGO_SERVE_MEDIA=1`) — bitta do'kon uchun yetarli. Katta o'rnatishda media'ni nginx bersin va `DJANGO_SERVE_MEDIA=0` qiling.

Ko'zgu kompyuterida Chrome kiosk rejimi:

```bash
chromium --kiosk --use-fake-ui-for-media-stream https://mirror.example.uz/mirror/asosiy/
```

## Tuzilma

```
config/                     Django sozlamalari va URL'lar
mirror/models.py            Kiyim, O'lcham/ombor, Rang, Ko'zgu, Sessiya, Sinab ko'rish, Obraz, Buyurtma
mirror/admin.py             Admin panel (jonli oldindan ko'rish, ombor, buyurtma holatlari)
mirror/api.py               Ko'zgu uchun JSON API
mirror/views.py             Ko'zgu sahifasi, obraz sahifasi, konsultant paneli, statistika
mirror/imaging.py           Rasm fonini olib tashlash (Pillow)
mirror/vton.py              Fotorealistik AI: FASHN / Replicate / o'z serverimiz, fon oqimida bajarish
mirror/static/mirror/js/    app.js (ko'zgu), tryon.js (kamera + AI), garments.js, api.js, weather.js,
                            admin-place.js (admin: kiyimni tanaga joylash muharriri)
mirror/templates/mirror/    Shablonlar
mirror/management/commands/seed_demo.py   Demo ma'lumotlar
```

### API

| Metod | Manzil | Vazifasi |
|---|---|---|
| GET | `/api/catalog/?device=<slug>` | Katalog, ranglar, turlar, qurilma sozlamalari |
| GET | `/api/catalog/version/` | Katalog o'zgarganini tekshirish |
| POST | `/api/sessions/` | Tashrif boshlanishi |
| POST | `/api/sessions/<id>/try/` | Kiyim sinab ko'rildi |
| POST | `/api/sessions/<id>/end/` | Tashrif tugadi |
| POST | `/api/looks/` | Obraz + surat saqlash → QR |
| POST | `/api/orders/` | Buyurtma (ombor zaxiralanadi) |
| POST | `/api/photoreal/` | AI foto ishini boshlash (surat + kiyimlar) |
| GET | `/api/photoreal/<id>/` | AI foto holati va natijasi |

### Kiyib ko'rish qanday ishlaydi

1. Kamera tasviri ko'zgudek teskari ko'rsatiladi.
2. MediaPipe Pose Landmarker har kadrda yelka va son nuqtalarini topadi.
3. Har bir kiyim 200×360 "tana ramkasi"da joylashadi: yelkalar `(56,40)–(144,40)`, son o'rtasi `(100,160)`.
   Admin muharrirda belgilagan joy shu ramkada `placement = {x, y, w, h, r}` ko'rinishida saqlanadi
   (belgilanmagan bo'lsa — turiga qarab avtomatik).
   Ramka topilgan nuqtalarga affin matritsa bilan joylanadi, shuning uchun odam yaqinlashsa, uzoqlashsa yoki egilsa, kiyim ham moslashadi.
4. Qatlamlar: past (shim/yubka) → ichki (bluzka/futbolka) yoki ko'ylak → ustki (pidjak/kurtka).

### Kiyim rasmi bo'yicha maslahat

- Kiyimni old tomondan, tekis yoyib, **oq yoki bir xil rangli fonda** suratga oling.
- Yoki fonsiz (shaffof) PNG yuklang.
- Rasm tanlanishi bilan muharrir uni serverda **saqlashdagi bilan bir xil** qayta ishlaydi (fon olib tashlanadi,
  qirqiladi) va darhol fonsiz holda ko'rsatadi — saqlashdan oldin ko'rganingiz ko'zguda aynan shunday chiqadi.
  "Fonni avtomatik olib tashlash" belgisini o'zgartirsangiz ham ko'rinish darhol yangilanadi.

## Keyingi bosqichlar

- **Ikki ekranli rejim:** katta ko'zgu ekrani va alohida sensorli boshqaruv planshet.
- **Navbat:** ko'p ko'zguli do'konda AI ishlarini Celery/RQ navbatiga o'tkazish.
- **Kamera orqali o'lcham tavsiyasi.**
- **Integratsiyalar:** kassa/1C, Telegram bot (konsultantga xabar), to'lov (Click/Payme).
