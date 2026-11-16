/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Captures intrinsics before guest code can replace them. */
const INTRINSICS_SOURCE = `  'use strict';
  const trustedApply = Reflect.apply;
  const trustedArrayIsArray = Array.isArray;
  const trustedCreate = Object.create;
  const trustedDefine = Object.defineProperty;
  const trustedFreeze = Object.freeze;
  const trustedKeys = Object.keys;
  const trustedSetPrototypeOf = Object.setPrototypeOf;
  const trustedIsFinite = Number.isFinite;
  const trustedStringify = JSON.stringify;
  const trustedParse = JSON.parse;
  const trustedString = String;
  const trustedSet = Set;
  const setHas = Set.prototype.has;
  const setAdd = Set.prototype.add;
  const setDelete = Set.prototype.delete;
  const arrayMap = Array.prototype.map;
  const arrayJoin = Array.prototype.join;
  const AsyncFunction = (async () => {}).constructor;

`;

/**
 * Source of the trusted prelude evaluated in a fresh QuickJS context before any
 * guest code runs. It evaluates to a function that receives the two host
 * bindings as arguments, so they are never visible as globals. It installs the
 * frozen `tools` and `console` globals and returns helpers that captured the
 * pristine intrinsics, so guest changes to JSON, Object or Array cannot affect
 * argument or result serialization.
 *
 * `serialize(value)` returns `"J" + json` on success, or `"E" + code` when the
 * value is not JSON data (`RESULT_NOT_JSON`) or is nested too deeply
 * (`RESULT_TOO_LARGE`). Top-level `undefined` serializes as `null`; within
 * objects and arrays `undefined` follows JSON.stringify (omitted / null).
 */
export function guestPreludeSource(
  toolNames: readonly string[],
  maxDepth: number,
): string {
  return `(hostCall, hostLog) => {
${INTRINSICS_SOURCE}${serializerSource(maxDepth)}${globalsSource(toolNames)}}`;
}

function serializerSource(maxDepth: number): string {
  return `  class SerializeFailure {
    constructor(code) { this.code = code; }
  }
  const toData = (value) => {
    const ancestors = new trustedSet();
    const visit = (item, depth, inArray) => {
      if (depth > ${maxDepth}) throw new SerializeFailure('RESULT_TOO_LARGE');
      if (item === undefined) return inArray || depth === 0 ? null : undefined;
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
      if (typeof item === 'number') {
        if (!trustedIsFinite(item)) throw new SerializeFailure('RESULT_NOT_JSON');
        return item;
      }
      if (typeof item !== 'object') throw new SerializeFailure('RESULT_NOT_JSON');
      if (trustedApply(setHas, ancestors, [item])) throw new SerializeFailure('RESULT_NOT_JSON');
      trustedApply(setAdd, ancestors, [item]);
      let copy;
      if (trustedArrayIsArray(item)) {
        copy = [];
        trustedSetPrototypeOf(copy, null);
        const length = item.length;
        for (let index = 0; index < length; index++) copy[index] = visit(item[index], depth + 1, true);
      } else {
        copy = trustedCreate(null);
        const keys = trustedKeys(item);
        for (let index = 0; index < keys.length; index++) {
          const child = visit(item[keys[index]], depth + 1, false);
          if (child !== undefined) copy[keys[index]] = child;
        }
      }
      trustedApply(setDelete, ancestors, [item]);
      return copy;
    };
    return visit(value, 0, false);
  };
  const serialize = (value) => {
    try {
      return 'J' + trustedStringify(toData(value));
    } catch (error) {
      if (error instanceof SerializeFailure) return 'E' + error.code;
      throw error;
    }
  };
  const describe = (value) => {
    if (typeof value === 'string') return value;
    try {
      const json = trustedStringify(value);
      return json === undefined ? trustedString(value) : json;
    } catch {
      return trustedString(value);
    }
  };

`;
}

function globalsSource(toolNames: readonly string[]): string {
  return `  const tools = trustedCreate(null);
  for (const name of ${JSON.stringify(toolNames)}) {
    trustedDefine(tools, name, { enumerable: true, value: (args) => hostCall(name, args) });
  }
  trustedDefine(globalThis, 'tools', { value: trustedFreeze(tools) });
  trustedDefine(globalThis, 'console', {
    value: trustedFreeze({
      log: (...values) => hostLog(trustedApply(arrayJoin, trustedApply(arrayMap, values, [describe]), [' '])),
    }),
  });
  return trustedFreeze({
    serialize,
    parse: (text) => trustedParse(text),
    compile: (source) => new AsyncFunction(source),
  });
`;
}
