// Buyurtmalar doskasi: har 5 soniyada yangilanadi, yangi buyurtmada ovozli signal.
(() => {
  const board = document.getElementById("board");
  if (!board) return;
  const API = board.dataset.api;
  const csrf = document.querySelector("[name=csrfmiddlewaretoken]")?.value || "";
  const NEXT = {
    new: [["preparing", "Tayyorlashni boshlash", "primary"], ["cancelled", "Bekor qilish", ""]],
    preparing: [["fitting", "Kiyinish xonasiga olib bordim", "primary"], ["cancelled", "Bekor qilish", ""]],
    fitting: [["sold", "Sotildi ✓", "primary"], ["cancelled", "Olmadi — omborga qaytarish", ""]],
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => Number(n).toLocaleString("ru-RU").replace(/[ ,]/g, " ") + " so'm";
  let known = null, soundOn = false, audio = null;

  function beep() {
    if (!soundOn) return;
    audio = audio || new AudioContext();
    [0, 0.25].forEach((t) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.2, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.2);
      o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.2);
    });
  }

  function card(o) {
    const items = o.items.map((i) => `<div class="ocard-item">
      ${i.image ? `<img class="thumb" src="${esc(i.image)}" alt="">` : `<span class="thumb sw" style="background:${esc(i.color)}"></span>`}
      <span>${esc(i.name)}</span><span class="size-tag">${esc(i.size)}</span></div>`).join("");
    const actions = (NEXT[o.status] || []).map(([s, label, cls]) =>
      `<button class="btn sm ${cls}" data-id="${o.id}" data-status="${s}">${esc(label)}</button>`).join("");
    return `<div class="ocard ${o.status === "new" ? "fresh" : ""}">
      <div class="ocard-head"><a class="ocard-num" href="${o.id}/">#${esc(o.number)}</a><b class="tnum">${money(o.total)}</b></div>
      <div class="muted small">${esc(o.created)} · ${o.minutes} daqiqa oldin${o.device ? " · " + esc(o.device) : ""}${o.phone ? " · " + esc(o.phone) : ""}</div>
      <div class="ocard-items">${items}</div>
      <div class="ocard-actions">${actions}</div>
    </div>`;
  }

  async function load() {
    try {
      const res = await fetch(API, { credentials: "same-origin" });
      if (res.redirected || !res.ok) return;
      const { orders } = await res.json();
      const newIds = orders.filter((o) => o.status === "new").map((o) => o.id);
      if (known && newIds.some((id) => !known.has(id))) beep();
      known = new Set(newIds);
      for (const col of board.querySelectorAll("[data-col]")) {
        const list = orders.filter((o) => o.status === col.dataset.col).reverse();
        col.querySelector(".n").textContent = list.length;
        col.querySelector(".col-body").innerHTML = list.map(card).join("") ||
          `<p class="muted small" style="margin:4px">Bo'sh</p>`;
      }
    } catch { /* keyingi urinish */ }
  }

  board.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-status]");
    if (!b) return;
    b.disabled = true;
    await fetch(`${API}${b.dataset.id}/status/`, {
      method: "POST", body: new URLSearchParams({ status: b.dataset.status }),
      headers: { "X-CSRFToken": csrf }, credentials: "same-origin",
    });
    load();
  });

  document.getElementById("sound")?.addEventListener("click", (e) => {
    soundOn = !soundOn;
    const btn = e.currentTarget;
    btn.classList.toggle("primary", soundOn);
    btn.querySelector("span").textContent = soundOn ? "Ovoz yoqilgan" : "Ovozni yoqish";
    if (soundOn) beep();
  });

  load();
  setInterval(load, 5000);
})();
