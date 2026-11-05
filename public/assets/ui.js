export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
    body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Builds DOM. Text always goes in as text nodes, so member answers can never become markup. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const setYear = () => {
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
};

export const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const formatTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
