import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const files = [
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/renderer/styles.css", "dist/renderer/styles.css"],
  ["src/renderer/renderer.js", "dist/renderer/renderer.js"],
];

await mkdir(join(root, "dist/renderer"), { recursive: true });

for (const [from, to] of files) {
  await copyFile(join(root, from), join(root, to));
}

