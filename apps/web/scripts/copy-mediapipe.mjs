/**
 * Copies the @mediapipe/tasks-vision WASM runtime into public/ so the camera
 * background segmenter can load it same-origin (no CDN dependency at runtime).
 * Runs automatically via predev/prebuild; public/mediapipe is gitignored.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const wasmSrc = join(dirname(require.resolve("@mediapipe/tasks-vision")), "wasm");
const wasmDest = join(webRoot, "public", "mediapipe", "wasm");

if (!existsSync(wasmSrc)) {
  console.error(`[copy-mediapipe] wasm source not found at ${wasmSrc}`);
  process.exit(1);
}
mkdirSync(wasmDest, { recursive: true });
cpSync(wasmSrc, wasmDest, { recursive: true });
console.log(`[copy-mediapipe] copied wasm runtime → ${wasmDest}`);
