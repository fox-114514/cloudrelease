import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const svgPath = path.join(process.cwd(), "build", "icon.svg");
const pngPath = path.join(process.cwd(), "build", "icon.png");

async function main() {
  const svg = await fs.readFile(svgPath);
  await sharp(svg).resize(1024, 1024).png().toFile(pngPath);
  console.log(`Generated ${pngPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
