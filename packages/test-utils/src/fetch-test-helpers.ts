/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export type FetchCall = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

/**
 * The member Bun adds to its global `fetch`. Projects that do not load
 * `bun-types/globals` never declare it, so it is restated here rather than
 * read off `typeof fetch`.
 */
export interface FetchPreconnect {
  preconnect(
    url: string | URL,
    options?: {
      dns?: boolean;
      tcp?: boolean;
      http?: boolean;
      https?: boolean;
    },
  ): void;
}

const nativeFetch: typeof fetch & Partial<FetchPreconnect> = globalThis.fetch;

/**
 * Reads the member through a type that always marks it optional, so the
 * runtime check stays meaningful whether or not Bun's typings are loaded.
 */
function readPreconnect(
  source: Partial<FetchPreconnect>,
): FetchPreconnect['preconnect'] | undefined {
  return source.preconnect;
}

function nativePreconnect(): FetchPreconnect['preconnect'] {
  const preconnect = readPreconnect(nativeFetch);
  if (preconnect === undefined) {
    throw new Error('fetch.preconnect is unavailable outside the Bun runtime');
  }
  return preconnect.bind(nativeFetch);
}

export function withFetchPreconnect<T extends FetchCall>(
  transport: T,
): NoInfer<T> & FetchPreconnect {
  return Object.assign(transport, { preconnect: nativePreconnect() });
}
