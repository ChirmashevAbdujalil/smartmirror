// Django admin: kiyimning manekindagi ko'rinishi (jonli oldindan ko'rish).
import { loadGarment } from "./garments.js";
import { renderMannequinScene } from "./tryon.js";

const box = document.querySelector(".sm-fit");
if (box) {
  const canvas = box.querySelector("canvas");
  const $ = (name) => document.querySelector(`[name="${name}"]`);
  const colorSelect = $("color");
  const colors = Object.fromEntries(
    (colorSelect?.dataset.colors || "").split("|").filter(Boolean).map((x) => x.split(":"))
  );
  let localImage = null;

  async function update() {
    const p = {
      kind: $("kind")?.value || box.dataset.kind,
      color: { hex: colors[colorSelect?.value] || box.dataset.color },
      image: localImage || box.dataset.image || null,
      fit: {
        scale: parseFloat($("fit_scale")?.value) || 1,
        dx: parseFloat($("fit_offset_x")?.value) || 0,
        dy: parseFloat($("fit_offset_y")?.value) || 0,
      },
    };
    try {
      const layer = await loadGarment(p);
      renderMannequinScene(canvas, [layer]);
    } catch {
      renderMannequinScene(canvas, []);
    }
  }

  ["kind", "color", "fit_scale", "fit_offset_x", "fit_offset_y"].forEach((n) => {
    $(n)?.addEventListener("input", update);
    $(n)?.addEventListener("change", update);
  });
  // Yangi tanlangan rasm (hali saqlanmagan, fon olib tashlanmagan) — taxminiy ko'rinish.
  $("photo")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    localImage = f ? URL.createObjectURL(f) : null;
    update();
  });
  update();
}
