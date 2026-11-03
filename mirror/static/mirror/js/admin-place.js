// Django admin: kiyimni tanaga joylash muharriri (canvas).
// Admin kiyimni manekin ustida surib, kattalashtirib, burib qo'yadi. Natija yashirin `placement`
// maydoniga {x, y, w, h, r} ko'rinishida (tana ramkasi koordinatalarida) yoziladi va ko'zguda
// xaridor tanasining aynan shu qismiga kiydiriladi.
import { loadGarment, autoBox, BODY_LINES } from "./garments.js";
import { mannequinPose, drawMannequin, drawInBox } from "./tryon.js";

// Tana qismlari bo'yicha tez joylash (ramka y koordinatalari).
const ZONES = [
  { id: "yelka-bel", label: "Yelka → Bel", y0: 24, y1: 132 },
  { id: "yelka-son", label: "Yelka → Son", y0: 24, y1: 182 },
  { id: "yelka-tizza", label: "Yelka → Tizza", y0: 24, y1: 262 },
  { id: "yelka-topiq", label: "Yelka → To'piq", y0: 24, y1: 350 },
  { id: "bel-tizza", label: "Bel → Tizza", y0: 116, y1: 262 },
  { id: "bel-topiq", label: "Bel → To'piq", y0: 116, y1: 350 },
];
const RECOMMENDED = {
  bluzka: "yelka-son", futbolka: "yelka-son", pidjak: "yelka-son", kurtka: "yelka-son",
  shim: "bel-topiq", yubka: "bel-tizza", koylak: "yelka-tizza",
};
const HANDLE_SIZE = 9;     // ekran px (CSS)
const ROT_OFFSET = 26;     // burish dastagi yuqori qirradan qancha uzoqda (CSS px)

function init(root) {
  const $ = (name) => document.querySelector(`[name="${name}"]`);
  const field = $("placement");
  const kindSel = $("kind");
  const colorSel = $("color");
  const photoInput = $("photo");
  const colors = Object.fromEntries(
    (colorSel?.dataset.colors || "").split("|").filter(Boolean).map((x) => x.split(":"))
  );
  const LIMITS = JSON.parse(root.dataset.limits || "{}");

  root.innerHTML = `
    <div class="smp">
      <div class="smp-stage">
        <canvas tabindex="0" aria-label="Kiyimni tanaga joylash maydoni"></canvas>
        <div class="smp-mode"></div>
      </div>
      <div class="smp-panel">
        <div class="smp-group">
          <div class="smp-title">Tana qismi bo'yicha joylash</div>
          <div class="smp-zones">${ZONES.map((z) =>
            `<button type="button" class="smp-btn" data-zone="${z.id}">${z.label}</button>`).join("")}</div>
          <div class="smp-note smp-zone-note"></div>
        </div>
        <div class="smp-group">
          <div class="smp-title">Aniq qiymatlar <span class="smp-unit">(tana birligida, yelkalar orasi = 88)</span></div>
          <div class="smp-nums">
            <label>X<input type="number" step="1" data-k="x"></label>
            <label>Y<input type="number" step="1" data-k="y"></label>
            <label>Kenglik<input type="number" step="1" min="8" data-k="w"></label>
            <label>Balandlik<input type="number" step="1" min="8" data-k="h"></label>
            <label>Burchak°<input type="number" step="1" data-k="r"></label>
          </div>
          <label class="smp-check"><input type="checkbox" class="smp-aspect" checked> Proporsiyani saqlash <span class="smp-unit">(Shift — vaqtincha o'chirish)</span></label>
        </div>
        <div class="smp-actions">
          <button type="button" class="smp-btn" data-act="center">Markazlash</button>
          <button type="button" class="smp-btn" data-act="auto">Avtomatik joy</button>
          <button type="button" class="smp-btn" data-act="revert">Bekor qilish</button>
        </div>
        <div class="smp-note">
          <b>Qanday ishlatiladi:</b> kiyimni sichqoncha yoki barmoq bilan suring, burchak va qirralardagi
          kvadratchalar bilan kattalashtiring, tepadagi doiracha bilan buring.
          Klaviatura: ← ↑ → ↓ — surish (Shift bilan 5 birlik), + / − — kattalashtirish, [ ] — burish.
        </div>
        <div class="smp-note smp-photo-note" hidden>
          Yangi rasm tanlandi. Fon saqlangandan keyin olib tashlanadi — saqlab, joyini yana bir bor tekshiring.
        </div>
      </div>
    </div>`;

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const modeEl = root.querySelector(".smp-mode");
  const aspectBox = root.querySelector(".smp-aspect");
  const nums = [...root.querySelectorAll(".smp-nums input")];
  const zoneNote = root.querySelector(".smp-zone-note");

  const parse = (v) => { try { return JSON.parse(v || "null"); } catch { return null; } };
  const initial = parse(field?.value);
  let placement = initial ? { r: 0, ...initial } : null;
  let img = null;
  let hasUpload = Boolean(root.dataset.image);
  let localImage = null;
  let drag = null;
  let hoverZone = null;
  let dpr = 1;

  // ---------------- Geometriya ----------------
  const kind = () => kindSel?.value || root.dataset.kind || "bluzka";
  const box = () => placement || (img ? autoBox(kind(), img, hasUpload) : { x: 0, y: 0, w: 200, h: 360, r: 0 });
  const view = () => mannequinPose(canvas.width, canvas.height);
  const toScreen = (P, fx, fy) => ({ x: P.cx + (fx - 100) * P.unit, y: P.top + (fy - 40) * P.unit });
  const toFrame = (P, sx, sy) => ({ x: (sx - P.cx) / P.unit + 100, y: (sy - P.top) / P.unit + 40 });
  const rad = (deg) => (deg * Math.PI) / 180;
  const rotate = (v, deg) => {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  };
  const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const localOf = (b, p) => { const c = center(b); return rotate({ x: p.x - c.x, y: p.y - c.y }, -(b.r || 0)); };
  const worldOf = (b, l) => { const c = center(b); const v = rotate(l, b.r || 0); return { x: c.x + v.x, y: c.y + v.y }; };
  const clamp = (k, v) => {
    const [lo, hi] = LIMITS[k] || [-Infinity, Infinity];
    return Math.min(hi, Math.max(lo, v));
  };

  function handles(b, P) {
    const list = [];
    for (const sy of [-1, 0, 1]) for (const sx of [-1, 0, 1]) {
      if (!sx && !sy) continue;
      list.push({ sx, sy, p: worldOf(b, { x: (sx * b.w) / 2, y: (sy * b.h) / 2 }) });
    }
    const rotLocal = { x: 0, y: -b.h / 2 - (ROT_OFFSET * dpr) / P.unit };
    return { list, rot: worldOf(b, rotLocal), top: worldOf(b, { x: 0, y: -b.h / 2 }) };
  }

  // ---------------- Chizish ----------------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 360;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * (5 / 3) * dpr);
    render();
  }

  function render() {
    const W = canvas.width, H = canvas.height, P = view();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b1720";
    ctx.fillRect(0, 0, W, H);

    if (hoverZone) {
      const a = toScreen(P, 0, hoverZone.y0), b = toScreen(P, 0, hoverZone.y1);
      ctx.fillStyle = "rgba(240, 98, 146, .16)";
      ctx.fillRect(0, a.y, W, b.y - a.y);
    }
    drawMannequin(ctx, P);

    // Tana chiziqlari
    ctx.save();
    ctx.font = `${11 * dpr}px Manrope, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    for (const line of BODY_LINES) {
      const y = toScreen(P, 0, line.y).y;
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      ctx.setLineDash([5 * dpr, 5 * dpr]);
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(52 * dpr, y);
      ctx.lineTo(W - 6 * dpr, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,.65)";
      ctx.fillText(line.label, 6 * dpr, y);
    }
    ctx.restore();

    // Kiyim
    if (img) {
      const b = box();
      ctx.save();
      ctx.setTransform(P.unit, 0, 0, P.unit, P.cx - 100 * P.unit, P.top - 40 * P.unit);
      ctx.shadowColor = "rgba(0,0,0,.35)";
      ctx.shadowBlur = 6;
      ctx.globalAlpha = drag ? 0.85 : 0.97;
      drawInBox(ctx, img, b);
      ctx.restore();

      // Tanlov ramkasi va dastaklar
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
        toScreen(P, ...Object.values(worldOf(b, { x: (sx * b.w) / 2, y: (sy * b.h) / 2 }))));
      ctx.strokeStyle = placement ? "#f06292" : "rgba(255,255,255,.7)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash(placement ? [] : [6 * dpr, 4 * dpr]);
      ctx.beginPath();
      corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      const H_ = handles(b, P);
      const top = toScreen(P, H_.top.x, H_.top.y), rot = toScreen(P, H_.rot.x, H_.rot.y);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(rot.x, rot.y);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(rot.x, rot.y, 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const hs = HANDLE_SIZE * dpr;
      for (const h of H_.list) {
        const s = toScreen(P, h.p.x, h.p.y);
        ctx.fillStyle = "#fff";
        ctx.fillRect(s.x - hs / 2, s.y - hs / 2, hs, hs);
        ctx.strokeRect(s.x - hs / 2, s.y - hs / 2, hs, hs);
      }
    }

    // Holat va raqamlar
    modeEl.textContent = placement ? "Qo'lda joylangan" : "Avtomatik joy (turiga qarab)";
    modeEl.classList.toggle("manual", Boolean(placement));
    const b = box();
    for (const input of nums) {
      if (document.activeElement !== input) input.value = Math.round(b[input.dataset.k] || 0);
    }
    const rec = RECOMMENDED[kind()];
    root.querySelectorAll("[data-zone]").forEach((btn) => {
      btn.classList.toggle("rec", btn.dataset.zone === rec);
    });
    const kindLabel = kindSel?.value ? kindSel.selectedOptions[0]?.text : "";
    zoneNote.textContent = kindLabel ? `★ — "${kindLabel}" uchun tavsiya etiladi.` : "Avval kiyim turini tanlang — mos joy ★ bilan belgilanadi.";
  }

  // ---------------- Saqlash ----------------
  function commit(next) {
    placement = next && {
      x: clamp("x", next.x), y: clamp("y", next.y),
      w: clamp("w", next.w), h: clamp("h", next.h), r: clamp("r", next.r || 0),
    };
    if (field) {
      field.value = placement
        ? JSON.stringify(Object.fromEntries(Object.entries(placement).map(([k, v]) => [k, Math.round(v * 100) / 100])))
        : "";
    }
    render();
  }

  const aspectOn = (ev) => aspectBox.checked !== Boolean(ev?.shiftKey);

  // ---------------- Sichqoncha / barmoq ----------------
  function pointer(ev) {
    const r = canvas.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * (canvas.width / r.width);
    const sy = (ev.clientY - r.top) * (canvas.height / r.height);
    return { s: { x: sx, y: sy }, f: toFrame(view(), sx, sy) };
  }

  function hit(pt) {
    if (!img) return null;
    const P = view(), b = box(), H_ = handles(b, P);
    const near = (p, radius) => {
      const s = toScreen(P, p.x, p.y);
      return Math.hypot(s.x - pt.s.x, s.y - pt.s.y) <= radius * dpr;
    };
    if (near(H_.rot, 12)) return { mode: "rotate" };
    for (const h of H_.list) if (near(h.p, 11)) return { mode: "resize", sx: h.sx, sy: h.sy };
    const l = localOf(b, pt.f);
    if (Math.abs(l.x) <= b.w / 2 && Math.abs(l.y) <= b.h / 2) return { mode: "move" };
    return null;
  }

  const CURSORS = { move: "move", rotate: "grab" };
  function cursorFor(h, b) {
    if (!h) return "default";
    if (h.mode !== "resize") return CURSORS[h.mode];
    const ang = (Math.atan2(h.sy, h.sx) * 180) / Math.PI + (b.r || 0);
    const a = ((ang % 180) + 180) % 180;
    return a < 22.5 || a >= 157.5 ? "ew-resize" : a < 67.5 ? "nwse-resize" : a < 112.5 ? "ns-resize" : "nesw-resize";
  }

  canvas.addEventListener("pointerdown", (ev) => {
    const pt = pointer(ev);
    const h = hit(pt);
    if (!h) return;
    ev.preventDefault();
    canvas.focus();
    canvas.setPointerCapture(ev.pointerId);
    drag = { ...h, start: pt.f, box0: { ...box() } };
  });

  canvas.addEventListener("pointermove", (ev) => {
    const pt = pointer(ev);
    if (!drag) {
      canvas.style.cursor = cursorFor(hit(pt), box());
      return;
    }
    const b0 = drag.box0;
    if (drag.mode === "move") {
      commit({ ...b0, x: b0.x + pt.f.x - drag.start.x, y: b0.y + pt.f.y - drag.start.y });
    } else if (drag.mode === "rotate") {
      const c = center(b0);
      let deg = (Math.atan2(pt.f.x - c.x, -(pt.f.y - c.y)) * 180) / Math.PI;
      if (Math.abs(deg) < 3) deg = 0;
      commit({ ...b0, r: deg });
    } else {
      const { sx, sy } = drag;
      const q = localOf(b0, pt.f);
      const anchor = { x: (-sx * b0.w) / 2, y: (-sy * b0.h) / 2 };
      let w = sx ? Math.max(8, (q.x - anchor.x) * sx) : b0.w;
      let h = sy ? Math.max(8, (q.y - anchor.y) * sy) : b0.h;
      if (aspectOn(ev)) {
        const s = sx && sy ? Math.max(w / b0.w, h / b0.h) : sx ? w / b0.w : h / b0.h;
        w = b0.w * s;
        h = b0.h * s;
      }
      const cl = { x: sx ? anchor.x + (sx * w) / 2 : 0, y: sy ? anchor.y + (sy * h) / 2 : 0 };
      const c = worldOf(b0, cl);
      commit({ x: c.x - w / 2, y: c.y - h / 2, w, h, r: b0.r || 0 });
    }
  });

  const endDrag = () => { if (drag) { drag = null; render(); } };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("keydown", (ev) => {
    if (!img) return;
    const b = { ...box() };
    const step = ev.shiftKey ? 5 : 1;
    const scale = (k) => {
      const c = center(b);
      b.w *= k; b.h *= k;
      b.x = c.x - b.w / 2; b.y = c.y - b.h / 2;
    };
    switch (ev.key) {
      case "ArrowLeft": b.x -= step; break;
      case "ArrowRight": b.x += step; break;
      case "ArrowUp": b.y -= step; break;
      case "ArrowDown": b.y += step; break;
      case "+": case "=": scale(1.02); break;
      case "-": case "_": scale(1 / 1.02); break;
      case "[": b.r = (b.r || 0) - step; break;
      case "]": b.r = (b.r || 0) + step; break;
      default: return;
    }
    ev.preventDefault();
    commit(b);
  });

  // ---------------- Panel ----------------
  nums.forEach((input) => input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    if (Number.isNaN(v)) return;
    const b = { ...box() };
    const k = input.dataset.k;
    if ((k === "w" || k === "h") && aspectBox.checked) {
      const s = v / b[k];
      const c = center(b);
      b.w *= s; b.h *= s;
      b.x = c.x - b.w / 2; b.y = c.y - b.h / 2;
    } else {
      b[k] = v;
    }
    commit(b);
  }));

  root.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button");
    if (!btn || !img) return;
    if (btn.dataset.zone) {
      const z = ZONES.find((x) => x.id === btn.dataset.zone);
      const h = z.y1 - z.y0;
      const ar = (img.naturalWidth || 1) / (img.naturalHeight || 1);
      const w = aspectBox.checked ? h * ar : box().w;
      commit({ x: 100 - w / 2, y: z.y0, w, h, r: 0 });
    } else if (btn.dataset.act === "center") {
      const b = box();
      commit({ ...b, x: 100 - b.w / 2 });
    } else if (btn.dataset.act === "auto") {
      commit(null);
    } else if (btn.dataset.act === "revert") {
      commit(initial ? { r: 0, ...initial } : null);
    }
  });
  root.addEventListener("pointerover", (ev) => {
    const btn = ev.target.closest("[data-zone]");
    hoverZone = btn ? ZONES.find((z) => z.id === btn.dataset.zone) : null;
    render();
  });
  root.addEventListener("pointerout", (ev) => {
    if (ev.target.closest("[data-zone]")) { hoverZone = null; render(); }
  });

  // ---------------- Kiyim tasviri ----------------
  async function reloadImage() {
    try {
      const layer = await loadGarment({
        kind: kind(),
        color: { hex: colors[colorSel?.value] || root.dataset.color },
        image: localImage || root.dataset.image || null,
        placement: null,
      });
      img = layer.img;
    } catch {
      img = null;
    }
    render();
  }

  kindSel?.addEventListener("change", reloadImage);
  colorSel?.addEventListener("change", reloadImage);
  photoInput?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    localImage = f ? URL.createObjectURL(f) : null;
    hasUpload = Boolean(localImage || root.dataset.image);
    root.querySelector(".smp-photo-note").hidden = !localImage;
    reloadImage();
  });

  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);
  resize();
  reloadImage();
}

const editorRoot = document.querySelector(".sm-place");
if (editorRoot) init(editorRoot);
