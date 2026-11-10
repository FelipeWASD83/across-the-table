// Talks to the local server. Every /api call carries X-Mesa: 1 (the server refuses anything without it).

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    signal,
    headers: { 'X-Mesa': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.erro || `O servidor respondeu ${res.status}.`);
    err.noCredit = Boolean(data.semCredito);
    throw err;
  }
  return data;
}
