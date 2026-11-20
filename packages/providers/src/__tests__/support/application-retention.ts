/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

export interface ApplicationRetention {
  readonly heap: number;
  readonly objects: number;
}

const ENGINE_CODE =
  /CodeBlock|Executable|^Structure(?:RareData)?$|^JSSourceCode$|^SourceCode$|^SymbolTable$|^PropertyTable$/;
const DATA_CONTAINERS =
  /^(?:Object|Array|Map|Set|WeakMap|WeakSet|ArrayBuffer|SharedArrayBuffer|DataView|(?:Uint|Int|Float|BigInt|BigUint)\d+(?:Clamped)?Array)$/;

/** JSC Inspector nodes are [id, self bytes, class index, flags]. */
export function applicationRetention(
  snapshot: Bun.HeapSnapshot,
): ApplicationRetention {
  if (snapshot.version !== 3 || snapshot.nodes.length % 4 !== 0)
    throw new Error('Unsupported JSC heap snapshot layout');
  let heap = 0;
  let objects = 0;
  for (let at = 4; at < snapshot.nodes.length; at += 4) {
    const name = snapshot.nodeClassNames[snapshot.nodes[at + 2]];
    if (ENGINE_CODE.test(name)) continue;
    heap += snapshot.nodes[at + 1];
    if (DATA_CONTAINERS.test(name)) objects++;
  }
  return { heap, objects };
}
