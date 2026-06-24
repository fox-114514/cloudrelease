/**
 * Pure URL-safety helpers shared by config-store and the relay client.
 *
 * Lives in its own module so the Node test runner can exercise it without
 * pulling in electron. The test suite in test/url-safety.test.mjs imports
 * the compiled output of this file directly to cover R0-1 / R0-2 in CI.
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  // 0.5.1: default to https:// when no scheme is given. A missing scheme no
  // longer silently downgrades to plaintext; callers must opt in via the
  // allowInsecureHttp flag for non-loopback http:// URLs.
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/** True when host is loopback — http:// is safe because traffic never leaves the machine. */
export function isLoopbackHost(baseUrl: string): boolean {
  try {
    const u = new URL(normalizeBaseUrl(baseUrl));
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Throws when the URL is a non-loopback http:// address and the caller has not
 * opted in. Loopback is always allowed. Use at every bind/login path so an
 * accidental `http://` typo never leaks the device token or member password.
 */
export function assertExplicitInsecureHttp(
  baseUrl: string,
  opts: { allowInsecureHttp: boolean },
): void {
  let u: URL;
  try {
    u = new URL(normalizeBaseUrl(baseUrl));
  } catch {
    throw new Error("服务器地址无效");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("服务器地址只支持 HTTP 或 HTTPS");
  }
  if (u.protocol !== "http:") return;
  if (isLoopbackHost(baseUrl)) return;
  if (!opts.allowInsecureHttp) {
    throw new Error(
      '服务器地址使用了明文 http://，但未启用\u201c允许不安全 HTTP\u201d。' +
        '明文连接下 token、密码和图片均可能被窃听。' +
        '请改用 https://，或在受信 VPN/局域网场景下显式启用\u201c允许不安全 HTTP\u201d。',
    );
  }
}

/** True when the URL is http:// AND not loopback — UI shows persistent banner. */
export function isInsecureHttpUrl(baseUrl: string): boolean {
  try {
    const u = new URL(normalizeBaseUrl(baseUrl));
    return u.protocol === "http:" && !isLoopbackHost(baseUrl);
  } catch {
    return false;
  }
}
