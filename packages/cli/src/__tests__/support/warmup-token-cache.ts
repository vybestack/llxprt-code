/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { Tiktoken } from '@dqbd/tiktoken';

/** Exact encodings reused only during cache-fill warm-up, never while measuring. */
export function warmupTokenCache(): () => void {
  const encode = Tiktoken.prototype.encode;
  let encoders = new WeakMap<Tiktoken, Map<string, Uint32Array>>();
  Tiktoken.prototype.encode = function (...args): Uint32Array {
    const [text, allowed, disallowed] = args;
    if (allowed !== undefined || disallowed !== undefined)
      return encode.apply(this, args);
    let cache = encoders.get(this);
    if (cache === undefined) {
      cache = new Map();
      encoders.set(this, cache);
    }
    const cached = cache.get(text);
    if (cached !== undefined) return cached.slice();
    const result = encode.apply(this, args);
    cache.set(text, result.slice());
    return result;
  };
  return (): void => {
    Tiktoken.prototype.encode = encode;
    encoders = new WeakMap();
  };
}
