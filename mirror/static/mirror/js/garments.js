// Kiyim tasvirlari.
// Barcha kiyimlar bitta "tana koordinatalari" ramkasida joylashadi (200 x 360):
//   yelka bo'g'imlari: (56,40) va (144,40)   -> yelka o'rtasi (100,40)
//   son bo'g'imlari o'rtasi: (100,160)
//   to'piq darajasi: y ~ 345
// tryon.js shu ramkani kamera orqali topilgan tana nuqtalariga affin o'zgartirish bilan joylaydi.
// Admin yuklagan rasm (fon olib tashlangan PNG) turiga mos "quti" ichiga joylanadi,
// yoki admin muharrirda belgilagan aniq joyga (placement: x, y, w, h, r) qo'yiladi.

export const FRAME = { w: 200, h: 360, shoulderL: 56, shoulderR: 144, shoulderY: 40, hipY: 160 };

// Yuklangan rasmlar uchun joylashuv qutisi (ramka koordinatalarida).
export const UPLOAD_BOX = {
  bluzka:   { x: 22, y: 18, w: 156, h: 160 },
  futbolka: { x: 20, y: 18, w: 160, h: 154 },
  pidjak:   { x: 16, y: 16, w: 168, h: 178 },
  kurtka:   { x: 14, y: 12, w: 172, h: 188 },
  shim:     { x: 50, y: 148, w: 100, h: 204 },
  yubka:    { x: 36, y: 148, w: 128, h: 126 },
  koylak:   { x: 26, y: 20, w: 148, h: 290 },
};

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function shapes(type, c, d, l) {
  switch (type) {
    case "bluzka":
      return `
        <path d="M82,28 Q100,52 118,28 L146,35 Q160,40 165,60 L174,110 L154,114 L148,74 L145,170 Q100,178 55,170 L52,74 L46,114 L26,110 L35,60 Q40,40 54,35 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <path d="M100,50 L100,168" stroke="${d}" stroke-width="1.2" opacity=".5"/>
        <circle cx="100" cy="70" r="2.4" fill="${l}"/><circle cx="100" cy="95" r="2.4" fill="${l}"/><circle cx="100" cy="120" r="2.4" fill="${l}"/>
        <path d="M60,130 Q100,138 140,130" stroke="${d}" stroke-width="1.2" fill="none" opacity=".35"/>`;
    case "futbolka":
      return `
        <path d="M80,28 Q100,48 120,28 L148,35 L176,72 L156,86 L148,72 L146,168 L54,168 L52,72 L44,86 L24,72 L52,35 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <path d="M80,28 Q100,48 120,28" stroke="${d}" stroke-width="4" fill="none"/>
        <path d="M70,40 Q100,60 130,40" stroke="${l}" stroke-width="1" fill="none" opacity=".3"/>`;
    case "pidjak":
      return `
        <path d="M54,34 Q34,42 30,72 L24,172 L44,174 L52,84 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <path d="M146,34 Q166,42 170,72 L176,172 L156,174 L148,84 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <path d="M54,34 L86,26 L99,112 L97,190 L48,186 Q44,120 54,34 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <path d="M146,34 L114,26 L101,112 L103,190 L152,186 Q156,120 146,34 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <path d="M86,26 L74,42 L84,50 L77,58 L99,112 Z" fill="${d}" opacity=".55"/>
        <path d="M114,26 L126,42 L116,50 L123,58 L101,112 Z" fill="${d}" opacity=".55"/>
        <path d="M58,140 L84,140" stroke="${d}" stroke-width="2"/><path d="M116,140 L142,140" stroke="${d}" stroke-width="2"/>
        <circle cx="100" cy="130" r="3.2" fill="${d}"/><circle cx="100" cy="154" r="3.2" fill="${d}"/>`;
    case "kurtka":
      return `
        <path d="M50,32 L84,22 Q100,32 116,22 L150,32 Q172,40 175,72 L182,174 L158,178 L152,92 L155,194 Q100,202 45,194 L48,92 L42,178 L18,174 L25,72 Q28,40 50,32 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <path d="M84,22 Q100,40 116,22 L120,12 Q100,22 80,12 Z" fill="${d}" opacity=".6"/>
        <path d="M100,34 L100,196" stroke="${l}" stroke-width="2.5"/>
        <path d="M48,70 Q100,80 152,70 M47,110 Q100,120 153,110 M46,150 Q100,160 154,150" stroke="${d}" stroke-width="1.6" fill="none" opacity=".55"/>
        <rect x="58" y="160" width="24" height="4" rx="2" fill="${d}"/><rect x="118" y="160" width="24" height="4" rx="2" fill="${d}"/>`;
    case "shim":
      return `
        <path d="M60,148 L140,148 L148,348 L110,350 L101,196 L99,196 L90,350 L52,348 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <rect x="60" y="148" width="80" height="11" fill="${d}" opacity=".5"/>
        <path d="M78,160 L72,346 M122,160 L128,346" stroke="${l}" stroke-width="1" opacity=".35"/>
        <path d="M100,159 L100,190" stroke="${d}" stroke-width="1.5"/>`;
    case "yubka":
      return `
        <path d="M62,148 L138,148 L162,264 Q100,276 38,264 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <rect x="62" y="148" width="76" height="10" fill="${d}" opacity=".5"/>
        <path d="M76,158 L58,268 M88,158 L80,272 M100,158 L100,274 M112,158 L120,272 M124,158 L142,268" stroke="${d}" stroke-width="1.2" opacity=".4"/>`;
    case "koylak":
      return `
        <path d="M80,28 Q100,52 120,28 L140,32 Q148,62 142,92 L136,126 L172,296 Q100,312 28,296 L64,126 L58,92 Q52,62 60,32 Z" fill="${c}" stroke="${d}" stroke-width="2"/>
        <rect x="63" y="120" width="74" height="9" rx="3" fill="${d}" opacity=".6"/>
        <path d="M84,130 L64,300 M100,130 L100,306 M116,130 L136,300" stroke="${d}" stroke-width="1.2" opacity=".3"/>
        <path d="M70,60 Q100,80 130,60" stroke="${l}" stroke-width="1" fill="none" opacity=".3"/>`;
    default:
      return "";
  }
}

// Avtomatik tasvirlarning ramkadagi haqiqiy chegarasi (chiziq qalinligi bilan).
// Tasvir shu chegaragacha qirqiladi — admin muharririda ramka kiyimning o'ziga mos keladi.
export const SVG_BOUNDS = {
  bluzka:   { x: 24, y: 26, w: 152, h: 154 },
  futbolka: { x: 22, y: 26, w: 156, h: 144 },
  pidjak:   { x: 22, y: 24, w: 156, h: 168 },
  kurtka:   { x: 16, y: 10, w: 168, h: 194 },
  shim:     { x: 50, y: 146, w: 100, h: 206 },
  yubka:    { x: 36, y: 146, w: 128, h: 132 },
  koylak:   { x: 26, y: 26, w: 148, h: 288 },
};

export function garmentSVG(type, hex) {
  const d = shade(hex, -0.18);
  const l = shade(hex, 0.25);
  const b = SVG_BOUNDS[type] || { x: 0, y: 0, w: FRAME.w, h: FRAME.h };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${b.w * 3}" height="${b.h * 3}">
    <g stroke-linejoin="round">${shapes(type, hex, d, l)}</g>
  </svg>`;
}

const svgUrl = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

// Kartochka uchun rasm manbai (src). Rasmi yo'q kiyimga avtomatik tasvir.
export function thumbnailSrc(p) {
  return p.image || svgUrl(garmentSVG(p.kind, p.color?.hex || "#999999"));
}

// Tana chiziqlari (ramka koordinatalarida) — admin muharriri va hisob-kitoblar uchun.
export const BODY_LINES = [
  { y: 40, label: "Yelka" },
  { y: 78, label: "Ko'krak" },
  { y: 122, label: "Bel" },
  { y: 160, label: "Son" },
  { y: 255, label: "Tizza" },
  { y: 345, label: "To'piq" },
];

// Turiga qarab avtomatik joy: rasm proporsiyasini saqlab, qutiga yuqoridan tekislab joylash.
export function autoBox(kind, img, hasUpload) {
  if (!hasUpload) {
    const b = SVG_BOUNDS[kind] || { x: 0, y: 0, w: FRAME.w, h: FRAME.h };
    return { ...b, r: 0 };
  }
  const b = UPLOAD_BOX[kind] || UPLOAD_BOX.bluzka;
  const ar = (img.naturalWidth || 1) / (img.naturalHeight || 1);
  let w = b.w, h = b.w / ar;
  if (h > b.h) { h = b.h; w = b.h * ar; }
  return { x: b.x + (b.w - w) / 2, y: b.y, w, h, r: 0 };
}

// Admin belgilagan joy (placement) bo'lsa — aynan o'sha, aks holda avtomatik.
export function placeBox(kind, img, hasUpload, placement) {
  if (placement && placement.w > 0 && placement.h > 0) {
    return { x: placement.x, y: placement.y, w: placement.w, h: placement.h, r: placement.r || 0 };
  }
  return autoBox(kind, img, hasUpload);
}

const cache = new Map();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Kiyib ko'rish uchun qatlam: { img, box } — box ramka koordinatalarida.
export async function loadGarment(p) {
  const src = thumbnailSrc(p);
  if (!cache.has(src)) cache.set(src, loadImage(src));
  const img = await cache.get(src);
  return { img, box: placeBox(p.kind, img, Boolean(p.image), p.placement) };
}
