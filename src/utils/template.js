'use strict';

/**
 * Tiny {{placeholder}} template renderer for no-code users.
 * Supports nested paths (body.ho_ten), auto-unwraps n8n-style arrays, and
 * falls back to looking under `.body` so both {{ho_ten}} and {{body.ho_ten}}
 * work for typical webhook payloads.
 */

function dig(obj, path) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[part.trim()];
  }
  return cur;
}

function root(payload) {
  return Array.isArray(payload) ? payload[0] : payload;
}

/** Resolve a single placeholder path against the payload. */
function getPath(payload, path) {
  const r = root(payload);
  let v = dig(r, path);
  if (v === undefined && r && typeof r === 'object' && r.body) v = dig(r.body, path);
  return v;
}

/** Replace all {{path}} in template with values from payload. */
function render(template, payload) {
  return String(template || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p) => {
    const v = getPath(payload, p.trim());
    return v === undefined || v === null ? '' : String(v);
  });
}

module.exports = { render, getPath };
