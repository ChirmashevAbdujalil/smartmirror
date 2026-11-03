// Panel grafiklari: bitta qatorli ustunli grafik (SVG), tooltip bilan.
// Qoidalar: bitta rang (--series-1), ustun ≤24px va tepasi 4px yumaloq, ingichka yordamchi chiziqlar,
// faqat eng yuqori qiymat yozuv bilan; qolganini tooltip va "Jadval ko'rinishi" beradi.

const NS = "http://www.w3.org/2000/svg";
const MONTHS = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];

const fmtInt = (v) => Math.round(v).toLocaleString("ru-RU").replace(/[ ,]/g, " ");
const fmtCompact = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : fmtInt(v));
const FORMATS = {
  money: { full: (v) => `${fmtInt(v)} so'm`, axis: fmtCompact },
  int: { full: fmtInt, axis: fmtCompact },
};

function niceStep(max, count = 4) {
  if (max <= 0) return 1;
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

function dateLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()}-${MONTHS[d.getMonth()]}`;
}

// Tepasi yumaloq, pasti to'g'ri ustun.
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function columnChart(root, data, fmt, label) {
  root.innerHTML = "";
  const W = root.clientWidth, H = root.clientHeight;
  const m = { top: 18, right: 4, bottom: 24, left: 44 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const max = Math.max(0, ...data.map((d) => d.value));
  const step = niceStep(max || 1);
  const top = Math.max(step, Math.ceil((max || 1) / step) * step);
  const y = (v) => m.top + ih - (v / top) * ih;
  const band = iw / data.length;
  const bw = Math.min(24, band * 0.62);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${label}: ustunli grafik` });
  for (let v = 0; v <= top + 1e-9; v += step) {
    const yy = Math.round(y(v)) + 0.5;
    svg.append(el("line", { class: v === 0 ? "baseline" : "gridline", x1: m.left, x2: W - m.right, y1: yy, y2: yy }));
    const t = el("text", { class: "tick", x: m.left - 8, y: yy + 4, "text-anchor": "end" });
    t.textContent = fmt.axis(v);
    svg.append(t);
  }
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 64)));
  const peakIndex = max > 0 ? data.reduce((bi, d, i) => (d.value > data[bi].value ? i : bi), 0) : -1;

  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  const tipValue = document.createElement("b");
  const tipLabel = document.createElement("span");
  tip.append(tipValue, tipLabel);

  data.forEach((d, i) => {
    const cx = m.left + band * i + band / 2;
    const g = el("g");
    const hit = el("rect", {
      class: "band", x: m.left + band * i, y: m.top, width: band, height: ih, tabindex: 0,
      "aria-label": `${dateLabel(d.date)}: ${fmt.full(d.value)}`,
    });
    g.append(hit);
    const h = Math.max(0, m.top + ih - y(d.value));
    g.append(el("path", { class: "bar", d: h > 0 ? barPath(cx - bw / 2, y(d.value), bw, h, 4) : "" }));
    if (i % every === (data.length - 1) % every) {
      const t = el("text", { class: "tick", x: cx, y: H - 6, "text-anchor": "middle" });
      t.textContent = dateLabel(d.date);
      g.append(t);
    }
    if (i === peakIndex) {
      const t = el("text", { class: "peak", x: cx, y: y(d.value) - 6, "text-anchor": "middle" });
      t.textContent = fmt.axis(d.value);
      g.append(t);
    }
    const show = () => {
      tipValue.textContent = fmt.full(d.value);
      tipLabel.textContent = `${label} · ${dateLabel(d.date)}`;
      tip.style.left = `${Math.min(Math.max(cx, 70), W - 70)}px`;
      tip.style.top = `${y(d.value)}px`;
      tip.hidden = false;
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", () => (tip.hidden = true));
    hit.addEventListener("blur", () => (tip.hidden = true));
    svg.append(g);
  });
  root.append(svg, tip);
}

for (const root of document.querySelectorAll("[data-chart]")) {
  const source = document.getElementById(root.dataset.chart);
  if (!source) continue;
  const data = JSON.parse(source.textContent);
  const fmt = FORMATS[root.dataset.format] || FORMATS.int;
  const draw = () => columnChart(root, data, fmt, root.dataset.label || "");
  draw();
  if (window.ResizeObserver) {
    let w = root.clientWidth;
    new ResizeObserver(() => { if (root.clientWidth !== w) { w = root.clientWidth; draw(); } }).observe(root);
  }
}
