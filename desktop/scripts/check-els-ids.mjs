#!/usr/bin/env node
// scripts/check-els-ids.mjs
//
// Verify that every DOM selector used in src/renderer/renderer.js actually
// resolves to something declared in src/renderer/index.html. Catches the
// "added els.X.foo = ... but forgot to add X to the els init table" class
// of bug before it ships.
//
// Modes:
//   - errors: a JS selector targets an id/class that doesn't exist in HTML
//   - warnings: an id exists in HTML but JS never references it (likely dead,
//     but tolerated because some ids are set dynamically or used by inline
//     handlers the parser can't see)
//   - exit code is non-zero iff there are errors.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const htmlPath = path.join(root, "src/renderer/index.html");
const jsPath = path.join(root, "src/renderer/renderer.js");

const html = fs.readFileSync(htmlPath, "utf8");
const jsRaw = fs.readFileSync(jsPath, "utf8");

// Strip JS line + block comments so we don't pick up selectors in prose.
const js = jsRaw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Pull every `els.<id>` member access. Each must be defined inside the
// single `const els = { ... }` initialization table — otherwise the runtime
// will see `undefined` and crash the first time someone does `els.X.foo = ...`
// (this is the bug that hid behind "Cannot set properties of undefined").
const elsRefs = new Set();
for (const m of js.matchAll(/\bels\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g)) {
  elsRefs.add(m[1]);
}

// Find the single `const els = { ... }` initialization block (best effort:
// we look for the first `{` after `const els` and balance braces).
const elsInit = extractElsInit(js);

// Collect ids that the els init actually registers, plus which ones are
// NodeLists (assigned via querySelectorAll / getElementsBy*) so the warning
// stage can ignore them — they're iterated, not property-accessed.
const registeredEls = new Set();
const nodelistEls = new Set();
if (elsInit) {
  const body = elsInit.body;
  for (const m of body.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([^\n,]+)/gm)) {
    registeredEls.add(m[1]);
    if (/querySelectorAll|getElementsBy/.test(m[2])) nodelistEls.add(m[1]);
  }
}

// Collect declared ids (and the line they appear on) from HTML.
const htmlIds = new Map();
for (const m of html.matchAll(/^[ \t]*<[a-zA-Z][^>]*\bid="([^"]+)"[^>]*>/gm)) {
  if (!htmlIds.has(m[1])) htmlIds.set(m[1], lineOf(html, m.index));
}

// Collect declared class sets from HTML.
const htmlClasses = new Map();
for (const m of html.matchAll(/\bclass="([^"]+)"/g)) {
  for (const c of m[1].split(/\s+/).filter(Boolean)) {
    if (!htmlClasses.has(c)) htmlClasses.set(c, lineOf(html, m.index));
  }
}

// Collect selectors used by JS. Each entry: { kind, value, line }.
const jsSelectors = [];
for (const m of js.matchAll(/document\.getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
  jsSelectors.push({ kind: "id", value: m[1], line: lineOf(js, m.index) });
}
for (const m of js.matchAll(/document\.querySelector(?:All)?\(\s*["']([^"']+)["']\s*\)/g)) {
  const sel = m[1];
  const line = lineOf(js, m.index);
  for (const cm of sel.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
    jsSelectors.push({ kind: "class", value: cm[1], line });
  }
  for (const im of sel.matchAll(/#([a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
    jsSelectors.push({ kind: "id", value: im[1], line });
  }
}

const errors = [];
const seen = new Set();
for (const s of jsSelectors) {
  const key = s.kind + ":" + s.value;
  if (seen.has(key)) continue;
  seen.add(key);
  if (s.kind === "id" && !htmlIds.has(s.value)) {
    errors.push(
      `id="${s.value}" used at renderer.js:${s.line} is missing from index.html`,
    );
  }
  if (s.kind === "class" && !htmlClasses.has(s.value)) {
    errors.push(
      `class=".${s.value}" used at renderer.js:${s.line} is missing from index.html`,
    );
  }
}

// `els.X` references that aren't registered in the els init table are the
// specific regression we just fixed. Catch them before they ship.
if (elsInit) {
  for (const name of [...elsRefs].sort()) {
    if (!registeredEls.has(name)) {
      errors.push(
        `els.${name} is read/written in renderer.js but not registered in the els init table (renderer.js)`,
      );
    }
  }
  // Reverse: registered but never used. Likely dead — warn so we notice.
  // NodeLists (e.g. navItems, views) are accessed via .forEach(), not els.X,
  // so we skip them in this particular check.
  const unusedEls = [...registeredEls].filter((n) => !elsRefs.has(n) && !nodelistEls.has(n)).sort();
  if (unusedEls.length) {
    console.warn("renderer.js: els init entries never referenced via els.<name>:");
    for (const n of unusedEls) console.warn("  ⚠ " + n);
  }
} else {
  console.warn("renderer.js: could not locate `const els = { ... }` init block; skipping els-table check");
}

const referencedIds = new Set(jsSelectors.filter((s) => s.kind === "id").map((s) => s.value));
const unusedIds = [...htmlIds.keys()].filter((id) => !referencedIds.has(id)).sort();

if (errors.length) {
  console.error("renderer integrity check FAILED:");
  for (const e of errors) console.error("  ✗ " + e);
  if (unusedIds.length) {
    console.error("\ndeclared ids never referenced by renderer.js (informational):");
    for (const id of unusedIds) console.error("    " + id + "  (index.html:" + htmlIds.get(id) + ")");
  }
  process.exit(1);
}

const idCount = jsSelectors.filter((s) => s.kind === "id").length;
const classCount = jsSelectors.filter((s) => s.kind === "class").length;
console.log(`renderer integrity check passed (${idCount} ids, ${classCount} classes)`);
if (unusedIds.length && process.env.VERBOSE) {
  console.log("declared ids not referenced by renderer.js:");
  for (const id of unusedIds) console.log("  · " + id + "  (index.html:" + htmlIds.get(id) + ")");
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

// Pull the body of the single `const els = { ... }` declaration so we can
// enumerate the keys it actually registers. We tolerate trailing commas,
// nested braces (none expected inside an init table), and string literals.
function extractElsInit(js) {
  const declMatch = /\bconst\s+els\s*=\s*\{/.exec(js);
  if (!declMatch) return null;
  const start = declMatch.index + declMatch[0].length;
  let depth = 1;
  let inString = null;
  for (let i = start; i < js.length; i++) {
    const ch = js[i];
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { body: js.slice(start, i), openLine: lineOf(js, declMatch.index) };
      }
    }
  }
  return null;
}
