// Ob-havo: Open-Meteo (bepul, API kalitsiz).

export const CITIES = {
  toshkent:  { label: "Toshkent",  lat: 41.31, lon: 69.28 },
  samarqand: { label: "Samarqand", lat: 39.65, lon: 66.96 },
  buxoro:    { label: "Buxoro",    lat: 39.77, lon: 64.42 },
  andijon:   { label: "Andijon",   lat: 40.78, lon: 72.34 },
  namangan:  { label: "Namangan",  lat: 41.00, lon: 71.67 },
  fargona:   { label: "Farg'ona",  lat: 40.39, lon: 71.79 },
  nukus:     { label: "Nukus",     lat: 42.46, lon: 59.60 },
  qarshi:    { label: "Qarshi",    lat: 38.86, lon: 65.79 },
  termiz:    { label: "Termiz",    lat: 37.22, lon: 67.28 },
  urganch:   { label: "Urganch",   lat: 41.55, lon: 60.63 },
  jizzax:    { label: "Jizzax",    lat: 40.12, lon: 67.84 },
  navoiy:    { label: "Navoiy",    lat: 40.10, lon: 65.38 },
  guliston:  { label: "Guliston",  lat: 40.49, lon: 68.78 },
};

function describe(code) {
  if (code === 0) return { icon: "☀", text: "Ochiq" };
  if (code <= 3) return { icon: "⛅", text: "Bulutli" };
  if (code <= 48) return { icon: "🌫", text: "Tuman" };
  if (code <= 67 || (code >= 80 && code <= 82)) return { icon: "🌧", text: "Yomg'ir" };
  if (code <= 77 || code === 85 || code === 86) return { icon: "❄", text: "Qor" };
  return { icon: "⛈", text: "Momaqaldiroq" };
}

export async function fetchWeather(cityId) {
  const c = CITIES[cityId] || CITIES.toshkent;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code&timezone=auto`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const temp = Math.round(data.current.temperature_2m);
    return { city: c.label, temp, ...describe(data.current.weather_code) };
  } finally {
    clearTimeout(timer);
  }
}
