import assert from "node:assert/strict";
import test from "node:test";
import { RelayClient } from "../dist/relay-client.js";

function createConfig(overrides = {}) {
  const persisted = [];
  const config = {
    serverBaseUrl: overrides.serverBaseUrl ?? "",
    deviceName: "Test Desktop",
    autoReceive: false,
    autoUpload: false,
    settings: {
      serverBaseUrl: overrides.serverBaseUrl ?? "",
      deviceName: "Test Desktop",
      isBound: overrides.isBound ?? false,
      allowInsecureHttp: overrides.allowInsecureHttp ?? false,
      httpConfirmationPending: overrides.httpConfirmationPending ?? false,
    },
    getDeviceToken: () => overrides.deviceToken,
    bindDevice: async (input) => { persisted.push(input); },
    saveSettings: async (input) => {
      persisted.push(input);
      if (input.serverBaseUrl !== undefined) {
        config.serverBaseUrl = input.serverBaseUrl;
        config.settings.serverBaseUrl = input.serverBaseUrl;
      }
      if (input.allowInsecureHttp !== undefined) {
        config.settings.allowInsecureHttp = input.allowInsecureHttp;
        config.settings.httpConfirmationPending = false;
      }
    },
  };
  return { config, persisted };
}

const history = { list: () => [] };
const permissions = {
  canAutoUpload: true,
  canManualUpload: true,
  canAutoReceive: false,
  canManualDownload: true,
  canManageSpace: true,
  canCreateInvite: true,
  autoUploadScope: "screenshots_only",
  autoReceiveScope: "none",
};

test("remote HTTP bind is rejected before fetch unless explicitly allowed", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      success: true,
      data: {
        deviceId: "device-1",
        deviceToken: "token-1",
        user: { id: "user-1", ownerUserId: "user-1", role: "owner" },
        profile: "sync_own",
        permissions,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const blockedConfig = createConfig();
  const blockedClient = new RelayClient(blockedConfig.config, history);
  await assert.rejects(() => blockedClient.registerDevice({
    serverBaseUrl: "http://192.0.2.10",
    bindCode: "code",
    deviceName: "Desktop",
  }), /允许不安全 HTTP/);
  assert.equal(fetchCalls, 0);

  const allowedConfig = createConfig();
  const allowedClient = new RelayClient(allowedConfig.config, history);
  await allowedClient.registerDevice({
    serverBaseUrl: "http://192.0.2.10",
    bindCode: "code",
    deviceName: "Desktop",
    allowInsecureHttp: true,
  });
  assert.equal(fetchCalls, 1);
  assert.equal(allowedConfig.persisted[0].allowInsecureHttp, true);
});

test("old unconfirmed HTTP config blocks stored device token before fetch", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("must not fetch"); };
  const { config } = createConfig({
    serverBaseUrl: "http://192.0.2.20",
    isBound: true,
    deviceToken: "must-not-leak",
    httpConfirmationPending: true,
  });
  const client = new RelayClient(config, history);

  await assert.rejects(() => client.getDeviceMe(), /允许不安全 HTTP/);
  assert.equal(fetchCalls, 0);
});
