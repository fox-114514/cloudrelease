import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

class FakeFSWatcher extends EventEmitter {
  closed = false;
  closeCalls = 0;
  closeGate = null;
  releaseClose = null;

  deferClose() {
    this.closeGate = new Promise((resolve) => { this.releaseClose = resolve; });
  }

  async close() {
    this.closeCalls += 1;
    await this.closeGate;
    this.closed = true;
  }
}

const { DirectoryWatcher } = await import("../dist/watcher.js");

async function patchChokidar() {
  const createdWatchers = [];
  const Module = await import("node:module");
  const realRequire = Module.createRequire(import.meta.url);
  const realChokidar = realRequire(realRequire.resolve("chokidar"));
  const originalWatch = realChokidar.watch;
  realChokidar.watch = () => {
    const watcher = new FakeFSWatcher();
    createdWatchers.push(watcher);
    return watcher;
  };
  return {
    watchers: createdWatchers,
    restore: () => { realChokidar.watch = originalWatch; },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("fatal error closes once and notifies only after close completes", async (t) => {
  const patched = await patchChokidar();
  t.after(patched.restore);
  const fatalMessages = [];
  const watcher = new DirectoryWatcher({
    watchDir: "/tmp/ssr-test",
    onFile: () => undefined,
    onFatal: (message) => fatalMessages.push(message),
  });
  await watcher.start();
  const first = patched.watchers[0];
  first.deferClose();

  first.emit("error", new Error("disk gone"));
  await tick();
  assert.equal(watcher.isWatching, false);
  assert.equal(first.closeCalls, 1);
  assert.equal(fatalMessages.length, 0, "fatal callback must wait for close()");

  first.releaseClose();
  await tick();
  await tick();
  assert.equal(fatalMessages.length, 1);
  assert.match(fatalMessages[0], /致命错误/);
});

test("restart waits for fatal teardown before creating a replacement", async (t) => {
  const patched = await patchChokidar();
  t.after(patched.restore);
  const watcher = new DirectoryWatcher({
    watchDir: "/tmp/ssr-test",
    onFile: () => undefined,
  });
  await watcher.start();
  const first = patched.watchers[0];
  first.deferClose();
  first.emit("error", new Error("boom"));
  await tick();

  const restart = watcher.start();
  await tick();
  assert.equal(patched.watchers.length, 1, "replacement must not overlap the closing watcher");
  first.releaseClose();
  await restart;
  assert.equal(patched.watchers.length, 2);
  assert.equal(first.closeCalls, 1);
  await watcher.stop();
  assert.equal(patched.watchers[1].closeCalls, 1);
});

test("duplicate fatal errors are idempotent", async (t) => {
  const patched = await patchChokidar();
  t.after(patched.restore);
  const fatalMessages = [];
  const watcher = new DirectoryWatcher({
    watchDir: "/tmp/ssr-test",
    onFile: () => undefined,
    onFatal: (message) => fatalMessages.push(message),
  });
  await watcher.start();
  const first = patched.watchers[0];
  first.emit("error", new Error("first"));
  first.emit("error", new Error("second"));
  await tick();
  await tick();
  assert.equal(first.closeCalls, 1);
  assert.equal(fatalMessages.length, 1);
});

test("one upload failure does not stop later files", async (t) => {
  const patched = await patchChokidar();
  t.after(patched.restore);
  const handled = [];
  const uploadErrors = [];
  const watcher = new DirectoryWatcher({
    watchDir: "/tmp/ssr-test",
    onFile: async (filePath) => {
      handled.push(filePath);
      if (filePath.endsWith("bad.png")) throw new Error("upload failed");
    },
    onUploadError: (message) => uploadErrors.push(message),
  });
  await watcher.start();
  patched.watchers[0].emit("add", "/tmp/ssr-test/bad.png");
  patched.watchers[0].emit("add", "/tmp/ssr-test/good.png");
  await tick();
  await tick();

  assert.deepEqual(handled, ["/tmp/ssr-test/bad.png", "/tmp/ssr-test/good.png"]);
  assert.equal(uploadErrors.length, 1);
  assert.equal(watcher.isWatching, true);
  await watcher.stop();
});
