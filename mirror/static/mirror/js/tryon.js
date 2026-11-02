// Virtual kiyib ko'rish dvigateli.
// 1) Kamera (getUserMedia) + MediaPipe Pose Landmarker (brauzerda, serverisiz) tanani topadi.
// 2) Kiyim ramkasi (garments.js FRAME) yelka va son nuqtalariga affin o'zgartirish bilan joylanadi.
// 3) Kamera bo'lmasa yoki odam topilmasa — "manekin" rejimi: kiyimlar manekin ustida ko'rsatiladi.

import { FRAME } from "./garments.js";

const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const LM = { LS: 11, RS: 12, LH: 23, RH: 24 };

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
    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
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
    let res;
    try {
      res = this.landmarker.detectForVideo(this.video, performance.now());
    } catch {
      return this.smoothed;
    }
    const lm = res?.landmarks?.[0];
    if (!lm) return null;
    const a = this._toScreen(lm[LM.LS], fit);
    const b = this._toScreen(lm[LM.RS], fit);
    if (Math.min(a.v, b.v) < 0.5) return null;
    const [ls, rs] = a.x < b.x ? [a, b] : [b, a];
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

    const next = { ls, rs, hm };
    if (!this.smoothed) return next;
    const A = 0.45;
    const mix = (p, q) => ({ x: p.x + (q.x - p.x) * A, y: p.y + (q.y - p.y) * A });
    return { ls: mix(this.smoothed.ls, next.ls), rs: mix(this.smoothed.rs, next.rs), hm: mix(this.smoothed.hm, next.hm) };
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
        drawGarments(ctx, this.smoothed, this.layers);
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
}
