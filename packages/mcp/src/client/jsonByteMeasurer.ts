/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bounded recursive JSON byte measurer for MCP result trees.
 *
 * Measures the exact UTF-8 byte length of the JSON serialization of an
 * arbitrary value — including structural overhead (braces, brackets, commas,
 * colons, quotes) and JSON string escaping — WITHOUT materializing the full
 * serialized string. Used to budget the entire own-enumerable MCP callTool
 * result tree atomically before any transformation.
 *
 * Short-circuits at one-over the configured limit: as soon as the running
 * total exceeds `limit`, measurement stops and `limit + 1` is returned. This
 * keeps measurement finite even for pathological (deep / wide) inputs.
 *
 * Circular references and non-JSON-serializable values (BigInt) fail closed:
 * they are treated as over-budget so the caller rejects atomically rather
 * than passing through an un-budgetable result.
 */

/** Sentinel thrown internally to short-circuit recursion at one-over. */
class JsonBudgetExceeded {
  readonly marker = 'JsonBudgetExceeded';
}

/** UTF-8 byte length of a single Unicode code point (BMP or supplementary). */
function utf8CodePointByteLength(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/**
 * Measure the JSON byte contribution of a string value INCLUDING its
 * surrounding quotes and JSON escaping. Short-circuits via `add`.
 */
function measureJsonString(str: string, add: (n: number) => void): void {
  add(1); // opening quote
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    switch (cp) {
      case 0x22: // " -> \"
      case 0x5c: // \ -> \\
      case 0x08: // backspace -> \b
      case 0x09: // tab -> \t
      case 0x0a: // newline -> \n
      case 0x0c: // form feed -> \f
      case 0x0d: // carriage return -> \r
        add(2);
        break;
      default:
        // Lone UTF-16 surrogates are escaped as \uXXXX (6 ASCII bytes) by
        // JSON.stringify, not emitted as raw UTF-8. Valid surrogate pairs
        // produce a single code point ≥ 0x10000 that is NOT in the surrogate
        // range, so it falls through to utf8CodePointByteLength (4 bytes).
        // Other C0 control chars are also escaped as \u00XX (6 bytes).
        add(
          cp < 0x20 || (cp >= 0xd800 && cp <= 0xdfff)
            ? 6
            : utf8CodePointByteLength(cp),
        );
    }
  }
  add(1); // closing quote
}

/**
 * Measure a JSON number's serialized byte length. Non-finite numbers
 * (NaN / ±Infinity) serialize as `null` (4 bytes), matching JSON.stringify.
 */
function jsonNumberByteLength(value: number): number {
  if (!Number.isFinite(value)) return 4; // null
  // For finite numbers, String(value) matches JSON.stringify's output
  // (shortest round-trip, scientific notation where used).
  return String(value).length;
}

/**
 * Recursively measure the JSON byte length of `value`, accumulating into
 * `add`. Throws {@link JsonBudgetExceeded} to short-circuit at one-over.
 * Cycles and BigInt throw to fail closed at the top level.
 */
function measureJsonValue(
  value: unknown,
  add: (n: number) => void,
  seen: WeakSet<object>,
): void {
  switch (typeof value) {
    case 'string':
      measureJsonString(value, add);
      return;
    case 'number':
      add(jsonNumberByteLength(value));
      return;
    case 'boolean':
      add(value ? 4 : 5);
      return;
    case 'bigint':
      // JSON.stringify throws on BigInt — fail closed.
      throw new JsonBudgetExceeded();
    case 'undefined':
      // JSON.stringify(undefined) yields nothing (no bytes) at the top level.
      return;
    case 'function':
    case 'symbol':
      // Standalone function/symbol serialize to undefined (nothing) — match
      // JSON.stringify. As object values they are dropped by Object.entries.
      return;
    case 'object':
      break;
    default:
      // Unknown exotic types: fail closed.
      throw new JsonBudgetExceeded();
  }

  if (value === null) {
    add(4); // null
    return;
  }

  if (seen.has(value)) {
    // Circular reference — fail closed.
    throw new JsonBudgetExceeded();
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      measureJsonArray(value, add, seen);
    } else {
      measureJsonObject(value as Record<string, unknown>, add, seen);
    }
  } finally {
    // Allow the same object to appear in sibling subtrees (JSON.stringify
    // serializes those twice) — only nested cycles fail closed.
    seen.delete(value);
  }
}

function measureJsonArray(
  arr: unknown[],
  add: (n: number) => void,
  seen: WeakSet<object>,
): void {
  if (arr.length === 0) {
    add(2); // []
    return;
  }
  add(1); // [
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) add(1); // ,
    const el = arr[i];
    const elType = typeof el;
    // In arrays, undefined/function/symbol elements serialize as `null`.
    if (
      elType === 'undefined' ||
      elType === 'function' ||
      elType === 'symbol'
    ) {
      add(4); // null
    } else {
      measureJsonValue(el, add, seen);
    }
  }
  add(1); // ]
}

function measureJsonObject(
  obj: Record<string, unknown>,
  add: (n: number) => void,
  seen: WeakSet<object>,
): void {
  // Only own enumerable string-keyed properties are serialized (matching
  // JSON.stringify). Values that are undefined/function/symbol are omitted.
  // Use lazy own-key traversal (for...in + hasOwnProperty) so wide objects
  // are measured incrementally without materializing the full key array
  // before the bounded short-circuit can stop — for...in visits own
  // enumerable string keys in the same order Object.keys would return them.
  let emittedAny = false;
  for (const key in obj) {
    // Map inherited (non-own) keys to undefined so the single omission guard
    // below also excludes them — matching JSON.stringify, which serializes
    // only own enumerable properties — without a second control-flow jump in
    // this loop. Inherited getters are never invoked (the ternary resolves to
    // undefined without reading obj[key]).
    const val = Object.prototype.hasOwnProperty.call(obj, key)
      ? obj[key]
      : undefined;
    const t = typeof val;
    if (t === 'undefined' || t === 'function' || t === 'symbol') continue;
    if (!emittedAny) {
      add(1); // {
      emittedAny = true;
    } else {
      add(1); // ,
    }
    measureJsonString(key, add); // "key"
    add(1); // :
    measureJsonValue(val, add, seen);
  }
  if (!emittedAny) {
    add(2); // {}
  } else {
    add(1); // }
  }
}

/**
 * Measure the JSON UTF-8 byte length of `value`, bounded by `limit`.
 *
 * Returns the exact byte length when it is within `limit`; returns `limit + 1`
 * (a definite over-budget marker) when the value would exceed `limit` OR when
 * the value is non-serializable (circular, BigInt). Callers treat any return
 * value greater than `limit` as over-budget and reject atomically.
 */
export function measureOwnEnumerableJsonBytes(
  value: unknown,
  limit: number,
): number {
  let total = 0;
  const seen = new WeakSet<object>();
  const add = (n: number): void => {
    total += n;
    if (total > limit) {
      throw new JsonBudgetExceeded();
    }
  };
  try {
    measureJsonValue(value, add, seen);
    return total;
  } catch (err) {
    // Only the internal budget-exceeded sentinel (also used for intentional
    // fail-closed cases: circular references, BigInt, unknown exotics) should
    // be treated as over-budget. Genuine runtime errors from getters or other
    // unexpected sources must propagate (fail fast) rather than be masked.
    if (err instanceof JsonBudgetExceeded) {
      return limit + 1;
    }
    throw err;
  }
}
