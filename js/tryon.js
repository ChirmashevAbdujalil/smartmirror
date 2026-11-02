// Virtual kiyib ko'rish dvigateli.
// 1) Kamera (getUserMedia) + MediaPipe Pose Landmarker (brauzerda, serverisiz) tanani topadi.
// 2) Kiyim ramkasi (garments.js FRAME) yelka va son nuqtalariga affin o'zgartirish bilan joylanadi.
// 3) Kamera bo'lmasa yoki odam topilmasa — "manekin" rejimi: kiyimlar manekin ustida ko'rsatiladi.

import { FRAME } from "./garments.js";

const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const LM = { LS: 11, RS: 12, LH: 23, RH: 24, NOSE: 0 };

export class TryOnEngine {
  constructor(canvas, video, { onStatus } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.video = video;
    this.onStatus = onStatus || (() => {});
    this.layers = [];          // [{ img, box }] chizish tartibida
    this.stream = null;
    this.landmarker = null;
    this.smoothed = null;      // { ls, rs, hm } ekran koordinatalarida
    this.lastSeen = 0;
    this.lastVideoTime = -1;
    this.mode = "manekin";     // "kamera" | "manekin"
    this.running = false;
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
      this._status("manekin", "Bu qurilmada kamera mavjud emas");
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
      this._status("kamera", "Kamera yoqildi. Tana aniqlanmoqda…");
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
      if (this.cameraOn) this._status("kamera", "Ko'zgu oldida turing — kiyim tanangizga moslashadi");
    } catch (err) {
      console.warn("Pose modeli yuklanmadi:", err);
      this._status("kamera", "AI modeli yuklanmadi (internet?) — kiyim markazda ko'rsatiladi");
    }
  }

  _status(mode, text) {
    this.onStatus({ mode, text });
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  // Video kadrini "cover" tarzida, ko'zgudek teskari qilib joylash parametrlari.
  _videoFit() {
    const W = this.canvas.width, H = this.canvas.height;
    const vw = this.video.videoWidth || 1, vh = this.video.videoHeight || 1;
    const s = Math.max(W / vw, H / vh);
    return { s, dx: (W - vw * s) / 2, dy: (H - vh * s) / 2, vw, vh };
  }

  _toScreen(p, fit) {
    // Ko'zgu effekti: x teskari.
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
    // Ekrandagi chap/o'ng yelka.
    const [ls, rs] = a.x < b.x ? [a, b] : [b, a];
    const h1 = this._toScreen(lm[LM.LH], fit);
    const h2 = this._toScreen(lm[LM.RH], fit);
    let hm;
    if (Math.min(h1.v, h2.v) > 0.3) {
      hm = { x: (h1.x + h2.x) / 2, y: (h1.y + h2.y) / 2 };
    } else {
      // Son ko'rinmasa — yelka chizig'iga perpendikulyar bo'yicha taxmin.
      const sx = rs.x - ls.x, sy = rs.y - ls.y;
      const k = 1.35;
      hm = { x: (ls.x + rs.x) / 2 - sy * k, y: (ls.y + rs.y) / 2 + sx * k };
    }
    const next = { ls, rs, hm };
    if (!this.smoothed) return next;
    const A = 0.45;
    const mix = (p, q) => ({ x: p.x + (q.x - p.x) * A, y: p.y + (q.y - p.y) * A });
    return { ls: mix(this.smoothed.ls, next.ls), rs: mix(this.smoothed.rs, next.rs), hm: mix(this.smoothed.hm, next.hm) };
  }

  // Manekin uchun qo'zg'almas tana nuqtalari.
  _mannequinPose() {
    const W = this.canvas.width, H = this.canvas.height;
    const bodyH = Math.min(H * 0.86, W * 1.55);
    const unit = bodyH / 400;
    const cx = W / 2;
    const top = (H - bodyH) / 2 + 68 * unit;
    const sw = 88 * unit;
    return {
      ls: { x: cx - sw / 2, y: top },
      rs: { x: cx + sw / 2, y: top },
      hm: { x: cx, y: top + 120 * unit },
      unit, cx, top,
    };
  }

  _drawMannequin(p) {
    const ctx = this.ctx;
    const u = p.unit, cx = p.cx, t = p.top;
    ctx.save();
    const g = ctx.createLinearGradient(cx - 80 * u, 0, cx + 80 * u, 0);
    g.addColorStop(0, "#3a3540");
    g.addColorStop(0.5, "#6b6270");
    g.addColorStop(1, "#3a3540");
    ctx.fillStyle = g;
    // Bosh va bo'yin
    ctx.beginPath();
    ctx.ellipse(cx, t - 45 * u, 17 * u, 21 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 7 * u, t - 28 * u, 14 * u, 20 * u);
    // Tana (ramka koordinatalaridan)
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
    // Tagkursi
    ctx.fillStyle = "#2a262d";
    ctx.fillRect(cx - 3 * u, Y(345), 6 * u, 25 * u);
    ctx.beginPath();
    ctx.ellipse(cx, Y(372), 45 * u, 7 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawGarments(pose) {
    const ctx = this.ctx;
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
    for (const { img, box } of this.layers) {
      ctx.globalAlpha = 0.96;
      ctx.drawImage(img, box.x, box.y, box.w, box.h);
    }
    ctx.restore();
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
      }
      if (this.smoothed) {
        this._drawGarments(this.smoothed);
      } else if (this.layers.length && !this.landmarker) {
        // Model yo'q bo'lsa — markazga joylash.
        this._drawGarments(this._mannequinPose());
      }
      return;
    }

    const p = this._mannequinPose();
    this._drawMannequin(p);
    this._drawGarments(p);
  }

  snapshot() {
    return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
  }
}
