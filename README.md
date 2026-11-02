# Smart Mirror — aqlli ko'zgu platformasi (Django)

> "O'zingizning uslubingiz — endi yanada oson!"

Do'kon uchun aqlli ko'zgu. **Admin** Django admin panelida kiyimlarni kiritadi (rasm, narx, o'lcham va ombor).
**Xaridor** sensorli ko'zgudan kiyimni tanlaydi va kiyim kamera orqali **uning tanasiga real vaqtda kiydirilgan
holda** ko'rsatiladi. Yoqqan kiyimni o'lchami bilan savatga qo'shib buyurtma beradi. **Konsultant** buyurtmani
o'z panelida ko'radi va kiyimni kiyinish xonasiga olib keladi.

## Imkoniyatlar

**Sensorli ko'zgu** (`/mirror/<qurilma>/`)
- Kamera + MediaPipe Pose (brauzerda ishlaydi, tasvir serverga yuborilmaydi): kiyim yelka va songa moslashadi.
  Shim, bluzka va pidjak bir vaqtda qatlam-qatlam kiyiladi.
- Xaridorga yo'l-yo'riq: "Bir qadam orqaga turing", "Yaqinroq keling".
- Kamera bo'lmasa — manekin rejimi.
- Filtrlar: turi/uslub, o'lcham (faqat omborda borlari), ranglar, tavsiyalar (mos juftlik, ob-havo, ommabop, yangi kolleksiya).
- O'lchamni tanlash → **Savat** → telefon raqami (ekran klaviaturasi) → **buyurtma raqami** (#007).
- **♡ Obrazni saqlash** → surat + QR kod: xaridor telefonida obraz sahifasini ochadi.
- Katalog 30 soniyada avtomatik yangilanadi (admin o'zgartirsa, ko'zgu darhol ko'radi).
- Harakatsizlikdan keyin sessiya tugaydi, savat va sevimlilar tozalanadi (maxfiylik).

**Admin panel** (`/admin/`)
- Kiyimlar: turi, uslubi, rangi, narxi, tavsifi, o'lchamlar bo'yicha ombor.
- Rasm yuklanganda **fon avtomatik olib tashlanadi** (oq/bir xil fonli surat yetarli) va kiyim chegarasigacha qirqiladi.
- **Jonli oldindan ko'rish:** kiyim manekinda qanday ko'rinishi, o'lcham va siljishni sozlash.
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
mirror/static/mirror/js/    app.js (ko'zgu), tryon.js (kamera + AI), garments.js, api.js, weather.js, admin-fit.js
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

### Kiyib ko'rish qanday ishlaydi

1. Kamera tasviri ko'zgudek teskari ko'rsatiladi.
2. MediaPipe Pose Landmarker har kadrda yelka va son nuqtalarini topadi.
3. Har bir kiyim 200×360 "tana ramkasi"da joylashadi: yelkalar `(56,40)–(144,40)`, son o'rtasi `(100,160)`.
   Ramka topilgan nuqtalarga affin matritsa bilan joylanadi, shuning uchun odam yaqinlashsa, uzoqlashsa yoki egilsa, kiyim ham moslashadi.
4. Qatlamlar: past (shim/yubka) → ichki (bluzka/futbolka) yoki ko'ylak → ustki (pidjak/kurtka).

### Kiyim rasmi bo'yicha maslahat

- Kiyimni old tomondan, tekis yoyib, **oq yoki bir xil rangli fonda** suratga oling.
- Yoki fonsiz (shaffof) PNG yuklang.
- Saqlagach, "Ko'zgudagi ko'rinish"da tekshiring va kerak bo'lsa "o'lcham koeffitsienti"ni (masalan, 1.1) va siljishni sozlang.

## Keyingi bosqichlar

- **Fotorealistik AI kiyib ko'rish:** surat GPU serverdagi diffuziya asosidagi VTON modeliga yuboriladi.
  Tijoriy foydalanishdan oldin model litsenziyasini tekshiring.
- **Kamera orqali o'lcham tavsiyasi.**
- **Integratsiyalar:** kassa/1C, Telegram bot (konsultantga xabar), to'lov (Click/Payme).
