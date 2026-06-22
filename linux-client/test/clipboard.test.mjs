import assert from "node:assert/strict";
import test from "node:test";
import { clipboardCommands } from "../dist/clipboard.js";

test("prefers wl-copy in a Wayland session", () => {
  const commands = clipboardCommands("image/png", {
    WAYLAND_DISPLAY: "wayland-0",
    DISPLAY: ":0",
  });

  assert.deepEqual(commands.map(({ command }) => command), ["wl-copy", "xclip"]);
  assert.deepEqual(commands[0].args, ["--type", "image/png"]);
});

test("prefers xclip in an X11 session", () => {
  const commands = clipboardCommands("image/jpeg", { DISPLAY: ":0" });

  assert.deepEqual(commands.map(({ command }) => command), ["xclip", "wl-copy"]);
  assert.deepEqual(commands[0].args, [
    "-selection",
    "clipboard",
    "-t",
    "image/jpeg",
    "-i",
  ]);
});

test("never forwards a non-image MIME type to clipboard tools", () => {
  const commands = clipboardCommands("text/plain", {});

  assert.equal(commands[0].args.includes("image/png"), true);
  assert.equal(commands[1].args.includes("image/png"), true);
});
