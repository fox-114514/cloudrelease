// §8.8 §2: minimal Node test entry for the desktop client. The pure URL-
// safety helpers are tested here without electron so CI can cover R0-1
// and R0-2 independently of the electron runtime.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExplicitInsecureHttp,
  isInsecureHttpUrl,
  isLoopbackHost,
  normalizeBaseUrl,
} from "../dist/url-safety.js";

test("normalizeBaseUrl defaults to https:// when no scheme is given", () => {
  assert.equal(normalizeBaseUrl("relay.example.com"), "https://relay.example.com");
  assert.equal(normalizeBaseUrl("https://relay.example.com"), "https://relay.example.com");
  assert.equal(normalizeBaseUrl("http://relay.example.com"), "http://relay.example.com");
  assert.equal(normalizeBaseUrl("relay.example.com/"), "https://relay.example.com");
  assert.equal(normalizeBaseUrl(""), "");
  assert.equal(normalizeBaseUrl("   "), "");
});

test("isLoopbackHost recognises 127.0.0.0/8, localhost, and ::1", () => {
  assert.equal(isLoopbackHost("http://127.0.0.1:3000"), true);
  assert.equal(isLoopbackHost("http://127.5.6.7:3000"), true);
  assert.equal(isLoopbackHost("http://localhost:3000"), true);
  assert.equal(isLoopbackHost("http://[::1]:3000"), true);
  assert.equal(isLoopbackHost("http://192.168.1.5"), false);
  assert.equal(isLoopbackHost("http://10.0.0.1"), false);
  // Default https prefix kicks in.
  assert.equal(isLoopbackHost("relay.example.com"), false);
  assert.equal(isLoopbackHost("http://127.evil"), false);
});

test("isInsecureHttpUrl requires BOTH http scheme AND non-loopback host", () => {
  assert.equal(isInsecureHttpUrl("http://192.168.1.5"), true);
  assert.equal(isInsecureHttpUrl("http://127.0.0.1:3000"), false);
  assert.equal(isInsecureHttpUrl("http://localhost"), false);
  assert.equal(isInsecureHttpUrl("https://192.168.1.5"), false);
  assert.equal(isInsecureHttpUrl("not a url"), false);
});

test("assertExplicitInsecureHttp accepts https, loopback, and explicit opt-in", () => {
  // https always passes.
  assert.doesNotThrow(() =>
    assertExplicitInsecureHttp("https://relay.example.com", { allowInsecureHttp: false }),
  );
  // loopback http is always allowed.
  assert.doesNotThrow(() =>
    assertExplicitInsecureHttp("http://127.0.0.1:3000", { allowInsecureHttp: false }),
  );
  assert.doesNotThrow(() =>
    assertExplicitInsecureHttp("http://localhost", { allowInsecureHttp: false }),
  );
  // Non-loopback http with opt-in.
  assert.doesNotThrow(() =>
    assertExplicitInsecureHttp("http://192.168.1.5", { allowInsecureHttp: true }),
  );
  // Non-loopback http without opt-in: must throw.
  assert.throws(
    () => assertExplicitInsecureHttp("http://192.168.1.5", { allowInsecureHttp: false }),
    /允许不安全 HTTP/,
  );
  // Malformed URL.
  assert.throws(
    () => assertExplicitInsecureHttp("not a url", { allowInsecureHttp: true }),
    /服务器地址无效/,
  );
  assert.throws(
    () => assertExplicitInsecureHttp("ftp://relay.example.com", { allowInsecureHttp: true }),
    /HTTP 或 HTTPS/,
  );
});
