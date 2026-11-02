// Smart Mirror — ko'zgu (kiosk) interfeysi.
import {
  TYPES, STYLES, COLORS, SIZES, SLOT_ORDER,
  getProducts, getFavorites, saveFavorites, getLooks, saveLooks,
  getSettings, saveSettings, getStats, recordTry, recordSession, recordEvent,
  formatPrice, totalStock,
} from "./catalog.js";
import { thumbnailSrc, loadGarment } from "./garments.js";
import { TryOnEngine } from "./tryon.js";
import { CITIES, fetchWeather } from "./weather.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  products: getProducts(),
  favorites: new Set(getFavorites()),
  settings: getSettings(),
  filters: { style: null, type: null, color: null, size: null },
  look: {},            // slot -> productId
  focus: null,         // oxirgi tanlangan mahsulot
  weather: null,
  session: null,       // { start, tried:Set }
  tab: "clothes",
};

const byId = (id) => state.products.find((p) => p.id === id);

// ---------------- Kiyib ko'rish dvigateli ----------------
const engine = new TryOnEngine($("#canvas"), $("#video"), {
  onStatus: ({ mode, text }) => {
    $("#status").dataset.mode = mode;
    $("#status-text").textContent = text;
    $("#btn-camera").classList.toggle("on", mode === "kamera");
  },
});
engine.start();

async function syncLayers() {
  const ids = SLOT_ORDER.map((s) => state.look[s]).filter(Boolean);
  const layers = await Promise.all(ids.map((id) => byId(id)).filter(Boolean).map(loadGarment));
  engine.setLayers(layers);
}

// ---------------- Soat va ob-havo ----------------
function tickClock() {
  const d = new Date();
  $("#time").textContent = d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}
setInterval(tickClock, 1000 * 10);
tickClock();

async function refreshWeather() {
  try {
    state.weather = await fetchWeather(state.settings.city);
    const w = state.weather;
    $("#weather").innerHTML = `<span class="w-icon">${w.icon}</span><span class="w-temp">${w.temp}°C</span><span class="w-city">${esc(w.city)}</span>`;
  } catch {
    $("#weather").innerHTML = `<span class="w-city">${esc(CITIES[state.settings.city]?.label || "")}</span>`;
  }
}
refreshWeather();
setInterval(refreshWeather, 20 * 60 * 1000);

// ---------------- Sessiya va kutish rejimi ----------------
function ensureSession() {
  if (!state.session) state.session = { start: Date.now(), tried: new Set() };
}

function renderSession() {
  const s = state.session;
  const el = $("#session");
  if (!s || !s.tried.size) { el.hidden = true; return; }
  const sec = Math.round((Date.now() - s.start) / 1000);
  el.hidden = false;
  el.innerHTML = `<b>${s.tried.size} ta</b> kiyim · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
setInterval(renderSession, 1000);

let idleTimer = null;
function bumpIdle() {
  $("#idle").hidden = true;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(goIdle, (state.settings.idleSeconds || 90) * 1000);
}

function goIdle() {
  if (state.session) {
    recordSession((Date.now() - state.session.start) / 1000);
    state.session = null;
  }
  state.look = {};
  state.focus = null;
  state.filters = { style: null, type: null, color: null, size: null };
  closeSheet();
  syncLayers();
  render();
  $("#idle").hidden = false;
}

["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, bumpIdle, { passive: true }));
bumpIdle();

// ---------------- Filtrlash ----------------
function filtered() {
  const f = state.filters;
  return state.products.filter((p) =>
    (!f.style || p.style === f.style) &&
    (!f.type || p.type === f.type) &&
    (!f.color || p.color === f.color) &&
    (!f.size || (p.sizes?.[f.size] || 0) > 0));
}

function activeFilterCount() {
  return Object.values(state.filters).filter(Boolean).length;
}

// ---------------- Kiyim tanlash ----------------
function toggleWear(id) {
  const p = byId(id);
  if (!p) return;
  ensureSession();
  const slot = TYPES[p.type].slot;
  if (state.look[slot] === id) {
    delete state.look[slot];
    if (state.focus === id) state.focus = null;
  } else {
    state.look[slot] = id;
    if (slot === "toliq") { delete state.look.ichki; delete state.look.past; }
    if (slot === "ichki" || slot === "past") delete state.look.toliq;
    state.focus = id;
    if (!state.session.tried.has(id)) {
      state.session.tried.add(id);
      recordTry(id);
    }
  }
  syncLayers();
  render();
}

function toggleFav(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else { state.favorites.add(id); recordEvent("favAdds"); toast("Sevimlilarga qo'shildi ♡"); }
  saveFavorites([...state.favorites]);
  render();
  if (state.tab === "favs") openFavs();
}

// ---------------- Chizish ----------------
function render() {
  renderRail();
  renderLook();
  renderSession();
  document.querySelectorAll("#filters button").forEach((b) => {
    const k = b.dataset.filter;
    const on = k === "style" ? state.filters.style || state.filters.type : k === "recs" ? false : state.filters[k];
    b.classList.toggle("on", Boolean(on));
  });
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
}

function cardHTML(p, extra = "") {
  const worn = Object.values(state.look).includes(p.id);
  const fav = state.favorites.has(p.id);
  const out = totalStock(p) === 0;
  return `<div class="card ${worn ? "worn" : ""} ${out ? "out" : ""}" data-id="${esc(p.id)}">
    <img src="${thumbnailSrc(p)}" alt="${esc(p.name)}" loading="lazy">
    <button class="fav ${fav ? "on" : ""}" data-fav="${esc(p.id)}" aria-label="Sevimli">${fav ? "♥" : "♡"}</button>
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
    (list.length ? list.map((p) => cardHTML(p)).join("") : `<div class="empty">Mos kiyim topilmadi</div>`);
}

function renderLook() {
  const worn = SLOT_ORDER.map((s) => state.look[s]).filter(Boolean).map(byId).filter(Boolean);
  const focus = byId(state.focus);
  let html = "";
  if (focus) {
    const sizes = SIZES.map((s) => {
      const n = focus.sizes?.[s] || 0;
      const sel = state.filters.size === s;
      return `<span class="sz ${n ? "" : "na"} ${sel ? "sel" : ""}" title="${n} dona">${s}</span>`;
    }).join("");
    html += `<div class="focus">
      <div class="focus-top">
        <div>
          <div class="focus-name">${esc(focus.name)}</div>
          <div class="focus-meta">${esc(TYPES[focus.type].label)} · ${esc(STYLES[focus.style] || "")} · ${esc(COLORS[focus.color]?.label || "")}</div>
        </div>
        <div class="focus-price">${formatPrice(focus.price)}</div>
      </div>
      <div class="focus-sizes">${sizes}</div>
    </div>`;
  }
  if (worn.length) {
    const total = worn.reduce((a, p) => a + (+p.price || 0), 0);
    html += `<div class="chips">${worn.map((p) => `<button class="chip" data-unwear="${esc(p.id)}">${esc(p.name)} ✕</button>`).join("")}
      <span class="chip total">Jami: ${formatPrice(total)}</span></div>`;
  }
  $("#look").innerHTML = html;
}

// ---------------- Pastki varaq (sheet) ----------------
function openSheet(html) {
  $("#sheet-body").innerHTML = html;
  $("#sheet").hidden = false;
  $("#backdrop").hidden = false;
}

function closeSheet() {
  $("#sheet").hidden = true;
  $("#backdrop").hidden = true;
  if (state.tab !== "clothes") { state.tab = "clothes"; render(); }
}

function chip(group, value, label, on) {
  return `<button class="opt ${on ? "on" : ""}" data-set="${group}" data-value="${esc(value)}">${label}</button>`;
}

function openStyle() {
  const f = state.filters;
  openSheet(`<h3>Turi</h3><div class="opts">
      ${chip("type", "", "Barchasi", !f.type)}
      ${Object.entries(TYPES).map(([k, t]) => chip("type", k, esc(t.label), f.type === k)).join("")}
    </div>
    <h3>Uslub</h3><div class="opts">
      ${chip("style", "", "Barchasi", !f.style)}
      ${Object.entries(STYLES).map(([k, s]) => chip("style", k, esc(s), f.style === k)).join("")}
    </div>`);
}

function openSize() {
  const f = state.filters;
  openSheet(`<h3>O'lcham tanlash</h3>
    <p class="muted">Faqat sizning o'lchamingizda mavjud kiyimlar ko'rsatiladi.</p>
    <div class="opts sizes">
      ${chip("size", "", "Barchasi", !f.size)}
      ${SIZES.map((s) => chip("size", s, s, f.size === s)).join("")}
    </div>
    <details class="guide"><summary>O'lchamlar jadvali</summary>
      <table><tr><th></th><th>Ko'krak, sm</th><th>Bel, sm</th><th>Son, sm</th></tr>
      <tr><td>XS</td><td>80–84</td><td>62–66</td><td>86–90</td></tr>
      <tr><td>S</td><td>84–88</td><td>66–70</td><td>90–94</td></tr>
      <tr><td>M</td><td>88–92</td><td>70–74</td><td>94–98</td></tr>
      <tr><td>L</td><td>92–98</td><td>74–80</td><td>98–104</td></tr>
      <tr><td>XL</td><td>98–104</td><td>80–86</td><td>104–110</td></tr></table>
    </details>`);
}

function openColor() {
  const f = state.filters;
  openSheet(`<h3>Ranglar</h3><div class="opts swatches">
    ${chip("color", "", "Barchasi", !f.color)}
    ${Object.entries(COLORS).map(([k, c]) =>
      `<button class="swatch ${f.color === k ? "on" : ""}" data-set="color" data-value="${k}"><i style="background:${c.hex}"></i>${esc(c.label)}</button>`).join("")}
  </div>`);
}

const NEUTRAL = new Set(["qora", "oq", "bej", "kulrang"]);

function recommendations() {
  const recs = [];
  const seen = new Set(Object.values(state.look));
  const add = (p, why) => {
    if (p && !seen.has(p.id) && totalStock(p) > 0) { seen.add(p.id); recs.push({ p, why }); }
  };
  // 1) Kiyilgan narsaga mos juftlik.
  const hasTop = state.look.ichki || state.look.ustki;
  if (hasTop && !state.look.past && !state.look.toliq) {
    const base = byId(state.look.ichki || state.look.ustki);
    state.products
      .filter((p) => TYPES[p.type].slot === "past")
      .sort((a, b) => score(b, base) - score(a, base))
      .slice(0, 2)
      .forEach((p) => add(p, `${base.name} bilan mos keladi`));
  }
  if ((state.look.ichki || state.look.toliq) && !state.look.ustki) {
    const base = byId(state.look.toliq || state.look.ichki);
    state.products
      .filter((p) => TYPES[p.type].slot === "ustki")
      .sort((a, b) => score(b, base) - score(a, base))
      .slice(0, 1)
      .forEach((p) => add(p, "Obrazni to'ldiradi"));
  }

  // 2) Ob-havoga qarab.
  const t = state.weather?.temp;
  if (t != null) {
    const types = t < 12 ? ["kurtka", "pidjak"] : t > 25 ? ["futbolka", "koylak", "yubka"] : ["pidjak", "bluzka"];
    state.products.filter((p) => types.includes(p.type)).slice(0, 2)
      .forEach((p) => add(p, `Bugun ${t}°C — ${t < 12 ? "issiqroq kiyining" : t > 25 ? "yengil kiyim" : "mavsumga mos"}`));
  }

  // 3) Ommabop (do'kon statistikasi).
  const tries = getStats().tries;
  state.products.filter((p) => !seen.has(p.id) && (tries[p.id] || 0) > 0)
    .sort((a, b) => tries[b.id] - tries[a.id]).slice(0, 2)
    .forEach((p) => add(p, "Eng ko'p sinab ko'rilgan"));

  // 4) Tanlangan uslubga mos boshqa kiyimlar.
  const focus = byId(state.focus);
  if (focus) {
    state.products.filter((p) => p.style === focus.style && p.type !== focus.type)
      .sort((a, b) => score(b, focus) - score(a, focus))
      .forEach((p) => add(p, `${STYLES[focus.style]} uslubiga mos`));
  }
  if (!recs.length) state.products.slice(0, 4).forEach((p) => add(p, "Yangi kolleksiya"));

  return recs.slice(0, 6);
}

function score(p, base) {
  let s = 0;
  if (p.style === base.style) s += 2;
  if (NEUTRAL.has(p.color) || NEUTRAL.has(base.color)) s += 1.5;
  if (p.color === base.color && !NEUTRAL.has(p.color)) s -= 1;
  if (totalStock(p) === 0) s -= 10;
  return s;
}

function openRecs() {
  const recs = recommendations();
  openSheet(`<h3>Tavsiyalar</h3>
    <p class="muted">Kiygan kiyimingiz, ob-havo va do'kon statistikasi asosida.</p>
    <div class="grid">${recs.map(({ p, why }) => cardHTML(p, `<div class="why">${esc(why)}</div>`)).join("") || `<div class="empty">Avval biror kiyimni tanlang</div>`}</div>`);
}

function openFavs() {
  state.tab = "favs";
  render();
  const favs = [...state.favorites].map(byId).filter(Boolean);
  const looks = getLooks();
  openSheet(`<h3>Sevimlilar</h3>
    <div class="grid">${favs.map((p) => cardHTML(p)).join("") || `<div class="empty">Hali sevimli kiyim yo'q. Kartochkadagi ♡ ni bosing.</div>`}</div>
    <h3>Saqlangan obrazlar</h3>
    <div class="looks">${looks.map((l, i) => {
      const items = l.items.map(byId).filter(Boolean);
      return `<div class="look-row">
        <div class="look-thumbs">${items.map((p) => `<img src="${thumbnailSrc(p)}" alt="">`).join("")}</div>
        <div class="look-info"><b>${esc(l.name)}</b><span>${items.map((p) => esc(p.name)).join(", ")}</span></div>
        <button class="opt" data-apply-look="${i}">Kiyish</button>
        <button class="opt ghost" data-del-look="${i}">✕</button>
      </div>`;
    }).join("") || `<div class="empty">Kiyimlarni tanlab, ♡ tugmasi bilan obrazni saqlang.</div>`}</div>`);
}

function openMore() {
  state.tab = "more";
  render();
  const s = state.session;
  const sec = s ? Math.round((Date.now() - s.start) / 1000) : 0;
  const tried = s ? s.tried.size : 0;
  openSheet(`<h3>Boshqa</h3>
    <div class="stat-box">
      <div><b>${tried}</b><span>kiyim sinab ko'rildi</span></div>
      <div><b>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}</b><span>sarflangan vaqt</span></div>
      <div><b>~${Math.max(0, tried * 8 - Math.round(sec / 60))} daq</b><span>tejaldi (kiyinish xonasiga nisbatan)</span></div>
    </div>
    <label class="field">Shahar (ob-havo)
      <select id="city">${Object.entries(CITIES).map(([k, c]) => `<option value="${k}" ${k === state.settings.city ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
    </label>
    <div class="row">
      <button class="opt" id="more-camera">${engine.cameraOn ? "Kamerani o'chirish" : "Kamerani yoqish"}</button>
      <button class="opt" id="more-full">To'liq ekran</button>
      <button class="opt" id="more-end">Sessiyani tugatish</button>
      <a class="opt" href="admin.html">Do'kon paneli →</a>
    </div>
    <p class="muted small">Kamera tasviri faqat shu qurilmada qayta ishlanadi va hech qayerga yuborilmaydi.</p>`);
}

// ---------------- Hodisalar ----------------
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, .card, a");
  if (!t) return;

  if (t.dataset.fav) { e.stopPropagation(); toggleFav(t.dataset.fav); return; }
  if (t.classList.contains("card")) { toggleWear(t.dataset.id); if (!$("#sheet").hidden && state.tab === "clothes") renderSheetIfOpen(); return; }
  if (t.dataset.unwear) { toggleWear(t.dataset.unwear); return; }
  if (t.id === "rail-reset") { state.filters = { style: null, type: null, color: null, size: null }; render(); return; }

  if (t.dataset.set) {
    state.filters[t.dataset.set] = t.dataset.value || null;
    render();
    renderSheetIfOpen();
    return;
  }

  if (t.dataset.filter) {
    lastSheet = t.dataset.filter;
    ({ style: openStyle, size: openSize, color: openColor, recs: openRecs })[t.dataset.filter]();
    return;
  }

  if (t.dataset.tab) {
    const tab = t.dataset.tab;
    lastSheet = null;
    if (tab === "clothes") { state.tab = "clothes"; closeSheet(); render(); }
    if (tab === "favs") openFavs();
    if (tab === "more") openMore();
    return;
  }

  if (t.dataset.applyLook != null) {
    const look = getLooks()[+t.dataset.applyLook];
    if (look) {
      state.look = {};
      look.items.map(byId).filter(Boolean).forEach((p) => { state.look[TYPES[p.type].slot] = p.id; });
      state.focus = look.items[0] || null;
      syncLayers();
      closeSheet();
      render();
    }
    return;
  }
  if (t.dataset.delLook != null) {
    const looks = getLooks();
    looks.splice(+t.dataset.delLook, 1);
    saveLooks(looks);
    openFavs();
    return;
  }

  switch (t.id) {
    case "btn-camera":
      if (engine.cameraOn) engine.disableCamera(); else await engine.enableCamera();
      break;
    case "btn-snap": snapshot(); break;
    case "btn-save-look": saveLook(); break;
    case "btn-clear": state.look = {}; state.focus = null; syncLayers(); render(); break;
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

let lastSheet = null;
function renderSheetIfOpen() {
  if ($("#sheet").hidden || !lastSheet) return;
  ({ style: openStyle, size: openSize, color: openColor, recs: openRecs })[lastSheet]?.();
}

document.addEventListener("change", (e) => {
  if (e.target.id === "city") {
    state.settings.city = e.target.value;
    saveSettings(state.settings);
    refreshWeather();
  }
});

$("#backdrop").addEventListener("click", () => { lastSheet = null; closeSheet(); });
$("#idle").addEventListener("click", () => { $("#idle").hidden = true; });

// Admin paneldagi o'zgarishlar boshqa oynada bo'lsa ham darhol aks etadi.
window.addEventListener("storage", (e) => {
  if (e.key?.startsWith("smartmirror.catalog")) {
    state.products = getProducts();
    syncLayers();
    render();
  }
});

function saveLook() {
  const items = SLOT_ORDER.map((s) => state.look[s]).filter(Boolean);
  if (!items.length) { toast("Avval kiyim tanlang"); return; }
  const looks = getLooks();
  looks.unshift({ name: `Obraz ${looks.length + 1}`, items, at: Date.now() });
  saveLooks(looks.slice(0, 20));
  toast("Obraz saqlandi ♡");
}

async function snapshot() {
  const blob = await engine.snapshot();
  if (!blob) return;
  recordEvent("snapshots");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `smart-mirror-${Date.now()}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  const stage = $("#stage");
  stage.classList.add("flash");
  setTimeout(() => stage.classList.remove("flash"), 300);
  toast("Rasm saqlandi");
}

let toastTimer;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

render();
syncLayers();
// Kamerani avtomatik yoqishga harakat qilamiz (ruxsat bo'lmasa — manekin rejimi).
if (new URLSearchParams(location.search).get("camera") !== "0") engine.enableCamera();
