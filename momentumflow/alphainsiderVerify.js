// AlphaInsider connectivity probe: read-only; no trading or account mutations.
// Usage from the MomentumFlow backend host:
//   node alphainsiderVerify.js
// Reads ALPHAINSIDER_API_KEY from the runtime environment; never prints it.
// Documentation: https://api.alphainsider.com/skill.md
// GET /verifyToken; Authorization header is the raw API token, not Bearer.

const url = 'https://alphainsider.com/api/verifyToken';

export async function verifyAlphaInsider({ timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const token = process.env.ALPHAINSIDER_API_KEY;
  if (!token) return { ok: false, status: 'missing_key' };
  if (typeof fetchImpl !== 'function') return { ok: false, status: 'fetch_unavailable' };

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: token, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Do not return response body: it may contain personal or credential-bearing data.
    if (!response.ok) return { ok: false, status: 'http_error', httpStatus: response.status };
    const payload = await response.json();
    if (payload?.success === true) return { ok: true, status: 'verified' };
    return { ok: false, status: 'api_rejected' };
  } catch {
    // Never print raw exceptions; they can include headers, keys, or sensitive payloads.
    return { ok: false, status: 'connection_error' };
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const result = await verifyAlphaInsider();
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}
