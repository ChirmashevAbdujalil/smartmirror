// Do'kon paneli: katalogni boshqarish va statistika.
import {
  TYPES, STYLES, COLORS, SIZES,
  getProducts, saveProducts, resetProducts, newId, totalStock,
  getStats, resetStats, getFavorites, getSettings, saveSettings, formatPrice,
} from "./catalog.js";
import { thumbnailSrc } from "./garments.js";
import { CITIES } from "./weather.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const options = (obj, label = (v) => v) => Object.entries(obj).map(([k, v]) => `<option value="${k}">${esc(label(v))}</option>`).join("");

let products = getProducts();
let editing = null;     // tahrirlanayotgan mahsulot nusxasi

function persist() {
  if (!saveProducts(products)) {
    alert("Saqlash uchun joy yetmadi. Rasmlarni kichikroq qilib yuklang.");
  }
  render();
}

// ---------------- Statistika ----------------
function renderStats() {
  const s = getStats();
  const tries = Object.values(s.tries).reduce((a, b) => a + b, 0);
  const avg = s.sessions ? Math.round(s.sessionSeconds / s.sessions) : 0;
  const perSession = s.sessions ? tries / s.sessions : 0;
  // Taxmin: an'anaviy kiyinish xonasida bitta kiyimga ~8 daqiqa.
  const savedMin = Math.max(0, Math.round(tries * 8 - s.sessionSeconds / 60));
  const cards = [
    ["Sessiyalar", s.sessions],
    ["Sinab ko'rishlar", tries],
    ["O'rtacha sessiya", `${Math.floor(avg / 60)}:${String(avg % 60).padStart(2, "0")}`],
    ["Kiyim / sessiya", perSession.toFixed(1)],
    ["Sevimlilar", getFavorites().length],
    ["Suratlar", s.snapshots || 0],
    ["Tejalgan vaqt (taxm.)", `${savedMin} daq`],
    ["Katalogda", `${products.length} ta`],
  ];
  $("#stats").innerHTML = cards.map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("");

  const top = products
    .map((p) => ({ p, n: s.tries[p.id] || 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const max = top[0]?.n || 1;
  $("#top").innerHTML = top.length
    ? top.map(({ p, n }) => `<div class="bar-row">
        <img src="${thumbnailSrc(p)}" alt="">
        <span class="bar-name">${esc(p.name)}</span>
        <span class="bar"><i style="width:${(n / max) * 100}%"></i></span>
        <span class="bar-n">${n}</span>
      </div>`).join("")
    : `<p class="muted">Hali ma'lumot yo'q. Ko'zguda kiyimlarni sinab ko'ring.</p>`;
}

// ---------------- Jadval ----------------
function renderTable() {
  $("#table").innerHTML = `<thead><tr>
      <th></th><th>Nomi</th><th>Turi</th><th>Uslub</th><th>Rang</th><th>Narx</th>
      ${SIZES.map((s) => `<th class="num">${s}</th>`).join("")}<th></th>
    </tr></thead>
    <tbody>${products.map((p) => `<tr class="${totalStock(p) ? "" : "out"}">
      <td><img src="${thumbnailSrc(p)}" alt=""></td>
      <td><b>${esc(p.name)}</b></td>
      <td>${esc(TYPES[p.type]?.label)}</td>
      <td>${esc(STYLES[p.style])}</td>
      <td><span class="dot" style="background:${COLORS[p.color]?.hex}"></span>${esc(COLORS[p.color]?.label)}</td>
      <td class="nowrap">${formatPrice(p.price)}</td>
      ${SIZES.map((s) => `<td class="num ${p.sizes?.[s] ? "" : "zero"}">${p.sizes?.[s] || 0}</td>`).join("")}
      <td class="nowrap">
        <button class="btn ghost small" data-edit="${esc(p.id)}">Tahrirlash</button>
        <button class="btn ghost small danger" data-del="${esc(p.id)}">O'chirish</button>
      </td>
    </tr>`).join("")}</tbody>`;
}

function render() {
  renderStats();
  renderTable();
}

// ---------------- Forma ----------------
const form = $("#form");
const F = form.elements; // input nomlari form xususiyatlari bilan to'qnashmasligi uchun
F.type.innerHTML = options(TYPES, (t) => t.label);
F.style.innerHTML = options(STYLES);
F.color.innerHTML = options(COLORS, (c) => c.label);
$("#sizes").innerHTML = SIZES.map((s) => `<label>${s}<input type="number" min="0" name="size_${s}"></label>`).join("");

function updatePreview() {
  $("#preview").src = thumbnailSrc({ ...editing, type: F.type.value, color: F.color.value });
  $("#clear-image").hidden = !editing.image;
}

function openForm(p) {
  editing = p ? JSON.parse(JSON.stringify(p)) : {
    id: newId(), name: "", type: "bluzka", style: "kundalik", color: "pushti", price: 0,
    sizes: Object.fromEntries(SIZES.map((s) => [s, 0])), image: null,
  };
  $("#dlg-title").textContent = p ? "Kiyimni tahrirlash" : "Yangi kiyim";
  F.name.value = editing.name;
  F.type.value = editing.type;
  F.style.value = editing.style;
  F.color.value = editing.color;
  F.price.value = editing.price;
  F.image.value = "";
  SIZES.forEach((s) => (F[`size_${s}`].value = editing.sizes?.[s] || 0));
  updatePreview();
  $("#dlg").showModal();
}

F.type.addEventListener("change", updatePreview);
F.color.addEventListener("change", updatePreview);

// Rasmni kichraytirib, dataURL ko'rinishida saqlaymiz (localStorage hajmi cheklangan).
F.image.addEventListener("change", async () => {
  const file = F.image.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const max = 600;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  editing.image = c.toDataURL("image/webp", 0.85);
  URL.revokeObjectURL(url);
  updatePreview();
});

$("#clear-image").addEventListener("click", () => { editing.image = null; F.image.value = ""; updatePreview(); });

$("#dlg").addEventListener("close", () => {
  if ($("#dlg").returnValue !== "ok" || !editing) return;
  Object.assign(editing, {
    name: F.name.value.trim() || "Nomsiz kiyim",
    type: F.type.value,
    style: F.style.value,
    color: F.color.value,
    price: Math.max(0, +F.price.value || 0),
    sizes: Object.fromEntries(SIZES.map((s) => [s, Math.max(0, +F[`size_${s}`].value || 0)])),
  });
  const i = products.findIndex((p) => p.id === editing.id);
  if (i >= 0) products[i] = editing; else products.unshift(editing);
  editing = null;
  persist();
});

// ---------------- Tugmalar ----------------
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.edit) openForm(products.find((p) => p.id === b.dataset.edit));
  if (b.dataset.del) {
    const p = products.find((x) => x.id === b.dataset.del);
    if (p && confirm(`"${p.name}" o'chirilsinmi?`)) {
      products = products.filter((x) => x.id !== p.id);
      persist();
    }
  }
});

$("#add").addEventListener("click", () => openForm(null));

$("#reset").addEventListener("click", () => {
  if (!confirm("Katalog standart holatga qaytarilsinmi? Qo'shilgan kiyimlar o'chadi.")) return;
  resetProducts();
  products = getProducts();
  render();
});

$("#reset-stats").addEventListener("click", () => {
  if (!confirm("Statistika tozalansinmi?")) return;
  resetStats();
  render();
});

$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(products, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "smart-mirror-katalog.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$("#import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const list = JSON.parse(await file.text());
    const valid = Array.isArray(list) && list.every((p) => p && p.id && TYPES[p.type] && COLORS[p.color]);
    if (!valid) throw new Error("format");
    products = list;
    persist();
    alert(`${list.length} ta kiyim import qilindi.`);
  } catch {
    alert("Fayl formati noto'g'ri.");
  }
  e.target.value = "";
});

// ---------------- Sozlamalar ----------------
const sf = $("#settings");
sf.city.innerHTML = options(CITIES, (c) => c.label);
const settings = getSettings();
sf.storeName.value = settings.storeName;
sf.idleSeconds.value = settings.idleSeconds;
sf.city.value = settings.city;
sf.addEventListener("submit", (e) => {
  e.preventDefault();
  saveSettings({
    storeName: sf.storeName.value.trim() || "Smart Mirror",
    idleSeconds: Math.min(900, Math.max(20, +sf.idleSeconds.value || 90)),
    city: sf.city.value,
  });
  alert("Sozlamalar saqlandi.");
});

window.addEventListener("storage", () => { products = getProducts(); render(); });

render();
