import assert from "node:assert/strict";
import test from "node:test";
import { assertExplicitInsecureHttp, isLoopbackHost, normalizeBaseUrl } from "../dist/utils.js";

test("normalizeBaseUrl defaults to https:// when no scheme is given", () => {
  assert.equal(normalizeBaseUrl("relay.example.com"), "https://relay.example.com");
  assert.equal(normalizeBaseUrl("relay.example.com:8443"), "https://relay.example.com:8443");
  assert.equal(normalizeBaseUrl("https://relay.example.com"), "https://relay.example.com");
  assert.equal(normalizeBaseUrl("http://relay.example.com"), "http://relay.example.com");
  assert.equal(normalizeBaseUrl(""), "");
});

test("isLoopbackHost recognizes loopback addresses", () => {
  assert.equal(isLoopbackHost("http://127.0.0.1:3000"), true);
  assert.equal(isLoopbackHost("http://localhost:3000"), true);
  assert.equal(isLoopbackHost("http://[::1]:3000"), true);
  assert.equal(isLoopbackHost("http://127.99.99.99:3000"), true);
  assert.equal(isLoopbackHost("http://192.168.1.5:3000"), false);
  assert.equal(isLoopbackHost("https://relay.example.com"), false);
});

test("assertExplicitInsecureHttp rejects non-loopback http without opt-in", () => {
  assert.throws(
    () => assertExplicitInsecureHttp("http://64.90.30.102:3000", { allowInsecureHttp: false }),
    /明文|不安全|insecure/i,
  );
});

test("assertExplicitInsecureHttp accepts https without opt-in", () => {
  assert.doesNotThrow(() =>
    assertExplicitInsecureHttp("https://relay.example.com", { allowInsecureHttp: false }),
  );
});

test("assertExplicitInsecureHttp accepts loopback http without opt-in", () => {
  assert.doesNotThrow(() =>
    assertExplicitInsecureHttp("http://127.0.0.1:3000", { allowInsecureHttp: false }),
  );
  assert.doesNotThrow(() =>
    assertExplicitInsecureHttp("http://localhost:3000", { allowInsecureHttp: false }),
  );
});

test("assertExplicitInsecureHttp accepts non-loopback http with explicit opt-in", () => {
  assert.doesNotThrow(() =>
    assertExplicitInsecureHttp("http://192.168.1.10:3000", { allowInsecureHttp: true }),
  );
});

test("assertExplicitInsecureHttp rejects malformed URLs", () => {
  assert.throws(() => assertExplicitInsecureHttp("not a url", { allowInsecureHttp: false }));
});
