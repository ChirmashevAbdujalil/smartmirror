// Katalog va saqlash qatlami (localStorage).
// Kiosk (index.html) va admin panel (admin.html) bir xil ma'lumotdan foydalanadi.

export const TYPES = {
  bluzka:   { label: "Bluzka",   slot: "ichki" },
  futbolka: { label: "Futbolka", slot: "ichki" },
  pidjak:   { label: "Pidjak",   slot: "ustki" },
  kurtka:   { label: "Kurtka",   slot: "ustki" },
  shim:     { label: "Shim",     slot: "past" },
  yubka:    { label: "Yubka",    slot: "past" },
  koylak:   { label: "Ko'ylak",  slot: "toliq" },
};

// Chizish tartibi: pastdan yuqoriga.
export const SLOT_ORDER = ["past", "ichki", "toliq", "ustki"];

export const STYLES = {
  klassik:  "Klassik",
  kundalik: "Kundalik",
  kechki:   "Kechki",
  sport:    "Sport",
};

export const COLORS = {
  pushti:  { label: "Pushti",   hex: "#e8a3b5" },
  qizil:   { label: "Qizil",    hex: "#c8324a" },
  qora:    { label: "Qora",     hex: "#25232a" },
  oq:      { label: "Oq",       hex: "#f2efe9" },
  bej:     { label: "Bej",      hex: "#d8bfa2" },
  kok:     { label: "Ko'k",     hex: "#3b5ea8" },
  havorang:{ label: "Havorang", hex: "#8fb8de" },
  yashil:  { label: "Yashil",   hex: "#4f7d5c" },
  jigarrang:{ label: "Jigarrang", hex: "#7a5236" },
  kulrang: { label: "Kulrang",  hex: "#8d8f96" },
};

export const SIZES = ["XS", "S", "M", "L", "XL"];

const stock = (xs, s, m, l, xl) => ({ XS: xs, S: s, M: m, L: l, XL: xl });

export const DEFAULT_PRODUCTS = [
  { id: "p1",  name: "Ipak bluzka",          type: "bluzka",   style: "klassik",  color: "oq",       price: 289000, sizes: stock(2, 4, 5, 3, 1) },
  { id: "p2",  name: "Pushti bluzka",        type: "bluzka",   style: "kechki",   color: "pushti",   price: 315000, sizes: stock(0, 3, 4, 2, 0) },
  { id: "p3",  name: "Paxta futbolka",       type: "futbolka", style: "kundalik", color: "qora",     price: 129000, sizes: stock(5, 8, 8, 6, 4) },
  { id: "p4",  name: "Sport futbolka",       type: "futbolka", style: "sport",    color: "havorang", price: 149000, sizes: stock(3, 5, 6, 5, 2) },
  { id: "p5",  name: "Bej pidjak",           type: "pidjak",   style: "klassik",  color: "bej",      price: 690000, sizes: stock(1, 2, 3, 2, 1) },
  { id: "p6",  name: "Pushti pidjak",        type: "pidjak",   style: "klassik",  color: "pushti",   price: 720000, sizes: stock(0, 2, 2, 1, 0) },
  { id: "p7",  name: "Qora pidjak",          type: "pidjak",   style: "kechki",   color: "qora",     price: 750000, sizes: stock(1, 3, 3, 3, 2) },
  { id: "p8",  name: "Kuzgi kurtka",         type: "kurtka",   style: "kundalik", color: "jigarrang",price: 890000, sizes: stock(0, 2, 4, 3, 2) },
  { id: "p9",  name: "Issiq kurtka",         type: "kurtka",   style: "sport",    color: "yashil",   price: 940000, sizes: stock(1, 2, 3, 3, 1) },
  { id: "p10", name: "Klassik shim",         type: "shim",     style: "klassik",  color: "bej",      price: 359000, sizes: stock(2, 4, 4, 3, 2) },
  { id: "p11", name: "Jinsi shim",           type: "shim",     style: "kundalik", color: "kok",      price: 399000, sizes: stock(3, 6, 6, 5, 3) },
  { id: "p12", name: "Qora shim",            type: "shim",     style: "kechki",   color: "qora",     price: 379000, sizes: stock(1, 3, 4, 3, 1) },
  { id: "p13", name: "Plisse yubka",         type: "yubka",    style: "kechki",   color: "pushti",   price: 330000, sizes: stock(1, 3, 3, 2, 0) },
  { id: "p14", name: "Kulrang yubka",        type: "yubka",    style: "klassik",  color: "kulrang",  price: 299000, sizes: stock(2, 3, 3, 2, 1) },
  { id: "p15", name: "Qizil kechki ko'ylak", type: "koylak",   style: "kechki",   color: "qizil",    price: 1150000, sizes: stock(1, 2, 2, 1, 0) },
  { id: "p16", name: "Yozgi ko'ylak",        type: "koylak",   style: "kundalik", color: "havorang", price: 460000, sizes: stock(2, 3, 4, 2, 1) },
];

const KEY_CATALOG = "smartmirror.catalog.v1";
const KEY_FAVS = "smartmirror.favorites.v1";
const KEY_LOOKS = "smartmirror.looks.v1";
const KEY_STATS = "smartmirror.stats.v1";
const KEY_SETTINGS = "smartmirror.settings.v1";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn("Saqlab bo'lmadi:", key, err);
    return false;
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- Katalog ----
export function getProducts() {
  const list = read(KEY_CATALOG, null);
  return Array.isArray(list) ? list : clone(DEFAULT_PRODUCTS);
}

export function saveProducts(list) {
  return write(KEY_CATALOG, list);
}

export function resetProducts() {
  localStorage.removeItem(KEY_CATALOG);
}

export function newId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export const totalStock = (p) => Object.values(p.sizes || {}).reduce((a, b) => a + (+b || 0), 0);

// ---- Sevimlilar va saqlangan obrazlar ----
export const getFavorites = () => read(KEY_FAVS, []);
export const saveFavorites = (ids) => write(KEY_FAVS, ids);
export const getLooks = () => read(KEY_LOOKS, []);
export const saveLooks = (looks) => write(KEY_LOOKS, looks);

// ---- Sozlamalar ----
export const DEFAULT_SETTINGS = { city: "toshkent", idleSeconds: 90, storeName: "Smart Mirror" };
export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...read(KEY_SETTINGS, {}) });
export const saveSettings = (s) => write(KEY_SETTINGS, s);

// ---- Statistika (do'kon uchun) ----
const EMPTY_STATS = { tries: {}, sessions: 0, sessionSeconds: 0, snapshots: 0, favAdds: 0 };
export const getStats = () => ({ ...EMPTY_STATS, ...read(KEY_STATS, {}) });
export const resetStats = () => localStorage.removeItem(KEY_STATS);

export function recordTry(productId) {
  const s = getStats();
  s.tries[productId] = (s.tries[productId] || 0) + 1;
  write(KEY_STATS, s);
}

export function recordSession(seconds) {
  const s = getStats();
  s.sessions += 1;
  s.sessionSeconds += Math.round(seconds);
  write(KEY_STATS, s);
}

export function recordEvent(name) {
  const s = getStats();
  s[name] = (s[name] || 0) + 1;
  write(KEY_STATS, s);
}

export function formatPrice(sum) {
  return Number(sum || 0).toLocaleString("ru-RU").replace(/,/g, " ") + " so'm";
}
