/**
 * Minimal superjson-compatible transformer (CommonJS).
 *
 * superjson 2.x ships ESM-only, which can't be `require()`d from Electron's
 * renderer. app.js tries `require("superjson")` first and falls back to this
 * module. It speaks the same wire format for the subset the desktop app needs:
 *
 *   serialize(x)   -> { json: x }                      (plain JSON inputs)
 *   deserialize(p) -> p.json with p.meta.values applied (Date, undefined,
 *                     bigint, number specials, set, map, regexp, URL)
 *
 * Unknown annotations are left as their JSON representation (e.g. ISO strings)
 * which is safe for everything the desktop UI renders.
 */
"use strict";

function applyAnnotation(value, annotation) {
  const type = Array.isArray(annotation) ? annotation[0] : annotation;
  switch (type) {
    case "undefined":
      return undefined;
    case "Date":
      return new Date(value);
    case "bigint":
      try {
        return BigInt(value);
      } catch {
        return value;
      }
    case "number":
      // superjson encodes NaN/Infinity/-Infinity as strings.
      return Number(value);
    case "regexp": {
      const match = /^\/([\s\S]*)\/([a-z]*)$/.exec(String(value));
      if (!match) return value;
      try {
        return new RegExp(match[1], match[2]);
      } catch {
        return value;
      }
    }
    case "set":
      return Array.isArray(value) ? new Set(value) : value;
    case "map":
      return Array.isArray(value) ? new Map(value) : value;
    case "URL":
      try {
        return new URL(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

/** Splits a superjson path key on unescaped dots ("a\.b.c" -> ["a.b", "c"]). */
function parsePath(key) {
  const parts = [];
  let current = "";
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    if (ch === "\\" && key[i + 1] === ".") {
      current += ".";
      i += 1;
    } else if (ch === ".") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function applyAtPath(root, pathKey, annotation) {
  const parts = pathKey === "" ? [] : parsePath(pathKey);
  if (parts.length === 0) {
    return applyAnnotation(root, annotation);
  }
  let parent = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parent == null || typeof parent !== "object") return root;
    parent = parent[parts[i]];
  }
  if (parent == null || typeof parent !== "object") return root;
  const leaf = parts[parts.length - 1];
  parent[leaf] = applyAnnotation(parent[leaf], annotation);
  return root;
}

function serialize(object) {
  return { json: object === undefined ? null : object, meta: undefined };
}

function deserialize(payload) {
  if (!payload || typeof payload !== "object" || !("json" in payload)) {
    return payload;
  }
  let result = payload.json;
  const meta = payload.meta;
  if (!meta || !meta.values) return result;

  const values = meta.values;
  // Root-level annotation: meta.values is the annotation itself.
  if (Array.isArray(values) || typeof values === "string") {
    return applyAnnotation(result, values);
  }
  for (const [pathKey, annotation] of Object.entries(values)) {
    result = applyAtPath(result, pathKey, annotation);
  }
  return result;
}

module.exports = { serialize, deserialize };
