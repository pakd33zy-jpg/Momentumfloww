const storedBase =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('momentumflow_api_url')
    : null;

const BASE = (
  import.meta.env.VITE_API_URL ||
  storedBase ||
  '/api'
).replace(/\/$/, '');

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Request failed: ${res.status}`
    );
  }

  return data;
}

export const v26Api = {
  status: (budget = 100000) =>
    request(`/v26/status?budget=${encodeURIComponent(budget)}`),

  execute: (budget = 100000) =>
    request('/v26/execute', {
      method: 'POST',
      body: JSON.stringify({
        budget: Number(budget),
        confirm: 'PAPER_V26',
      }),
    }),
};
