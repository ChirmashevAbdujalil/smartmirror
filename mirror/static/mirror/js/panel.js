// Panel: menyu (mobil), mavzu, tasdiqlash, ombor jadvali.
(() => {
  const $ = (s, r = document) => r.querySelector(s);

  $("#nav-toggle")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("nav-open") && !e.target.closest("#side, #nav-toggle")) {
      document.body.classList.remove("nav-open");
    }
  });

  // Mavzu: tizim sozlamasi ustidan qo'lda tanlash (localStorage — faqat qulaylik uchun).
  $("#theme-toggle")?.addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("sm-theme", root.dataset.theme); } catch (e) { /* maxfiy rejim */ }
  });

  // <form data-confirm="..."> — yuborishdan oldin so'rash.
  document.addEventListener("submit", (e) => {
    const msg = e.target.dataset.confirm;
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // <select data-autosubmit> — tanlanganda forma yuboriladi (filtrlar).
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-autosubmit]")) e.target.form.submit();
  });

  // Ombor jadvali: o'zgargan kataklarni belgilash va saqlanmagan o'zgarish haqida ogohlantirish.
  const stockForm = $("#stock-form");
  if (stockForm) {
    const counter = $("#changed-count");
    const paint = (input) => {
      const v = input.value.trim();
      input.classList.toggle("na", v === "");
      input.classList.toggle("zero", v === "0");
      input.classList.toggle("low", v === "1");
      input.classList.toggle("changed", v !== input.defaultValue);
    };
    const update = () => {
      const n = stockForm.querySelectorAll("input.changed").length;
      counter.textContent = n ? `${n} ta o'zgarish saqlanmagan` : "O'zgarish yo'q";
      stockForm.dataset.dirty = n ? "1" : "";
    };
    stockForm.querySelectorAll("input[type=number], input[type=text]").forEach(paint);
    stockForm.addEventListener("input", (e) => { if (e.target.matches("input")) { paint(e.target); update(); } });
    stockForm.addEventListener("submit", () => { stockForm.dataset.dirty = ""; });
    window.addEventListener("beforeunload", (e) => { if (stockForm.dataset.dirty) e.preventDefault(); });
    update();
  }
})();
