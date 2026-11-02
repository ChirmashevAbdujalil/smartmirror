// Virtual kiyib ko'rish dvigateli.
// 1) Kamera (getUserMedia) + MediaPipe Pose Landmarker (brauzerda, serverisiz) tanani topadi.
// 2) Kiyim ramkasi (garments.js FRAME) yelka va son nuqtalariga affin o'zgartirish bilan joylanadi.
// 3) Kamera bo'lmasa yoki odam topilmasa — "manekin" rejimi: kiyimlar manekin ustida ko'rsatiladi.

import { FRAME } from "./garments.js";

const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const LM = { LS: 11, RS: 12, LE: 13, RE: 14, LW: 15, RW: 16, LH: 23, RH: 24 };
const DETECT_WIDTH = 384; // AI kichraytirilgan kadrda ishlaydi — tezroq

// ---------------- Umumiy chizish funksiyalari (admin oldindan ko'rish ham ishlatadi) ----------------

export function mannequinPose(W, H) {
  const bodyH = Math.min(H * 0.86, W * 1.55);
  const unit = bodyH / 400;
  const cx = W / 2;
  const top = (H - bodyH) / 2 + 68 * unit;
  const sw = (FRAME.shoulderR - FRAME.shoulderL) * unit;
  return {
    ls: { x: cx - sw / 2, y: top },
    rs: { x: cx + sw / 2, y: top },
    hm: { x: cx, y: top + (FRAME.hipY - FRAME.shoulderY) * unit },
    unit, cx, top,
  };
}

export function drawMannequin(ctx, p) {
  const u = p.unit, cx = p.cx, t = p.top;
  ctx.save();
  const g = ctx.createLinearGradient(cx - 80 * u, 0, cx + 80 * u, 0);
  g.addColorStop(0, "#3a3540");
  g.addColorStop(0.5, "#6b6270");
  g.addColorStop(1, "#3a3540");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, t - 45 * u, 17 * u, 21 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - 7 * u, t - 28 * u, 14 * u, 20 * u);
  const X = (fx) => cx + (fx - 100) * u;
  const Y = (fy) => t + (fy - 40) * u;
  ctx.beginPath();
  ctx.moveTo(X(84), Y(28));
  ctx.quadraticCurveTo(X(52), Y(30), X(42), Y(52));
  ctx.lineTo(X(32), Y(160)); ctx.lineTo(X(38), Y(200)); ctx.lineTo(X(46), Y(200)); ctx.lineTo(X(52), Y(100));
  ctx.quadraticCurveTo(X(56), Y(130), X(60), Y(160));
  ctx.lineTo(X(66), Y(345)); ctx.lineTo(X(92), Y(345)); ctx.lineTo(X(99), Y(200));
  ctx.lineTo(X(101), Y(200)); ctx.lineTo(X(108), Y(345)); ctx.lineTo(X(134), Y(345));
  ctx.lineTo(X(140), Y(160));
  ctx.quadraticCurveTo(X(144), Y(130), X(148), Y(100));
  ctx.lineTo(X(154), Y(200)); ctx.lineTo(X(162), Y(200)); ctx.lineTo(X(168), Y(160));
  ctx.lineTo(X(158), Y(52));
  ctx.quadraticCurveTo(X(148), Y(30), X(116), Y(28));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#2a262d";
  ctx.fillRect(cx - 3 * u, Y(345), 6 * u, 25 * u);
  ctx.beginPath();
  ctx.ellipse(cx, Y(372), 45 * u, 7 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawGarments(ctx, pose, layers) {
  const span = FRAME.shoulderR - FRAME.shoulderL;
  const ux = (pose.rs.x - pose.ls.x) / span, uy = (pose.rs.y - pose.ls.y) / span;
  const sm = { x: (pose.ls.x + pose.rs.x) / 2, y: (pose.ls.y + pose.rs.y) / 2 };
  const vy0 = FRAME.hipY - FRAME.shoulderY;
  const vx = (pose.hm.x - sm.x) / vy0, vy = (pose.hm.y - sm.y) / vy0;
  const ox = sm.x - 100 * ux - FRAME.shoulderY * vx;
  const oy = sm.y - 100 * uy - FRAME.shoulderY * vy;
  ctx.save();
  ctx.setTransform(ux, uy, vx, vy, ox, oy);
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 6;
  for (const { img, box } of layers) {
    ctx.globalAlpha = 0.97;
    ctx.drawImage(img, box.x, box.y, box.w, box.h);
  }
  ctx.restore();
}

export function renderMannequinScene(canvas, layers) {
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const p = mannequinPose(canvas.width, canvas.height);
  drawMannequin(ctx, p);
  drawGarments(ctx, p, layers);
}

// ---------------- Dvigatel ----------------

export class TryOnEngine {
  constructor(canvas, video, { onStatus, onGuide } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.video = video;
    this.onStatus = onStatus || (() => {});
    this.onGuide = onGuide || (() => {});
    this.layers = [];
    this.stream = null;
    this.landmarker = null;
    this.smoothed = null;
    this.lastSeen = 0;
    this.lastVideoTime = -1;
    this.mode = "manekin";
    this.running = false;
    this.guide = "";
    this.realism = true;                         // yorug'lik/soya va qo'l oldinda bo'lishi
    this.small = document.createElement("canvas"); // AI uchun kichik kadr
    this.maskCanvas = document.createElement("canvas"); // odam siluetining niqobi
    this.hasMask = false;
    this.layerCanvas = document.createElement("canvas"); // kiyimlar qatlami
    this.shadeCanvas = document.createElement("canvas"); // yorug'lik xaritasi
    this.armCanvas = document.createElement("canvas");   // tana oldidagi qo'llar
    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    // Ko'zgu paneli o'lchami o'zgarsa (masalan, "Katta ko'zgu" rejimi) — canvas ham moslashadi.
    if (window.ResizeObserver) new ResizeObserver(() => this._resize()).observe(canvas);
    this._resize();
  }

  setLayers(layers) {
    this.layers = layers;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async enableCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this._status("manekin", "Kamera mavjud emas (https yoki localhost kerak) — manekin rejimi");
      return false;
    }
    try {
      this._status("yuklanmoqda", "Kamera yoqilmoqda…");
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.mode = "kamera";
      this._status("kamera", "Kamera yoqildi. AI modeli yuklanmoqda…");
      this._loadPose();
      return true;
    } catch (err) {
      console.warn(err);
      this.mode = "manekin";
      this._status("manekin", "Kameraga ruxsat berilmadi — manekin rejimi");
      return false;
    }
  }

  disableCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.mode = "manekin";
    this.smoothed = null;
    this._setGuide("");
    this._status("manekin", "Manekin rejimi");
  }

  get cameraOn() {
    return this.mode === "kamera";
  }

  async _loadPose() {
    if (this.landmarker) return;
    try {
      const { FilesetResolver, PoseLandmarker } = await import(`${MP_BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      const make = (delegate) =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
          outputSegmentationMasks: true,
        });
      try {
        this.landmarker = await make("GPU");
      } catch {
        this.landmarker = await make("CPU");
      }
      if (this.cameraOn) this._status("kamera", "AI tayyor — kiyim tanangizga moslashadi");
    } catch (err) {
      console.warn("Pose modeli yuklanmadi:", err);
      this._status("kamera", "AI modeli yuklanmadi (internet?) — kiyim markazda ko'rsatiladi");
    }
  }

  _status(mode, text) {
    this.onStatus({ mode, text });
  }

  _setGuide(text) {
    if (text !== this.guide) {
      this.guide = text;
      this.onGuide(text);
    }
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    for (const c of [this.layerCanvas, this.armCanvas]) {
      c.width = this.canvas.width;
      c.height = this.canvas.height;
    }
    this.shadeCanvas.width = Math.max(1, Math.round(this.canvas.width / 2));
    this.shadeCanvas.height = Math.max(1, Math.round(this.canvas.height / 2));
  }

  _videoFit() {
    const W = this.canvas.width, H = this.canvas.height;
    const vw = this.video.videoWidth || 1, vh = this.video.videoHeight || 1;
    const s = Math.max(W / vw, H / vh);
    return { s, dx: (W - vw * s) / 2, dy: (H - vh * s) / 2, vw, vh };
  }

  _toScreen(p, fit) {
    return { x: fit.dx + (1 - p.x) * fit.vw * fit.s, y: fit.dy + p.y * fit.vh * fit.s, v: p.visibility ?? 1 };
  }

  _detect(fit) {
    if (!this.landmarker || this.video.readyState < 2) return null;
    if (this.video.currentTime === this.lastVideoTime) return this.smoothed;
    this.lastVideoTime = this.video.currentTime;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    this.small.width = DETECT_WIDTH;
    this.small.height = Math.round((DETECT_WIDTH * vh) / vw) || 1;
    this.small.getContext("2d").drawImage(this.video, 0, 0, this.small.width, this.small.height);
    let res;
    try {
      res = this.landmarker.detectForVideo(this.small, performance.now());
    } catch {
      return this.smoothed;
    }
    this._readMask(res);
    const lm = res?.landmarks?.[0];
    res?.close?.();
    if (!lm) return null;
    const a = this._toScreen(lm[LM.LS], fit);
    const b = this._toScreen(lm[LM.RS], fit);
    if (Math.min(a.v, b.v) < 0.5) return null;
    const leftFirst = a.x < b.x;
    const [ls, rs] = leftFirst ? [a, b] : [b, a];
    // Ekrandagi chap/o'ng qo'l (tirsak va bilak) — yelkalar bilan bir xil tomonda.
    const arm = (e, w) => ({ e: this._toScreen(lm[e], fit), w: this._toScreen(lm[w], fit) });
    const [la, ra] = leftFirst ? [arm(LM.LE, LM.LW), arm(LM.RE, LM.RW)] : [arm(LM.RE, LM.RW), arm(LM.LE, LM.LW)];
    const h1 = this._toScreen(lm[LM.LH], fit);
    const h2 = this._toScreen(lm[LM.RH], fit);
    let hm;
    const hipsVisible = Math.min(h1.v, h2.v) > 0.3;
    if (hipsVisible) {
      hm = { x: (h1.x + h2.x) / 2, y: (h1.y + h2.y) / 2 };
    } else {
      const sx = rs.x - ls.x, sy = rs.y - ls.y;
      const k = 1.35;
      hm = { x: (ls.x + rs.x) / 2 - sy * k, y: (ls.y + rs.y) / 2 + sx * k };
    }
    // Xaridorga yo'l-yo'riq: juda yaqin / uzoq.
    const width = Math.hypot(rs.x - ls.x, rs.y - ls.y) / this.canvas.width;
    this._setGuide(width > 0.42 || !hipsVisible ? "Bir qadam orqaga turing" : width < 0.12 ? "Yaqinroq keling" : "");

    const next = { ls, rs, hm, le: la.e, lw: la.w, re: ra.e, rw: ra.w };
    if (!this.smoothed) return next;
    const A = 0.45;
    const mix = (p, q) => ({ x: p.x + (q.x - p.x) * A, y: p.y + (q.y - p.y) * A, v: q.v });
    const out = {};
    for (const k of Object.keys(next)) out[k] = this.smoothed[k] ? mix(this.smoothed[k], next[k]) : next[k];
    return out;
  }

  _frame() {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (this.cameraOn && this.video.readyState >= 2) {
      const fit = this._videoFit();
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, W - fit.dx - fit.vw * fit.s, fit.dy, fit.vw * fit.s, fit.vh * fit.s);
      ctx.restore();

      const pose = this._detect(fit);
      if (pose) {
        this.smoothed = pose;
        this.lastSeen = performance.now();
      } else if (performance.now() - this.lastSeen > 600) {
        this.smoothed = null;
        if (this.landmarker) this._setGuide("Ko'zgu qarshisida turing");
      }
      if (this.smoothed) {
        if (this.realism && this.layers.length) this._drawRealistic(this.smoothed, fit);
        else drawGarments(ctx, this.smoothed, this.layers);
      } else if (this.layers.length && !this.landmarker) {
        drawGarments(ctx, mannequinPose(W, H), this.layers);
      }
      return;
    }

    const p = mannequinPose(W, H);
    drawMannequin(ctx, p);
    drawGarments(ctx, p, this.layers);
  }

  snapshot(type = "image/jpeg", quality = 0.88) {
    return this.canvas.toDataURL(type, quality);
  }

  // AI uchun toza kadr: kiyimsiz, ko'zgudek teskari, kamera o'lchamida (eng uzun tomoni 1280px).
  captureClean() {
    if (!this.cameraOn || this.video.readyState < 2) return null;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const k = Math.min(1, 1280 / Math.max(vw, vh));
    const c = document.createElement("canvas");
    c.width = Math.round(vw * k);
    c.height = Math.round(vh * k);
    const x = c.getContext("2d");
    x.translate(c.width, 0);
    x.scale(-1, 1);
    x.drawImage(this.video, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.92);
  }

  // ---------------- Realizm ----------------

  // MediaPipe odam niqobini (0..1) kichik canvas'ga alfa sifatida yozamiz.
  _readMask(res) {
    const mask = res?.segmentationMasks?.[0];
    if (!mask) { this.hasMask = false; return; }
    try {
      const w = mask.width, h = mask.height;
      const data = mask.getAsFloat32Array();
      if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
        this.maskCanvas.width = w;
        this.maskCanvas.height = h;
        this._maskImage = new ImageData(w, h);
      }
      const px = this._maskImage.data;
      for (let i = 0; i < data.length; i++) {
        px[i * 4 + 3] = data[i] * 255;
      }
      this.maskCanvas.getContext("2d").putImageData(this._maskImage, 0, 0);
      this.hasMask = true;
    } catch {
      this.hasMask = false;
    }
  }

  // Video bilan bir xil (ko'zgu, cover) joylashuvda chizish.
  _drawMirrored(ctx, source, fit, scale = 1) {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(this.canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, this.canvas.width - fit.dx - fit.vw * fit.s, fit.dy, fit.vw * fit.s, fit.vh * fit.s);
    ctx.restore();
  }

  _drawRealistic(pose, fit) {
    const W = this.canvas.width, H = this.canvas.height;
    // 1) Kiyimlar alohida qatlamga.
    const g = this.layerCanvas.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    drawGarments(g, pose, this.layers);

    // 2) Yorug'lik xaritasi: kameraning kulrang, xiralashtirilgan tasviri faqat kiyim joyida.
    //    Xonadagi yorug'lik, soya va tana burmalari kiyimga "ko'chadi".
    const sh = this.shadeCanvas, sx = sh.getContext("2d");
    sx.setTransform(1, 0, 0, 1, 0, 0);
    sx.globalCompositeOperation = "source-over";
    sx.clearRect(0, 0, sh.width, sh.height);
    sx.filter = "grayscale(1) contrast(1.35) brightness(1.3) blur(3px)";
    this._drawMirrored(sx, this.video, fit, sh.width / W);
    sx.filter = "none";
    sx.globalCompositeOperation = "destination-in";
    sx.drawImage(this.layerCanvas, 0, 0, sh.width, sh.height);
    sx.globalCompositeOperation = "source-over";

    g.globalCompositeOperation = "multiply";
    g.globalAlpha = 0.55;
    g.drawImage(sh, 0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    // 3) Asosiy kadrga.
    this.ctx.drawImage(this.layerCanvas, 0, 0);

    // 4) Tana oldidagi qo'llar kiyim ustida ko'rinadi.
    if (this.hasMask) this._drawFrontArms(pose, fit);
  }

  _drawFrontArms(pose, fit) {
    const W = this.canvas.width, H = this.canvas.height;
    const sw = Math.hypot(pose.rs.x - pose.ls.x, pose.rs.y - pose.ls.y);
    const top = Math.min(pose.ls.y, pose.rs.y), bottom = pose.hm.y + sw * 0.6;
    const inside = (p) => p && (p.v ?? 1) > 0.4 &&
      p.x > pose.ls.x + sw * 0.12 && p.x < pose.rs.x - sw * 0.12 && p.y > top && p.y < bottom;
    const arms = [[pose.le, pose.lw], [pose.re, pose.rw]].filter(([, w]) => inside(w));
    if (!arms.length) return;

    const a = this.armCanvas.getContext("2d");
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.globalCompositeOperation = "source-over";
    a.clearRect(0, 0, W, H);
    a.strokeStyle = a.fillStyle = "#000";
    a.lineCap = "round";
    a.lineWidth = sw * 0.3;
    for (const [e, w] of arms) {
      const hand = { x: w.x + (w.x - e.x) * 0.35, y: w.y + (w.y - e.y) * 0.35 };
      a.beginPath();
      a.moveTo(e.x, e.y);
      a.lineTo(w.x, w.y);
      a.stroke();
      a.beginPath();
      a.arc(hand.x, hand.y, sw * 0.24, 0, Math.PI * 2);
      a.fill();
    }
    // Faqat haqiqatan odam bo'lgan piksellar (niqob) — fon kirib qolmasin.
    a.globalCompositeOperation = "destination-in";
    a.filter = "blur(2px)";
    this._drawMirrored(a, this.maskCanvas, fit);
    a.filter = "none";
    // Shu joyga haqiqiy kamera tasviri.
    a.globalCompositeOperation = "source-in";
    this._drawMirrored(a, this.video, fit);
    a.globalCompositeOperation = "source-over";
    this.ctx.drawImage(this.armCanvas, 0, 0);
  }
}
