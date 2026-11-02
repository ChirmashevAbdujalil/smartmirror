// Smart Mirror — sensorli ko'zgu (kiosk) interfeysi. Ma'lumotlar Django API'dan keladi.
import { api, formatPrice } from "./api.js";
import { thumbnailSrc, loadGarment } from "./garments.js";
import { TryOnEngine } from "./tryon.js";
import { CITIES, fetchWeather } from "./weather.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SLOT_ORDER = ["past", "ichki", "toliq", "ustki"];
const DEVICE = document.body.dataset.device;

const state = {
  products: [],
  kinds: [], styles: [], colors: [], sizes: [],
  device: { city: "toshkent", idleSeconds: 90 },
  version: null,
  filters: { style: null, kind: null, color: null, size: null },
  look: {},            // slot -> productId
  focus: null,
  focusSize: null,
  cart: [],            // [{ product, size }]
  weather: null,
  session: null,       // { id, start, tried:Set, favs:Set, pending:Promise }
  tab: "clothes",
  sheet: null,         // ochiq varaq turi
};

const byId = (id) => state.products.find((p) => p.id === id);
const kindLabel = (k) => state.kinds.find((x) => x.id === k)?.label || k;
const styleLabel = (s) => state.styles.find((x) => x.id === s)?.label || s;
const inStock = (p) => Object.values(p.sizes).some((n) => n > 0);

// ---------------- Kiyib ko'rish dvigateli ----------------
const engine = new TryOnEngine($("#canvas"), $("#video"), {
  onStatus: ({ mode, text }) => {
    $("#status").dataset.mode = mode;
    $("#status-text").textContent = text;
    $("#btn-camera").classList.toggle("on", mode === "kamera");
  },
  onGuide: (text) => {
    $("#guide").textContent = text;
    $("#guide").hidden = !text;
  },
});
engine.start();

async function syncLayers() {
  const items = SLOT_ORDER.map((s) => byId(state.look[s])).filter(Boolean);
  const layers = await Promise.all(items.map((p) => loadGarment(p).catch(() => null)));
  engine.setLayers(layers.filter(Boolean));
}

// ---------------- Katalog ----------------
async function loadCatalog() {
  const data = await api.catalog(DEVICE);
  Object.assign(state, {
    products: data.products, kinds: data.kinds, styles: data.styles, colors: data.colors,
    sizes: data.sizes, version: data.version,
  });
  if (data.device) state.device = data.device;
  // O'chirilgan kiyimlarni obrazdan va savatdan olib tashlaymiz.
  for (const [slot, id] of Object.entries(state.look)) if (!byId(id)) delete state.look[slot];
  state.cart = state.cart.filter((c) => byId(c.product));
  syncLayers();
  render();
}

async function pollCatalog() {
  try {
    const { version } = await api.version();
    if (version !== state.version) await loadCatalog();
  } catch { /* tarmoq vaqtincha yo'q */ }
}

// ---------------- Soat va ob-havo ----------------
function tickClock() {
  $("#time").textContent = new Date().toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}

async function refreshWeather() {
  try {
    state.weather = await fetchWeather(state.device.city);
    const w = state.weather;
    $("#weather").innerHTML = `<span class="w-icon">${w.icon}</span><span class="w-temp">${w.temp}°C</span><span class="w-city">${esc(w.city)}</span>`;
  } catch {
    $("#weather").innerHTML = `<span class="w-city">${esc(CITIES[state.device.city]?.label || "")}</span>`;
  }
}

// ---------------- Sessiya ----------------
function ensureSession() {
  if (state.session) return state.session;
  const s = { id: null, start: Date.now(), tried: new Set(), favs: new Set() };
  s.pending = api.startSession(DEVICE).then((r) => (s.id = r.session)).catch(() => null);
  state.session = s;
  return s;
}

async function sessionId() {
  const s = state.session;
  if (!s) return null;
  await s.pending;
  return s.id;
}

function renderSession() {
  const s = state.session;
  const el = $("#session");
  if (!s || !s.tried.size) { el.hidden = true; return; }
  const sec = Math.round((Date.now() - s.start) / 1000);
  el.hidden = false;
  el.innerHTML = `<b>${s.tried.size} ta</b> kiyim · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

let idleTimer = null;
function bumpIdle() {
  $("#idle").hidden = true;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(goIdle, (state.device.idleSeconds || 90) * 1000);
}

async function goIdle() {
  const id = await sessionId();
  if (id) api.endSession(id).catch(() => {});
  state.session = null;
  state.look = {};
  state.focus = null;
  state.focusSize = null;
  state.cart = [];
  state.filters = { style: null, kind: null, color: null, size: null };
  closeSheet();
  syncLayers();
  render();
  $("#idle").hidden = false;
}

// ---------------- Filtrlash ----------------
function filtered() {
  const f = state.filters;
  return state.products.filter((p) =>
    (!f.style || p.style === f.style) &&
    (!f.kind || p.kind === f.kind) &&
    (!f.color || p.color.id === +f.color) &&
    (!f.size || (p.sizes[f.size] || 0) > 0));
}

const activeFilterCount = () => Object.values(state.filters).filter(Boolean).length;

// ---------------- Amallar ----------------
function toggleWear(id) {
  const p = byId(id);
  if (!p) return;
  const s = ensureSession();
  if (state.look[p.slot] === id) {
    delete state.look[p.slot];
    if (state.focus === id) state.focus = null;
  } else {
    state.look[p.slot] = id;
    if (p.slot === "toliq") { delete state.look.ichki; delete state.look.past; }
    if (p.slot === "ichki" || p.slot === "past") delete state.look.toliq;
    state.focus = id;
    state.focusSize = state.filters.size && p.sizes[state.filters.size] > 0 ? state.filters.size : null;
    if (!s.tried.has(id)) {
      s.tried.add(id);
      sessionId().then((sid) => sid && api.tryOn(sid, id).catch(() => {}));
    }
  }
  syncLayers();
  render();
}

function toggleFav(id) {
  const s = ensureSession();
  if (s.favs.has(id)) s.favs.delete(id);
  else { s.favs.add(id); toast("Sevimlilarga qo'shildi ♡"); }
  render();
  if (state.sheet === "favs") openFavs();
}

function addToCart() {
  const p = byId(state.focus);
  if (!p) return;
  if (!state.focusSize) { toast("Avval o'lchamni tanlang"); return; }
  const inCart = state.cart.filter((c) => c.product === p.id && c.size === state.focusSize).length;
  if (inCart >= (p.sizes[state.focusSize] || 0)) { toast("Omborda boshqa qolmagan"); return; }
  ensureSession();
  state.cart.push({ product: p.id, size: state.focusSize });
  toast(`Savatga qo'shildi: ${p.name} (${state.focusSize})`);
  render();
}

// ---------------- Chizish ----------------
function render() {
  renderRail();
  renderLook();
  renderSession();
  document.querySelectorAll("#filters button").forEach((b) => {
    const k = b.dataset.filter;
    const on = k === "style" ? state.filters.style || state.filters.kind : k === "recs" ? false : state.filters[k];
    b.classList.toggle("on", Boolean(on));
  });
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const badge = $("#cart-badge");
  badge.textContent = state.cart.length;
  badge.hidden = !state.cart.length;
}

function cardHTML(p, extra = "") {
  const worn = Object.values(state.look).includes(p.id);
  const fav = state.session?.favs.has(p.id);
  return `<div class="card ${worn ? "worn" : ""} ${inStock(p) ? "" : "out"}" data-id="${p.id}">
    <img src="${esc(thumbnailSrc(p))}" alt="${esc(p.name)}" loading="lazy">
    ${p.isNew ? `<span class="badge-new">Yangi</span>` : ""}
    <button class="fav ${fav ? "on" : ""}" data-fav="${p.id}" aria-label="Sevimli">${fav ? "♥" : "♡"}</button>
    <div class="card-name">${esc(p.name)}</div>
    <div class="card-price">${formatPrice(p.price)}</div>
    ${extra}
  </div>`;
}

function renderRail() {
  const list = filtered();
  const n = activeFilterCount();
  $("#rail").innerHTML =
    (n ? `<button class="rail-reset" id="rail-reset">Filtrlar: ${n} ✕</button>` : "") +
    (list.length ? list.map((p) => cardHTML(p)).join("") : `<div class="empty">${state.products.length ? "Mos kiyim topilmadi" : "Katalog bo'sh. Admin panelda kiyim qo'shing."}</div>`);
}

function renderLook() {
  const worn = SLOT_ORDER.map((s) => byId(state.look[s])).filter(Boolean);
  const focus = byId(state.focus);
  let html = "";
  if (focus) {
    const sizes = state.sizes.filter((s) => s in focus.sizes).map((s) => {
      const n = focus.sizes[s];
      return `<button class="sz ${n ? "" : "na"} ${state.focusSize === s ? "sel" : ""}" ${n ? `data-size="${s}"` : "disabled"} title="${n} dona">${s}</button>`;
    }).join("");
    html += `<div class="focus">
      <div class="focus-top">
        <div>
          <div class="focus-name">${esc(focus.name)}</div>
          <div class="focus-meta">${esc(focus.kindLabel)} · ${esc(focus.styleLabel)} · ${esc(focus.color.name)}</div>
        </div>
        <div class="focus-price">${formatPrice(focus.price)}</div>
      </div>
      ${focus.description ? `<div class="focus-desc">${esc(focus.description)}</div>` : ""}
      <div class="focus-row">
        <div class="focus-sizes">${sizes || `<span class="muted">O'lcham yo'q</span>`}</div>
        <button class="buy" id="btn-add-cart" ${inStock(focus) ? "" : "disabled"}>${inStock(focus) ? "Savatga" : "Tugagan"}</button>
      </div>
    </div>`;
  }
  if (worn.length) {
    const total = worn.reduce((a, p) => a + p.price, 0);
    html += `<div class="chips">${worn.map((p) => `<button class="chip" data-unwear="${p.id}">${esc(p.name)} ✕</button>`).join("")}
      <span class="chip total">Obraz: ${formatPrice(total)}</span></div>`;
  }
  $("#look").innerHTML = html;
}

// ---------------- Varaqlar ----------------
function openSheet(kind, html) {
  state.sheet = kind;
  $("#sheet-body").innerHTML = html;
  $("#sheet").hidden = false;
  $("#backdrop").hidden = false;
}

function closeSheet() {
  state.sheet = null;
  $("#sheet").hidden = true;
  $("#backdrop").hidden = true;
  if (state.tab !== "clothes") { state.tab = "clothes"; render(); }
}

function chip(group, value, label, on) {
  return `<button class="opt ${on ? "on" : ""}" data-set="${group}" data-value="${esc(value)}">${label}</button>`;
}

function openStyle() {
  const f = state.filters;
  openSheet("style", `<h3>Turi</h3><div class="opts">
      ${chip("kind", "", "Barchasi", !f.kind)}
      ${state.kinds.map((k) => chip("kind", k.id, esc(k.label), f.kind === k.id)).join("")}
    </div>
    <h3>Uslub</h3><div class="opts">
      ${chip("style", "", "Barchasi", !f.style)}
      ${state.styles.map((s) => chip("style", s.id, esc(s.label), f.style === s.id)).join("")}
    </div>`);
}

function openSize() {
  const f = state.filters;
  openSheet("size", `<h3>O'lcham tanlash</h3>
    <p class="muted">Faqat sizning o'lchamingizda omborda bor kiyimlar ko'rsatiladi.</p>
    <div class="opts sizes">
      ${chip("size", "", "Barchasi", !f.size)}
      ${state.sizes.map((s) => chip("size", s, s, f.size === s)).join("")}
    </div>
    <details class="guide"><summary>O'lchamlar jadvali</summary>
      <table><tr><th></th><th>Ko'krak, sm</th><th>Bel, sm</th><th>Son, sm</th></tr>
      <tr><td>XS</td><td>80–84</td><td>62–66</td><td>86–90</td></tr>
      <tr><td>S</td><td>84–88</td><td>66–70</td><td>90–94</td></tr>
      <tr><td>M</td><td>88–92</td><td>70–74</td><td>94–98</td></tr>
      <tr><td>L</td><td>92–98</td><td>74–80</td><td>98–104</td></tr>
      <tr><td>XL</td><td>98–104</td><td>80–86</td><td>104–110</td></tr>
      <tr><td>XXL</td><td>104–110</td><td>86–92</td><td>110–116</td></tr></table>
    </details>`);
}

function openColor() {
  const f = state.filters;
  openSheet("color", `<h3>Ranglar</h3><div class="opts swatches">
    ${chip("color", "", "Barchasi", !f.color)}
    ${state.colors.map((c) =>
      `<button class="swatch ${String(f.color) === String(c.id) ? "on" : ""}" data-set="color" data-value="${c.id}"><i style="background:${esc(c.hex)}"></i>${esc(c.name)}</button>`).join("")}
  </div>`);
}

function score(p, base) {
  let s = 0;
  if (p.style === base.style) s += 2;
  if (p.color.neutral || base.color.neutral) s += 1.5;
  if (p.color.id === base.color.id && !p.color.neutral) s -= 1;
  if (!inStock(p)) s -= 10;
  return s;
}

function recommendations() {
  const recs = [];
  const seen = new Set(Object.values(state.look));
  const add = (p, why) => {
    if (p && !seen.has(p.id) && inStock(p)) { seen.add(p.id); recs.push({ p, why }); }
  };
  const L = state.look;

  if ((L.ichki || L.ustki) && !L.past && !L.toliq) {
    const base = byId(L.ichki || L.ustki);
    state.products.filter((p) => p.slot === "past").sort((a, b) => score(b, base) - score(a, base))
      .slice(0, 2).forEach((p) => add(p, `${base.name} bilan mos`));
  }
  if ((L.ichki || L.toliq) && !L.ustki) {
    const base = byId(L.toliq || L.ichki);
    state.products.filter((p) => p.slot === "ustki").sort((a, b) => score(b, base) - score(a, base))
      .slice(0, 1).forEach((p) => add(p, "Obrazni to'ldiradi"));
  }
  if (L.past && !L.ichki && !L.ustki) {
    const base = byId(L.past);
    state.products.filter((p) => p.slot === "ichki").sort((a, b) => score(b, base) - score(a, base))
      .slice(0, 2).forEach((p) => add(p, `${base.name} bilan mos`));
  }

  const t = state.weather?.temp;
  if (t != null) {
    const kinds = t < 12 ? ["kurtka", "pidjak"] : t > 25 ? ["futbolka", "koylak", "yubka"] : ["pidjak", "bluzka"];
    state.products.filter((p) => kinds.includes(p.kind)).slice(0, 2)
      .forEach((p) => add(p, `Bugun ${t}°C — ${t < 12 ? "issiqroq kiyining" : t > 25 ? "yengil kiyim" : "mavsumga mos"}`));
  }

  state.products.filter((p) => p.popularity > 0).sort((a, b) => b.popularity - a.popularity).slice(0, 2)
    .forEach((p) => add(p, "Eng ko'p sinab ko'rilgan"));

  const focus = byId(state.focus);
  if (focus) {
    state.products.filter((p) => p.style === focus.style && p.kind !== focus.kind)
      .sort((a, b) => score(b, focus) - score(a, focus))
      .forEach((p) => add(p, `${focus.styleLabel} uslubiga mos`));
  }
  state.products.filter((p) => p.isNew).forEach((p) => add(p, "Yangi kolleksiya"));
  if (!recs.length) state.products.slice(0, 4).forEach((p) => add(p, "Tavsiya etamiz"));
  return recs.slice(0, 6);
}

function openRecs() {
  const recs = recommendations();
  openSheet("recs", `<h3>Tavsiyalar</h3>
    <p class="muted">Kiygan kiyimingiz, ob-havo va do'kon statistikasi asosida.</p>
    <div class="grid">${recs.map(({ p, why }) => cardHTML(p, `<div class="why">${esc(why)}</div>`)).join("") || `<div class="empty">Hozircha tavsiya yo'q</div>`}</div>`);
}

function openFavs() {
  state.tab = "favs";
  render();
  const favs = [...(state.session?.favs || [])].map(byId).filter(Boolean);
  openSheet("favs", `<h3>Sevimlilar</h3>
    <p class="muted">Sevimlilar faqat shu tashrif davomida saqlanadi. Obrazni telefoningizga olish uchun ko'zgudagi ♡ tugmasini bosing.</p>
    <div class="grid">${favs.map((p) => cardHTML(p)).join("") || `<div class="empty">Kartochkadagi ♡ ni bosing.</div>`}</div>`);
}

let phone = "";
function cartHTML() {
  const items = state.cart.map((c, i) => ({ ...c, p: byId(c.product), i })).filter((x) => x.p);
  const total = items.reduce((a, x) => a + x.p.price, 0);
  const shown = phone.padEnd(9, "_");
  const phoneFmt = `+998 ${shown.slice(0, 2)} ${shown.slice(2, 5)} ${shown.slice(5, 7)} ${shown.slice(7, 9)}`;
  return `<h3>Savat</h3>
    ${items.length ? `<div class="cart">${items.map((x) => `<div class="cart-row">
        <img src="${esc(thumbnailSrc(x.p))}" alt="">
        <div class="cart-info"><b>${esc(x.p.name)}</b><span>O'lcham: ${x.size}</span></div>
        <span class="cart-price">${formatPrice(x.p.price)}</span>
        <button class="opt ghost" data-uncart="${x.i}">✕</button>
      </div>`).join("")}</div>
      <div class="cart-total">Jami: <b>${formatPrice(total)}</b></div>
      <h3>Telefon raqamingiz <span class="muted">(ixtiyoriy)</span></h3>
      <div class="phone">${phoneFmt}</div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "C"].map((k) => `<button data-key="${k}">${k}</button>`).join("")}</div>
      <button class="buy big" id="btn-order">Buyurtma berish</button>
      <p class="muted small">Konsultant tanlangan kiyimlarni o'lchamingizda kiyinish xonasiga olib keladi.</p>`
    : `<div class="empty">Savat bo'sh. Kiyimni tanlab, o'lchamini belgilang va "Savatga" tugmasini bosing.</div>`}`;
}

function openCart() {
  state.tab = "cart";
  render();
  openSheet("cart", cartHTML());
}

async function placeOrder() {
  const btn = $("#btn-order");
  btn.disabled = true;
  btn.textContent = "Yuborilmoqda…";
  try {
    const res = await api.order({
      session: await sessionId(),
      device: DEVICE,
      items: state.cart,
      phone: phone.length === 9 ? "+998" + phone : "",
    });
    state.cart = [];
    phone = "";
    render();
    openSheet("done", `<div class="done">
      <div class="done-label">Buyurtmangiz raqami</div>
      <div class="done-number">#${esc(res.number)}</div>
      <div class="done-total">${formatPrice(res.total)}</div>
      <p>Konsultant kiyimlarni kiyinish xonasiga olib keladi. Raqamni eslab qoling!</p>
      <button class="opt" id="btn-done">Davom etish</button>
    </div>`);
    loadCatalog().catch(() => {});
  } catch (err) {
    toast(err.message);
    if (err.status === 409) loadCatalog().catch(() => {});
    btn.disabled = false;
    btn.textContent = "Buyurtma berish";
  }
}

async function saveLook() {
  const items = SLOT_ORDER.map((s) => state.look[s]).filter(Boolean);
  if (!items.length) { toast("Avval kiyim tanlang"); return; }
  const stage = $("#stage");
  stage.classList.add("flash");
  setTimeout(() => stage.classList.remove("flash"), 300);
  openSheet("qr", `<div class="done"><div class="done-label">Obraz saqlanmoqda…</div></div>`);
  try {
    let snapshot = null;
    try { snapshot = engine.snapshot(); } catch { /* boshqa domendagi rasm bo'lsa */ }
    const res = await api.saveLook({ session: await sessionId(), products: items, snapshot });
    if (state.sheet !== "qr") return;
    openSheet("qr", `<div class="done">
      <div class="done-label">Telefoningiz kamerasi bilan skanerlang</div>
      <div class="qr">${res.qr}</div>
      <p>Surat va kiyimlar ro'yxati telefoningizda ochiladi.</p>
      <button class="opt" id="btn-done">Yopish</button>
    </div>`);
  } catch (err) {
    toast(err.message);
    closeSheet();
  }
}

function openMore() {
  state.tab = "more";
  render();
  const s = state.session;
  const sec = s ? Math.round((Date.now() - s.start) / 1000) : 0;
  const tried = s ? s.tried.size : 0;
  openSheet("more", `<h3>Boshqa</h3>
    <div class="stat-box">
      <div><b>${tried}</b><span>kiyim sinab ko'rildi</span></div>
      <div><b>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}</b><span>sarflangan vaqt</span></div>
      <div><b>~${Math.max(0, tried * 8 - Math.round(sec / 60))} daq</b><span>tejaldi (kiyinish xonasiga nisbatan)</span></div>
    </div>
    <div class="row">
      <button class="opt" id="more-camera">${engine.cameraOn ? "Kamerani o'chirish" : "Kamerani yoqish"}</button>
      <button class="opt" id="more-full">To'liq ekran</button>
      <button class="opt" id="more-end">Tashrifni yakunlash</button>
    </div>
    <p class="muted small">Kamera tasviri faqat shu qurilmada qayta ishlanadi. Surat faqat siz "♡ Obrazni saqlash" tugmasini bossangiz yuboriladi.</p>`);
}

const SHEETS = { style: openStyle, size: openSize, color: openColor, recs: openRecs, favs: openFavs, cart: openCart };
function rerenderSheet() {
  if (state.sheet && SHEETS[state.sheet]) SHEETS[state.sheet]();
}

// ---------------- Hodisalar ----------------
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, .card");
  if (!t) return;

  if (t.dataset.fav) { e.stopPropagation(); toggleFav(+t.dataset.fav); return; }
  if (t.classList.contains("card")) {
    toggleWear(+t.dataset.id);
    if (state.sheet === "recs") rerenderSheet();
    return;
  }
  if (t.dataset.unwear) { toggleWear(+t.dataset.unwear); return; }
  if (t.dataset.size) { state.focusSize = t.dataset.size; renderLook(); return; }
  if (t.dataset.uncart != null) { state.cart.splice(+t.dataset.uncart, 1); render(); openCart(); return; }
  if (t.dataset.key != null) {
    const k = t.dataset.key;
    if (k === "⌫") phone = phone.slice(0, -1);
    else if (k === "C") phone = "";
    else if (phone.length < 9) phone += k;
    $(".phone").outerHTML = cartHTML().match(/<div class="phone">.*?<\/div>/)[0];
    return;
  }
  if (t.id === "rail-reset") { state.filters = { style: null, kind: null, color: null, size: null }; render(); return; }
  if (t.dataset.set) {
    state.filters[t.dataset.set] = t.dataset.value || null;
    render();
    rerenderSheet();
    return;
  }
  if (t.dataset.filter) { SHEETS[t.dataset.filter](); return; }
  if (t.dataset.tab) {
    const tab = t.dataset.tab;
    if (tab === "clothes") closeSheet();
    else ({ favs: openFavs, cart: openCart, more: openMore })[tab]();
    return;
  }

  switch (t.id) {
    case "btn-camera":
      if (engine.cameraOn) engine.disableCamera(); else await engine.enableCamera();
      break;
    case "btn-save-look": saveLook(); break;
    case "btn-clear": state.look = {}; state.focus = null; syncLayers(); render(); break;
    case "btn-add-cart": addToCart(); break;
    case "btn-order": placeOrder(); break;
    case "btn-done": closeSheet(); break;
    case "btn-settings": openMore(); break;
    case "more-camera":
      if (engine.cameraOn) engine.disableCamera(); else await engine.enableCamera();
      openMore();
      break;
    case "more-full":
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
      break;
    case "more-end": goIdle(); break;
  }
});

$("#backdrop").addEventListener("click", closeSheet);
$("#idle").addEventListener("click", () => { $("#idle").hidden = true; });
["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, bumpIdle, { passive: true }));

let toastTimer;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2400);
}

// ---------------- Ishga tushirish ----------------
tickClock();
setInterval(tickClock, 10 * 1000);
setInterval(renderSession, 1000);
setInterval(pollCatalog, 30 * 1000);
setInterval(refreshWeather, 20 * 60 * 1000);

loadCatalog()
  .catch(() => toast("Katalog yuklanmadi — server bilan aloqa yo'q"))
  .finally(() => {
    refreshWeather();
    bumpIdle();
  });

if (new URLSearchParams(location.search).get("camera") !== "0") engine.enableCamera();
