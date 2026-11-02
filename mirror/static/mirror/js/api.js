// Server bilan aloqa (Django API).

function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let data = {};
  try { data = await res.json(); } catch { /* bo'sh javob */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `Server xatosi (${res.status})`), { status: res.status });
  return data;
}

export const api = {
  catalog: (device) => request("GET", `/api/catalog/?device=${encodeURIComponent(device)}`),
  version: () => request("GET", "/api/catalog/version/"),
  startSession: (device) => request("POST", "/api/sessions/", { device }),
  tryOn: (session, product) => request("POST", `/api/sessions/${session}/try/`, { product }),
  endSession: (session) => request("POST", `/api/sessions/${session}/end/`),
  saveLook: (payload) => request("POST", "/api/looks/", payload),
  order: (payload) => request("POST", "/api/orders/", payload),
};

export function formatPrice(sum) {
  return Number(sum || 0).toLocaleString("ru-RU").replace(/[ ,]/g, " ") + " so'm";
}
