import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createImageUploadForm } from "../dist/api.js";

test("upload form sends the detected image MIME type", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studyshot-api-test-"));
  const file = path.join(dir, "shot.png");
  await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  try {
    const form = await createImageUploadForm(file, "screenshot");
    const image = form.get("image");
    assert.equal(image.type, "image/png");
    assert.equal(form.get("sourceKind"), "screenshot");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
